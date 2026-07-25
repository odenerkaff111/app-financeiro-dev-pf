begin;

-- =========================================================
-- PARTE 2A — MOTOR FINANCEIRO CENTRAL
-- Dívidas com juros, compromissos parciais e recebíveis.
-- =========================================================

-- ---------------------------------------------------------
-- 1. EVOLUÇÃO DAS DÍVIDAS
-- ---------------------------------------------------------

alter table public.pf_debts
    add column if not exists debt_group text not null default 'personal',
    add column if not exists responsible_user_id uuid
        references auth.users(id)
        on delete set null,
    add column if not exists visibility_scope text not null default 'family',
    add column if not exists interest_enabled boolean not null default false,
    add column if not exists auto_accrue_interest boolean not null default false,
    add column if not exists interest_rate numeric(12, 8) not null default 0,
    add column if not exists interest_period text not null default 'monthly',
    add column if not exists interest_method text not null default 'simple',
    add column if not exists interest_start_date date,
    add column if not exists grace_period_days integer not null default 0;

update public.pf_debts
set
    responsible_user_id = coalesce(
        responsible_user_id,
        created_by
    ),
    debt_group = case
        when import_key like 'personal:%'
            or type = 'informal'
            then 'personal'
        else coalesce(
            nullif(debt_group, ''),
            'other'
        )
    end,
    interest_enabled = case
        when coalesce(monthly_interest_rate, 0) > 0
            or coalesce(daily_late_interest_rate, 0) > 0
            then true
        else interest_enabled
    end,
    interest_rate = case
        when interest_rate > 0
            then interest_rate
        when coalesce(monthly_interest_rate, 0) > 0
            then monthly_interest_rate
        else 0
    end,
    interest_period = case
        when interest_rate > 0
            then interest_period
        when coalesce(monthly_interest_rate, 0) > 0
            then 'monthly'
        else interest_period
    end,
    interest_start_date = coalesce(
        interest_start_date,
        start_date,
        due_date
    );

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_group_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_group_valid
            check (
                debt_group in (
                    'personal',
                    'other'
                )
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_visibility_scope_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_visibility_scope_valid
            check (
                visibility_scope in (
                    'individual',
                    'family'
                )
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_interest_rate_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_interest_rate_valid
            check (
                interest_rate >= 0
                and interest_rate <= 1000
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_interest_period_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_interest_period_valid
            check (
                interest_period in (
                    'daily',
                    'monthly',
                    'yearly'
                )
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_interest_method_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_interest_method_valid
            check (
                interest_method in (
                    'simple',
                    'compound'
                )
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_grace_period_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_grace_period_valid
            check (
                grace_period_days >= 0
            );
    end if;
end;
$$;

create index if not exists
pf_debts_household_group_idx
on public.pf_debts (
    household_id,
    debt_group,
    status
);

create or replace function public.pf_interest_period_fraction(
    interval_start date,
    interval_end date,
    selected_period text
)
returns numeric
language sql
immutable
strict
set search_path = public
as $$
    select case
        when interval_end <= interval_start
            then 0::numeric
        when selected_period = 'daily'
            then (interval_end - interval_start)::numeric
        when selected_period = 'monthly'
            then (interval_end - interval_start)::numeric / 30::numeric
        when selected_period = 'yearly'
            then (interval_end - interval_start)::numeric / 365::numeric
        else 0::numeric
    end;
$$;

create or replace function public.pf_calculate_interval_interest(
    base_balance numeric,
    interval_start date,
    interval_end date,
    selected_rate numeric,
    selected_period text,
    selected_method text
)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
    period_fraction numeric;
    normalized_rate numeric;
begin
    if base_balance is null
       or base_balance <= 0
       or selected_rate is null
       or selected_rate <= 0
       or interval_end is null
       or interval_start is null
       or interval_end <= interval_start then
        return 0;
    end if;

    period_fraction := public.pf_interest_period_fraction(
        interval_start,
        interval_end,
        selected_period
    );

    normalized_rate := selected_rate / 100::numeric;

    if selected_method = 'compound' then
        return round(
            base_balance * (
                power(
                    1::numeric + normalized_rate,
                    period_fraction
                ) - 1::numeric
            ),
            10
        );
    end if;

    return round(
        base_balance
        * normalized_rate
        * period_fraction,
        10
    );
end;
$$;

create or replace function public.pf_calculate_debt_position(
    target_debt_id uuid,
    position_date date default current_date
)
returns table (
    ledger_balance numeric,
    accrued_interest numeric,
    projected_penalty numeric,
    projected_late_interest numeric,
    projected_balance numeric,
    daily_growth numeric,
    overdue_days integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
    selected_debt public.pf_debts%rowtype;
    selected_movement record;

    working_balance numeric := 0;
    calculated_ledger_balance numeric := 0;
    calculated_interest numeric := 0;
    calculated_penalty numeric := 0;
    calculated_late_interest numeric := 0;
    calculated_daily_growth numeric := 0;

    movement_count integer := 0;

    cursor_date date;
    event_date date;
    effective_start date;
    overdue_start date;
    split_date date;

    base_interest numeric;
    late_interest numeric;
    late_days integer;
    penalty_already_projected boolean := false;
begin
    select *
    into selected_debt
    from public.pf_debts debt
    where debt.id = target_debt_id;

    if not found then
        raise exception 'Dívida não encontrada.';
    end if;

    if not public.pf_is_member(
        selected_debt.household_id
    ) then
        raise exception 'Você não possui acesso a esta dívida.';
    end if;

    position_date := coalesce(
        position_date,
        current_date
    );

    overdue_start := case
        when selected_debt.due_date is null
            then null
        else selected_debt.due_date
            + selected_debt.grace_period_days
    end;

    select
        coalesce(
            sum(
                case
                    when movement.movement_type in (
                        'principal',
                        'interest',
                        'fee'
                    ) then movement.amount
                    when movement.movement_type in (
                        'payment',
                        'discount'
                    ) then -movement.amount
                    else 0
                end
            ),
            selected_debt.current_balance,
            selected_debt.original_amount,
            0
        )
    into calculated_ledger_balance
    from public.pf_debt_movements movement
    where movement.debt_id = selected_debt.id
      and movement.occurred_on <= position_date;

    for selected_movement in
        select
            movement.movement_type,
            movement.amount,
            movement.occurred_on
        from public.pf_debt_movements movement
        where movement.debt_id = selected_debt.id
          and movement.occurred_on <= position_date
        order by
            movement.occurred_on asc,
            movement.id asc
    loop
        movement_count := movement_count + 1;
        event_date := selected_movement.occurred_on;

        if cursor_date is null then
            cursor_date := event_date;
        end if;

        if event_date > cursor_date then
            effective_start := greatest(
                cursor_date,
                coalesce(
                    selected_debt.interest_start_date,
                    selected_debt.start_date,
                    cursor_date
                )
            );

            if event_date > effective_start then
                if overdue_start is not null
                   and not penalty_already_projected
                   and overdue_start <= effective_start
                   and event_date > overdue_start
                   and coalesce(selected_debt.penalty_rate, 0) > 0 then
                    calculated_penalty := calculated_penalty
                        + working_balance
                        * selected_debt.penalty_rate
                        / 100::numeric;

                    working_balance := working_balance
                        + working_balance
                        * selected_debt.penalty_rate
                        / 100::numeric;

                    penalty_already_projected := true;
                end if;

                if overdue_start is not null
                   and not penalty_already_projected
                   and overdue_start > effective_start
                   and overdue_start < event_date then
                    split_date := overdue_start;

                    if selected_debt.interest_enabled
                       and selected_debt.auto_accrue_interest then
                        base_interest := public.pf_calculate_interval_interest(
                            working_balance,
                            effective_start,
                            split_date,
                            selected_debt.interest_rate,
                            selected_debt.interest_period,
                            selected_debt.interest_method
                        );

                        working_balance := working_balance + base_interest;
                        calculated_interest := calculated_interest + base_interest;
                    end if;

                    if coalesce(selected_debt.penalty_rate, 0) > 0 then
                        calculated_penalty := calculated_penalty
                            + working_balance
                            * selected_debt.penalty_rate
                            / 100::numeric;

                        working_balance := working_balance
                            + working_balance
                            * selected_debt.penalty_rate
                            / 100::numeric;
                    end if;

                    penalty_already_projected := true;
                    effective_start := split_date;
                end if;

                if selected_debt.interest_enabled
                   and selected_debt.auto_accrue_interest then
                    base_interest := public.pf_calculate_interval_interest(
                        working_balance,
                        effective_start,
                        event_date,
                        selected_debt.interest_rate,
                        selected_debt.interest_period,
                        selected_debt.interest_method
                    );

                    working_balance := working_balance + base_interest;
                    calculated_interest := calculated_interest + base_interest;
                end if;

                if overdue_start is not null
                   and event_date > overdue_start
                   and coalesce(
                       selected_debt.daily_late_interest_rate,
                       0
                   ) > 0 then
                    late_days := greatest(
                        event_date
                        - greatest(
                            effective_start,
                            overdue_start
                        ),
                        0
                    );

                    late_interest := working_balance
                        * selected_debt.daily_late_interest_rate
                        / 100::numeric
                        * late_days;

                    working_balance := working_balance + late_interest;
                    calculated_late_interest := calculated_late_interest
                        + late_interest;
                end if;
            end if;
        end if;

        working_balance := greatest(
            0,
            working_balance
            + case
                when selected_movement.movement_type in (
                    'principal',
                    'interest',
                    'fee'
                ) then selected_movement.amount
                when selected_movement.movement_type in (
                    'payment',
                    'discount'
                ) then -selected_movement.amount
                else 0
              end
        );

        cursor_date := event_date;
    end loop;

    if movement_count = 0 then
        working_balance := coalesce(
            selected_debt.current_balance,
            selected_debt.original_amount,
            0
        );

        cursor_date := coalesce(
            selected_debt.start_date,
            selected_debt.interest_start_date,
            selected_debt.created_at::date,
            position_date
        );
    end if;

    if position_date > cursor_date then
        effective_start := greatest(
            cursor_date,
            coalesce(
                selected_debt.interest_start_date,
                selected_debt.start_date,
                cursor_date
            )
        );

        if position_date > effective_start then
            if overdue_start is not null
               and not penalty_already_projected
               and overdue_start <= effective_start
               and position_date > overdue_start
               and coalesce(selected_debt.penalty_rate, 0) > 0 then
                calculated_penalty := calculated_penalty
                    + working_balance
                    * selected_debt.penalty_rate
                    / 100::numeric;

                working_balance := working_balance
                    + working_balance
                    * selected_debt.penalty_rate
                    / 100::numeric;

                penalty_already_projected := true;
            end if;

            if overdue_start is not null
               and not penalty_already_projected
               and overdue_start > effective_start
               and overdue_start < position_date then
                split_date := overdue_start;

                if selected_debt.interest_enabled
                   and selected_debt.auto_accrue_interest then
                    base_interest := public.pf_calculate_interval_interest(
                        working_balance,
                        effective_start,
                        split_date,
                        selected_debt.interest_rate,
                        selected_debt.interest_period,
                        selected_debt.interest_method
                    );

                    working_balance := working_balance + base_interest;
                    calculated_interest := calculated_interest + base_interest;
                end if;

                if coalesce(selected_debt.penalty_rate, 0) > 0 then
                    calculated_penalty := calculated_penalty
                        + working_balance
                        * selected_debt.penalty_rate
                        / 100::numeric;

                    working_balance := working_balance
                        + working_balance
                        * selected_debt.penalty_rate
                        / 100::numeric;
                end if;

                penalty_already_projected := true;
                effective_start := split_date;
            end if;

            if selected_debt.interest_enabled
               and selected_debt.auto_accrue_interest then
                base_interest := public.pf_calculate_interval_interest(
                    working_balance,
                    effective_start,
                    position_date,
                    selected_debt.interest_rate,
                    selected_debt.interest_period,
                    selected_debt.interest_method
                );

                working_balance := working_balance + base_interest;
                calculated_interest := calculated_interest + base_interest;
            end if;

            if overdue_start is not null
               and position_date > overdue_start
               and coalesce(
                   selected_debt.daily_late_interest_rate,
                   0
               ) > 0 then
                late_days := greatest(
                    position_date
                    - greatest(
                        effective_start,
                        overdue_start
                    ),
                    0
                );

                late_interest := working_balance
                    * selected_debt.daily_late_interest_rate
                    / 100::numeric
                    * late_days;

                working_balance := working_balance + late_interest;
                calculated_late_interest := calculated_late_interest
                    + late_interest;
            end if;
        end if;
    end if;

    calculated_daily_growth := 0;

    if selected_debt.interest_enabled
       and selected_debt.auto_accrue_interest then
        calculated_daily_growth := calculated_daily_growth
            + public.pf_calculate_interval_interest(
                working_balance,
                position_date,
                position_date + 1,
                selected_debt.interest_rate,
                selected_debt.interest_period,
                selected_debt.interest_method
            );
    end if;

    if overdue_start is not null
       and position_date >= overdue_start
       and coalesce(
           selected_debt.daily_late_interest_rate,
           0
       ) > 0 then
        calculated_daily_growth := calculated_daily_growth
            + working_balance
            * selected_debt.daily_late_interest_rate
            / 100::numeric;
    end if;

    ledger_balance := round(
        greatest(
            calculated_ledger_balance,
            0
        ),
        2
    );

    accrued_interest := round(
        greatest(
            calculated_interest,
            0
        ),
        2
    );

    projected_penalty := round(
        greatest(
            calculated_penalty,
            0
        ),
        2
    );

    projected_late_interest := round(
        greatest(
            calculated_late_interest,
            0
        ),
        2
    );

    projected_balance := round(
        greatest(
            working_balance,
            0
        ),
        2
    );

    daily_growth := round(
        greatest(
            calculated_daily_growth,
            0
        ),
        2
    );

    overdue_days := case
        when overdue_start is null
            or position_date <= overdue_start
            then 0
        else position_date - overdue_start
    end;

    return next;
end;
$$;

create or replace view public.pf_debt_positions
with (security_invoker = true)
as
select
    debt.id,
    debt.household_id,
    debt.created_by,
    debt.responsible_user_id,
    debt.visibility_scope,
    debt.creditor,
    debt.description,
    debt.type,
    debt.debt_group,
    debt.original_amount,
    debt.current_balance,
    debt.installment_amount,
    debt.total_installments,
    debt.paid_installments,
    debt.interest_free,
    debt.interest_enabled,
    debt.auto_accrue_interest,
    debt.interest_rate,
    debt.interest_period,
    debt.interest_method,
    debt.interest_start_date,
    debt.penalty_rate,
    debt.daily_late_interest_rate,
    debt.grace_period_days,
    debt.start_date,
    debt.due_date,
    debt.status,
    debt.linked_account_id,
    debt.import_key,
    debt.created_at,
    debt.updated_at,
    position.ledger_balance,
    position.accrued_interest,
    position.projected_penalty,
    position.projected_late_interest,
    position.projected_balance,
    position.daily_growth,
    position.overdue_days
from public.pf_debts debt
cross join lateral public.pf_calculate_debt_position(
    debt.id,
    current_date
) position;

revoke all
on public.pf_debt_positions
from anon;

grant select
on public.pf_debt_positions
to authenticated;

-- ---------------------------------------------------------
-- 2. CONTAS A PAGAR E VALORES A RECEBER
-- ---------------------------------------------------------

create table if not exists public.pf_commitments (
    id uuid primary key default gen_random_uuid(),

    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,

    created_by uuid not null default auth.uid()
        references auth.users(id)
        on delete restrict,

    responsible_user_id uuid
        references auth.users(id)
        on delete set null,

    visibility_scope text not null default 'family'
        check (
            visibility_scope in (
                'individual',
                'family'
            )
        ),

    direction text not null
        check (
            direction in (
                'payable',
                'receivable'
            )
        ),

    counterparty text not null,
    description text not null,

    category_id uuid
        references public.pf_categories(id)
        on delete set null,

    default_account_id uuid
        references public.pf_accounts(id)
        on delete set null,

    linked_debt_id uuid
        references public.pf_debts(id)
        on delete set null,

    total_amount numeric(14, 2) not null
        check (
            total_amount > 0
        ),

    issued_on date not null default current_date,
    due_date date,

    status text not null default 'pending'
        check (
            status in (
                'pending',
                'partial',
                'settled',
                'cancelled'
            )
        ),

    source text not null default 'manual',
    notes text,
    metadata jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.pf_commitment_settlements (
    id uuid primary key default gen_random_uuid(),

    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,

    commitment_id uuid not null
        references public.pf_commitments(id)
        on delete cascade,

    transaction_id uuid
        references public.pf_transactions(id)
        on delete set null,

    account_id uuid not null
        references public.pf_accounts(id)
        on delete restrict,

    amount numeric(14, 2) not null
        check (
            amount > 0
        ),

    settled_on date not null default current_date,
    notes text,

    created_by uuid not null default auth.uid()
        references auth.users(id)
        on delete restrict,

    created_at timestamptz not null default now()
);

create index if not exists
pf_commitments_household_direction_idx
on public.pf_commitments (
    household_id,
    direction,
    status,
    due_date
);

create index if not exists
pf_commitment_settlements_commitment_idx
on public.pf_commitment_settlements (
    commitment_id,
    settled_on,
    created_at
);

create unique index if not exists
pf_commitment_settlements_transaction_unique
on public.pf_commitment_settlements (
    transaction_id
)
where transaction_id is not null;

create or replace function public.pf_validate_commitment_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.category_id is not null
       and not exists (
           select 1
           from public.pf_categories category
           where category.id = new.category_id
             and category.household_id = new.household_id
       ) then
        raise exception 'A categoria não pertence ao grupo familiar.';
    end if;

    if new.default_account_id is not null
       and not exists (
           select 1
           from public.pf_accounts account
           where account.id = new.default_account_id
             and account.household_id = new.household_id
       ) then
        raise exception 'A conta padrão não pertence ao grupo familiar.';
    end if;

    if new.linked_debt_id is not null
       and not exists (
           select 1
           from public.pf_debts debt
           where debt.id = new.linked_debt_id
             and debt.household_id = new.household_id
       ) then
        raise exception 'A dívida vinculada não pertence ao grupo familiar.';
    end if;

    new.updated_at := now();

    return new;
end;
$$;

drop trigger if exists
pf_validate_commitment_links_trigger
on public.pf_commitments;

create trigger pf_validate_commitment_links_trigger
before insert or update
on public.pf_commitments
for each row
execute function public.pf_validate_commitment_links();

create or replace function public.pf_validate_commitment_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    selected_commitment public.pf_commitments%rowtype;
    settled_before numeric;
begin
    select *
    into selected_commitment
    from public.pf_commitments commitment
    where commitment.id = new.commitment_id;

    if not found then
        raise exception 'Compromisso não encontrado.';
    end if;

    if selected_commitment.household_id <> new.household_id then
        raise exception 'O compromisso não pertence ao grupo familiar.';
    end if;

    if not exists (
        select 1
        from public.pf_accounts account
        where account.id = new.account_id
          and account.household_id = new.household_id
          and account.is_active = true
    ) then
        raise exception 'A conta informada não pertence ao grupo familiar ou está inativa.';
    end if;

    if selected_commitment.status = 'cancelled' then
        raise exception 'O compromisso está cancelado.';
    end if;

    select coalesce(
        sum(settlement.amount),
        0
    )
    into settled_before
    from public.pf_commitment_settlements settlement
    where settlement.commitment_id = new.commitment_id
      and (
          tg_op <> 'UPDATE'
          or settlement.id <> new.id
      );

    if settled_before + new.amount
       > selected_commitment.total_amount + 0.005 then
        raise exception
            'O valor informado ultrapassa o saldo restante de %.',
            greatest(
                selected_commitment.total_amount - settled_before,
                0
            );
    end if;

    return new;
end;
$$;

drop trigger if exists
pf_validate_commitment_settlement_trigger
on public.pf_commitment_settlements;

create trigger pf_validate_commitment_settlement_trigger
before insert or update
on public.pf_commitment_settlements
for each row
execute function public.pf_validate_commitment_settlement();

create or replace function public.pf_refresh_commitment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    selected_commitment_id uuid;
    total_value numeric;
    settled_value numeric;
begin
    selected_commitment_id := coalesce(
        new.commitment_id,
        old.commitment_id
    );

    select commitment.total_amount
    into total_value
    from public.pf_commitments commitment
    where commitment.id = selected_commitment_id;

    if not found then
        if tg_op = 'DELETE' then
            return old;
        end if;

        return new;
    end if;

    select coalesce(
        sum(settlement.amount),
        0
    )
    into settled_value
    from public.pf_commitment_settlements settlement
    where settlement.commitment_id = selected_commitment_id;

    update public.pf_commitments
    set
        status = case
            when status = 'cancelled'
                then 'cancelled'
            when settled_value >= total_value - 0.005
                then 'settled'
            when settled_value > 0
                then 'partial'
            else 'pending'
        end,
        updated_at = now()
    where id = selected_commitment_id;

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

drop trigger if exists
pf_refresh_commitment_status_trigger
on public.pf_commitment_settlements;

create trigger pf_refresh_commitment_status_trigger
after insert or update or delete
on public.pf_commitment_settlements
for each row
execute function public.pf_refresh_commitment_status();

create or replace view public.pf_commitment_progress
with (security_invoker = true)
as
select
    commitment.id,
    commitment.household_id,
    commitment.created_by,
    commitment.responsible_user_id,
    commitment.visibility_scope,
    commitment.direction,
    commitment.counterparty,
    commitment.description,
    commitment.category_id,
    commitment.default_account_id,
    commitment.linked_debt_id,
    commitment.total_amount,
    commitment.issued_on,
    commitment.due_date,
    commitment.status as stored_status,
    commitment.source,
    commitment.notes,
    commitment.metadata,
    commitment.created_at,
    commitment.updated_at,

    coalesce(
        settlement_summary.settled_amount,
        0
    )::numeric(14, 2) as settled_amount,

    greatest(
        commitment.total_amount
        - coalesce(
            settlement_summary.settled_amount,
            0
        ),
        0
    )::numeric(14, 2) as remaining_amount,

    case
        when commitment.status = 'cancelled'
            then 'cancelled'
        when coalesce(
            settlement_summary.settled_amount,
            0
        ) >= commitment.total_amount - 0.005
            then 'settled'
        when commitment.due_date < current_date
             and coalesce(
                 settlement_summary.settled_amount,
                 0
             ) < commitment.total_amount - 0.005
            then 'overdue'
        when coalesce(
            settlement_summary.settled_amount,
            0
        ) > 0
            then 'partial'
        else 'pending'
    end as computed_status,

    case
        when commitment.total_amount <= 0
            then 0
        else round(
            least(
                100,
                coalesce(
                    settlement_summary.settled_amount,
                    0
                )
                / commitment.total_amount
                * 100
            ),
            2
        )
    end as progress_percentage

from public.pf_commitments commitment
left join lateral (
    select
        sum(settlement.amount) as settled_amount
    from public.pf_commitment_settlements settlement
    where settlement.commitment_id = commitment.id
) settlement_summary on true;

revoke all
on public.pf_commitment_progress
from anon;

grant select
on public.pf_commitment_progress
to authenticated;

-- ---------------------------------------------------------
-- 3. RPCS SEGURAS
-- ---------------------------------------------------------

create or replace function public.pf_create_commitment(
    target_household_id uuid,
    commitment_direction text,
    commitment_counterparty text,
    commitment_description text,
    commitment_total_amount numeric,
    commitment_due_date date default null,
    commitment_category_id uuid default null,
    commitment_default_account_id uuid default null,
    commitment_responsible_user_id uuid default null,
    commitment_visibility_scope text default 'family',
    commitment_notes text default null,
    commitment_source text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    created_commitment_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if not public.pf_can_write(
        target_household_id
    ) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    if commitment_direction not in (
        'payable',
        'receivable'
    ) then
        raise exception 'A direção do compromisso é inválida.';
    end if;

    if commitment_total_amount is null
       or commitment_total_amount <= 0 then
        raise exception 'O valor total precisa ser maior que zero.';
    end if;

    if nullif(
        trim(commitment_counterparty),
        ''
    ) is null then
        raise exception 'Informe a contraparte.';
    end if;

    if nullif(
        trim(commitment_description),
        ''
    ) is null then
        raise exception 'Informe a descrição.';
    end if;

    insert into public.pf_commitments (
        household_id,
        created_by,
        responsible_user_id,
        visibility_scope,
        direction,
        counterparty,
        description,
        category_id,
        default_account_id,
        total_amount,
        due_date,
        source,
        notes,
        metadata
    )
    values (
        target_household_id,
        current_user_id,
        coalesce(
            commitment_responsible_user_id,
            current_user_id
        ),
        commitment_visibility_scope,
        commitment_direction,
        trim(commitment_counterparty),
        trim(commitment_description),
        commitment_category_id,
        commitment_default_account_id,
        commitment_total_amount,
        commitment_due_date,
        coalesce(
            nullif(trim(commitment_source), ''),
            'manual'
        ),
        nullif(
            trim(commitment_notes),
            ''
        ),
        jsonb_build_object(
            'origin',
            coalesce(
                nullif(trim(commitment_source), ''),
                'manual'
            )
        )
    )
    returning id
    into created_commitment_id;

    return created_commitment_id;
end;
$$;

create or replace function public.pf_register_commitment_settlement(
    target_commitment_id uuid,
    target_account_id uuid,
    settlement_amount numeric,
    settlement_date date default current_date,
    settlement_notes text default null,
    settlement_source text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_commitment public.pf_commitments%rowtype;
    settled_before numeric;
    remaining_before numeric;
    created_transaction_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if settlement_amount is null
       or settlement_amount <= 0 then
        raise exception 'O valor precisa ser maior que zero.';
    end if;

    select *
    into selected_commitment
    from public.pf_commitments commitment
    where commitment.id = target_commitment_id
    for update;

    if not found then
        raise exception 'Compromisso não encontrado.';
    end if;

    if not public.pf_can_write(
        selected_commitment.household_id
    ) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    if selected_commitment.status = 'cancelled' then
        raise exception 'O compromisso está cancelado.';
    end if;

    if not exists (
        select 1
        from public.pf_accounts account
        where account.id = target_account_id
          and account.household_id = selected_commitment.household_id
          and account.is_active = true
    ) then
        raise exception 'Conta não encontrada ou inativa.';
    end if;

    select coalesce(
        sum(settlement.amount),
        0
    )
    into settled_before
    from public.pf_commitment_settlements settlement
    where settlement.commitment_id = selected_commitment.id;

    remaining_before := greatest(
        selected_commitment.total_amount - settled_before,
        0
    );

    if settlement_amount > remaining_before + 0.005 then
        raise exception
            'O valor não pode ser maior que o saldo restante de %.',
            remaining_before;
    end if;

    insert into public.pf_transactions (
        household_id,
        account_id,
        category_id,
        created_by,
        responsible_user_id,
        type,
        status,
        description,
        merchant,
        amount,
        original_amount,
        occurred_on,
        due_date,
        paid_at,
        source,
        notes,
        metadata
    )
    values (
        selected_commitment.household_id,
        target_account_id,
        selected_commitment.category_id,
        current_user_id,
        coalesce(
            selected_commitment.responsible_user_id,
            current_user_id
        ),
        case
            when selected_commitment.direction = 'payable'
                then 'expense'
            else 'income'
        end,
        'paid',
        case
            when selected_commitment.direction = 'payable'
                then 'Pagamento parcial - '
            else 'Recebimento parcial - '
        end || selected_commitment.description,
        selected_commitment.counterparty,
        settlement_amount,
        settlement_amount,
        coalesce(
            settlement_date,
            current_date
        ),
        selected_commitment.due_date,
        (
            coalesce(
                settlement_date,
                current_date
            )::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        coalesce(
            nullif(trim(settlement_source), ''),
            'manual'
        ),
        nullif(
            trim(settlement_notes),
            ''
        ),
        jsonb_build_object(
            'origin',
            coalesce(
                nullif(trim(settlement_source), ''),
                'manual'
            ),
            'commitment_id',
            selected_commitment.id,
            'commitment_direction',
            selected_commitment.direction,
            'partial_settlement',
            settlement_amount < remaining_before - 0.005
        )
    )
    returning id
    into created_transaction_id;

    insert into public.pf_commitment_settlements (
        household_id,
        commitment_id,
        transaction_id,
        account_id,
        amount,
        settled_on,
        notes,
        created_by
    )
    values (
        selected_commitment.household_id,
        selected_commitment.id,
        created_transaction_id,
        target_account_id,
        settlement_amount,
        coalesce(
            settlement_date,
            current_date
        ),
        nullif(
            trim(settlement_notes),
            ''
        ),
        current_user_id
    );

    return created_transaction_id;
end;
$$;

revoke all
on function public.pf_create_commitment(
    uuid,
    text,
    text,
    text,
    numeric,
    date,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
)
from public, anon;

grant execute
on function public.pf_create_commitment(
    uuid,
    text,
    text,
    text,
    numeric,
    date,
    uuid,
    uuid,
    uuid,
    text,
    text,
    text
)
to authenticated;

revoke all
on function public.pf_register_commitment_settlement(
    uuid,
    uuid,
    numeric,
    date,
    text,
    text
)
from public, anon;

grant execute
on function public.pf_register_commitment_settlement(
    uuid,
    uuid,
    numeric,
    date,
    text,
    text
)
to authenticated;

-- ---------------------------------------------------------
-- 4. RLS, AUDITORIA E GRANTS
-- ---------------------------------------------------------

alter table public.pf_commitments
    enable row level security;

alter table public.pf_commitment_settlements
    enable row level security;

revoke all
on public.pf_commitments,
   public.pf_commitment_settlements
from anon;

grant select, insert, update, delete
on public.pf_commitments,
   public.pf_commitment_settlements
to authenticated;

do $$
declare
    selected_table text;
    selected_policy record;
begin
    foreach selected_table in array array[
        'pf_commitments',
        'pf_commitment_settlements'
    ]
    loop
        for selected_policy in
            select policyname
            from pg_policies
            where schemaname = 'public'
              and tablename = selected_table
        loop
            execute format(
                'drop policy if exists %I on public.%I',
                selected_policy.policyname,
                selected_table
            );
        end loop;

        execute format(
            'create policy pf_member_read
             on public.%I
             for select
             to authenticated
             using (
                 (select public.pf_is_member(household_id))
             )',
            selected_table
        );

        execute format(
            'create policy pf_admin_insert
             on public.%I
             for insert
             to authenticated
             with check (
                 (select public.pf_can_write(household_id))
             )',
            selected_table
        );

        execute format(
            'create policy pf_admin_update
             on public.%I
             for update
             to authenticated
             using (
                 (select public.pf_can_write(household_id))
             )
             with check (
                 (select public.pf_can_write(household_id))
             )',
            selected_table
        );

        execute format(
            'create policy pf_admin_delete
             on public.%I
             for delete
             to authenticated
             using (
                 (select public.pf_can_write(household_id))
             )',
            selected_table
        );
    end loop;
end;
$$;

do $$
declare
    selected_table text;
begin
    foreach selected_table in array array[
        'pf_commitments',
        'pf_commitment_settlements'
    ]
    loop
        if to_regprocedure(
            'public.pf_capture_audit()'
        ) is not null then
            execute format(
                'drop trigger if exists pf_audit_changes_trigger on public.%I',
                selected_table
            );

            execute format(
                'create trigger pf_audit_changes_trigger
                 after insert or update or delete
                 on public.%I
                 for each row
                 execute function public.pf_capture_audit()',
                selected_table
            );
        end if;
    end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
