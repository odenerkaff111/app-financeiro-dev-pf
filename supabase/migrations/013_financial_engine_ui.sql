begin;

-- =========================================================
-- PARTE 2B — INTERFACE E OPERAÇÃO DO MOTOR FINANCEIRO
-- Outras dívidas, juros materializados e compromissos parciais.
-- =========================================================

alter table public.pf_debts
    add column if not exists debt_kind text not null default 'other',
    add column if not exists interest_accrued_through date,
    add column if not exists penalty_applied boolean not null default false;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_kind_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_kind_valid
            check (
                debt_kind in (
                    'bank_loan',
                    'financing',
                    'retail',
                    'credit_card',
                    'tax',
                    'bill',
                    'other'
                )
            );
    end if;
end;
$$;

update public.pf_debts
set debt_kind = case
    when debt_group = 'personal' then 'other'
    when type = 'credit_card' then 'credit_card'
    when type = 'financing' then 'financing'
    when type = 'tax' then 'tax'
    else coalesce(nullif(debt_kind, ''), 'other')
end;

-- A função continua SECURITY INVOKER. O acesso é protegido pelo RLS
-- da tabela pf_debts e pela view security_invoker.

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

    penalty_already_projected := coalesce(
        selected_debt.penalty_applied,
        false
    );

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
                ),
                coalesce(
                    selected_debt.interest_accrued_through,
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

                        if selected_debt.interest_method = 'compound' then
                            working_balance := working_balance + base_interest;
                        end if;

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

                    if selected_debt.interest_method = 'compound' then
                        working_balance := working_balance + base_interest;
                    end if;

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
            ),
            coalesce(
                selected_debt.interest_accrued_through,
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

                    if selected_debt.interest_method = 'compound' then
                        working_balance := working_balance + base_interest;
                    end if;

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

                if selected_debt.interest_method = 'compound' then
                    working_balance := working_balance + base_interest;
                end if;

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
            working_balance
            + case
                when selected_debt.interest_method = 'simple'
                    then calculated_interest
                else 0
              end
            + calculated_late_interest,
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

drop view if exists public.pf_debt_positions;

create view public.pf_debt_positions
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
    debt.debt_kind,
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
    debt.interest_accrued_through,
    debt.penalty_rate,
    debt.penalty_applied,
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
from public, anon;

grant select
on public.pf_debt_positions
to authenticated;

create or replace function public.pf_create_other_debt(
    target_household_id uuid,
    debt_creditor text,
    debt_description text,
    debt_original_amount numeric,
    debt_kind text default 'other',
    debt_start_date date default current_date,
    debt_due_date date default null,
    debt_installment_amount numeric default null,
    debt_total_installments integer default null,
    debt_interest_enabled boolean default false,
    debt_auto_accrue_interest boolean default false,
    debt_interest_rate numeric default 0,
    debt_interest_period text default 'monthly',
    debt_interest_method text default 'simple',
    debt_penalty_rate numeric default 0,
    debt_daily_late_interest_rate numeric default 0,
    debt_grace_period_days integer default 0,
    debt_responsible_user_id uuid default null,
    debt_visibility_scope text default 'family'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    created_debt_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if not public.pf_can_write(target_household_id) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    if nullif(trim(debt_creditor), '') is null then
        raise exception 'Informe o credor.';
    end if;

    if nullif(trim(debt_description), '') is null then
        raise exception 'Informe a descrição.';
    end if;

    if debt_original_amount is null
       or debt_original_amount <= 0 then
        raise exception 'O valor original precisa ser maior que zero.';
    end if;

    if debt_kind not in (
        'bank_loan',
        'financing',
        'retail',
        'credit_card',
        'tax',
        'bill',
        'other'
    ) then
        raise exception 'O tipo da dívida é inválido.';
    end if;

    if debt_interest_period not in (
        'daily',
        'monthly',
        'yearly'
    ) then
        raise exception 'A periodicidade dos juros é inválida.';
    end if;

    if debt_interest_method not in (
        'simple',
        'compound'
    ) then
        raise exception 'O método de juros é inválido.';
    end if;

    if coalesce(debt_interest_rate, 0) < 0
       or coalesce(debt_penalty_rate, 0) < 0
       or coalesce(debt_daily_late_interest_rate, 0) < 0 then
        raise exception 'As taxas não podem ser negativas.';
    end if;

    if coalesce(debt_grace_period_days, 0) < 0 then
        raise exception 'A carência não pode ser negativa.';
    end if;

    insert into public.pf_debts (
        household_id,
        created_by,
        responsible_user_id,
        visibility_scope,
        creditor,
        description,
        type,
        debt_group,
        debt_kind,
        original_amount,
        current_balance,
        installment_amount,
        total_installments,
        paid_installments,
        monthly_interest_rate,
        penalty_rate,
        daily_late_interest_rate,
        interest_free,
        interest_enabled,
        auto_accrue_interest,
        interest_rate,
        interest_period,
        interest_method,
        interest_start_date,
        interest_accrued_through,
        penalty_applied,
        grace_period_days,
        start_date,
        due_date,
        status
    )
    values (
        target_household_id,
        current_user_id,
        coalesce(debt_responsible_user_id, current_user_id),
        coalesce(nullif(trim(debt_visibility_scope), ''), 'family'),
        trim(debt_creditor),
        trim(debt_description),
        'informal',
        'other',
        debt_kind,
        debt_original_amount,
        debt_original_amount,
        case
            when debt_installment_amount is null
                 or debt_installment_amount <= 0
                then null
            else debt_installment_amount
        end,
        case
            when debt_total_installments is null
                 or debt_total_installments <= 0
                then null
            else debt_total_installments
        end,
        0,
        case
            when debt_interest_period = 'monthly'
                then coalesce(debt_interest_rate, 0)
            else 0
        end,
        coalesce(debt_penalty_rate, 0),
        coalesce(debt_daily_late_interest_rate, 0),
        not (
            coalesce(debt_interest_rate, 0) > 0
            or coalesce(debt_penalty_rate, 0) > 0
            or coalesce(debt_daily_late_interest_rate, 0) > 0
        ),
        coalesce(debt_interest_enabled, false),
        coalesce(debt_interest_enabled, false)
            and coalesce(debt_auto_accrue_interest, false),
        case
            when coalesce(debt_interest_enabled, false)
                then coalesce(debt_interest_rate, 0)
            else 0
        end,
        debt_interest_period,
        debt_interest_method,
        coalesce(debt_start_date, current_date),
        null,
        false,
        coalesce(debt_grace_period_days, 0),
        coalesce(debt_start_date, current_date),
        debt_due_date,
        'active'
    )
    returning id
    into created_debt_id;

    return created_debt_id;
end;
$$;

-- Materializa os juros projetados na data do pagamento antes de abater
-- o valor. Assim, os próximos cálculos começam da última capitalização
-- e não contam os mesmos juros duas vezes.

create or replace function public.pf_register_debt_payment(
    target_debt_id uuid,
    target_account_id uuid,
    payment_amount numeric,
    payment_date date default current_date,
    count_installment boolean default true,
    payment_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_debt public.pf_debts%rowtype;
    selected_account public.pf_accounts%rowtype;
    selected_position record;
    effective_payment_date date;
    created_transaction_id uuid;
    capitalized_interest numeric := 0;
    capitalized_penalty numeric := 0;
begin
    current_user_id := auth.uid();
    effective_payment_date := coalesce(payment_date, current_date);

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if payment_amount is null or payment_amount <= 0 then
        raise exception 'O valor do pagamento precisa ser maior que zero.';
    end if;

    select *
    into selected_debt
    from public.pf_debts
    where id = target_debt_id
    for update;

    if not found then
        raise exception 'Dívida não encontrada.';
    end if;

    if not public.pf_can_write(selected_debt.household_id) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    if selected_debt.status in ('paid', 'cancelled') then
        raise exception 'Esta dívida não aceita novos pagamentos.';
    end if;

    select *
    into selected_position
    from public.pf_calculate_debt_position(
        selected_debt.id,
        effective_payment_date
    );

    if payment_amount > selected_position.projected_balance + 0.005 then
        raise exception
            'O pagamento não pode ser maior que o saldo atualizado de %.',
            selected_position.projected_balance;
    end if;

    select *
    into selected_account
    from public.pf_accounts
    where id = target_account_id
      and household_id = selected_debt.household_id
      and is_active = true;

    if not found then
        raise exception 'Conta de pagamento não encontrada ou inativa.';
    end if;

    capitalized_interest := round(
        greatest(
            coalesce(selected_position.accrued_interest, 0)
            + coalesce(selected_position.projected_late_interest, 0),
            0
        ),
        2
    );

    capitalized_penalty := round(
        greatest(
            coalesce(selected_position.projected_penalty, 0),
            0
        ),
        2
    );

    if capitalized_interest > 0.005 then
        insert into public.pf_debt_movements (
            household_id,
            debt_id,
            movement_type,
            amount,
            occurred_on,
            notes,
            created_by
        )
        values (
            selected_debt.household_id,
            selected_debt.id,
            'interest',
            capitalized_interest,
            effective_payment_date,
            'Juros capitalizados automaticamente até o pagamento',
            current_user_id
        );
    end if;

    if capitalized_penalty > 0.005 then
        insert into public.pf_debt_movements (
            household_id,
            debt_id,
            movement_type,
            amount,
            occurred_on,
            notes,
            created_by
        )
        values (
            selected_debt.household_id,
            selected_debt.id,
            'fee',
            capitalized_penalty,
            effective_payment_date,
            'Multa capitalizada automaticamente no pagamento',
            current_user_id
        );
    end if;

    if capitalized_interest > 0.005
       or capitalized_penalty > 0.005 then
        update public.pf_debts
        set
            interest_accrued_through = case
                when capitalized_interest > 0.005
                    then effective_payment_date
                else interest_accrued_through
            end,
            penalty_applied = penalty_applied
                or capitalized_penalty > 0.005,
            updated_at = now()
        where id = selected_debt.id;
    end if;

    insert into public.pf_transactions (
        household_id,
        account_id,
        debt_id,
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
        selected_debt.household_id,
        target_account_id,
        selected_debt.id,
        current_user_id,
        current_user_id,
        'debt_payment',
        'paid',
        'Pagamento de dívida - ' || selected_debt.creditor,
        selected_debt.creditor,
        payment_amount,
        payment_amount,
        effective_payment_date,
        effective_payment_date,
        (
            effective_payment_date::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        'manual',
        nullif(trim(payment_notes), ''),
        jsonb_build_object(
            'origin',
            'debt_module',
            'count_installment',
            count_installment,
            'capitalized_interest',
            capitalized_interest,
            'capitalized_penalty',
            capitalized_penalty
        )
    )
    returning id
    into created_transaction_id;

    insert into public.pf_debt_movements (
        household_id,
        debt_id,
        transaction_id,
        movement_type,
        amount,
        occurred_on,
        notes,
        created_by
    )
    values (
        selected_debt.household_id,
        selected_debt.id,
        created_transaction_id,
        'payment',
        payment_amount,
        effective_payment_date,
        coalesce(
            nullif(trim(payment_notes), ''),
            'Pagamento registrado pelo módulo de dívidas'
        ),
        current_user_id
    );

    update public.pf_debts
    set
        paid_installments = case
            when count_installment
                 and total_installments is not null
                then least(
                    paid_installments + 1,
                    total_installments
                )
            else paid_installments
        end,
        status = case
            when current_balance <= 0.005
                then 'paid'
            else status
        end,
        updated_at = now()
    where id = selected_debt.id;

    return created_transaction_id;
end;
$$;

revoke all
on function public.pf_create_other_debt(
    uuid,
    text,
    text,
    numeric,
    text,
    date,
    date,
    numeric,
    integer,
    boolean,
    boolean,
    numeric,
    text,
    text,
    numeric,
    numeric,
    integer,
    uuid,
    text
)
from public, anon;

grant execute
on function public.pf_create_other_debt(
    uuid,
    text,
    text,
    numeric,
    text,
    date,
    date,
    numeric,
    integer,
    boolean,
    boolean,
    numeric,
    text,
    text,
    numeric,
    numeric,
    integer,
    uuid,
    text
)
to authenticated;

revoke all
on function public.pf_register_debt_payment(
    uuid,
    uuid,
    numeric,
    date,
    boolean,
    text
)
from public, anon;

grant execute
on function public.pf_register_debt_payment(
    uuid,
    uuid,
    numeric,
    date,
    boolean,
    text
)
to authenticated;

commit;

notify pgrst, 'reload schema';
