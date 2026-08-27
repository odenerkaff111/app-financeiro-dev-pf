begin;

-- =========================================================
-- DASHBOARD PESSOAL — OBRIGAÇÕES, INVESTIMENTOS E CUSTO DE VIDA
-- =========================================================

-- ---------------------------------------------------------
-- 1. CATEGORIAS ESSENCIAIS E CUSTO DE VIDA
-- ---------------------------------------------------------

alter table public.pf_categories
    add column if not exists is_essential boolean not null default false;

update public.pf_categories
set is_essential = true
where is_essential = false
  and translate(
        lower(name),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ) similar to '%(aluguel|moradia|condominio|agua|energia|luz|internet|telefone|escola|educacao|mensalidade escolar|saude|farmacia|mercado|supermercado|alimentacao|transporte|combustivel|seguro|financiamento do carro)%';

create or replace view public.pf_cost_of_living_monthly
with (security_invoker = true)
as
select
    transaction.household_id,
    date_trunc('month', transaction.occurred_on)::date as reference_month,
    round(sum(transaction.amount), 2)::numeric(14, 2) as essential_amount
from public.pf_transactions transaction
join public.pf_categories category
  on category.id = transaction.category_id
 and category.household_id = transaction.household_id
where transaction.status = 'paid'
  and transaction.type in ('expense', 'debt_payment')
  and category.is_essential = true
  and transaction.occurred_on >= (date_trunc('month', current_date) - interval '5 months')::date
group by
    transaction.household_id,
    date_trunc('month', transaction.occurred_on)::date;

create or replace view public.pf_cost_of_living_summary
with (security_invoker = true)
as
select
    monthly.household_id,
    count(*)::integer as observed_months,
    round(avg(monthly.essential_amount), 2)::numeric(14, 2) as average_monthly_cost,
    round(sum(monthly.essential_amount), 2)::numeric(14, 2) as observed_total,
    min(monthly.reference_month) as first_month,
    max(monthly.reference_month) as last_month
from public.pf_cost_of_living_monthly monthly
group by monthly.household_id;

create or replace view public.pf_cost_of_living_breakdown
with (security_invoker = true)
as
with category_monthly as (
    select
        transaction.household_id,
        category.id as category_id,
        category.name as category_name,
        date_trunc('month', transaction.occurred_on)::date as reference_month,
        sum(transaction.amount)::numeric as month_amount
    from public.pf_transactions transaction
    join public.pf_categories category
      on category.id = transaction.category_id
     and category.household_id = transaction.household_id
    where transaction.status = 'paid'
      and transaction.type in ('expense', 'debt_payment')
      and category.is_essential = true
      and transaction.occurred_on >= (date_trunc('month', current_date) - interval '5 months')::date
    group by
        transaction.household_id,
        category.id,
        category.name,
        date_trunc('month', transaction.occurred_on)::date
)
select
    category_monthly.household_id,
    category_monthly.category_id,
    category_monthly.category_name,
    count(*)::integer as observed_months,
    round(avg(category_monthly.month_amount), 2)::numeric(14, 2) as average_monthly_amount
from category_monthly
group by
    category_monthly.household_id,
    category_monthly.category_id,
    category_monthly.category_name;

-- ---------------------------------------------------------
-- 2. INVESTIMENTOS E HISTÓRICO DE VALORAÇÃO
-- ---------------------------------------------------------

alter table public.pf_accounts
    add column if not exists investment_cost_basis numeric(14, 2) not null default 0,
    add column if not exists investment_asset_type text,
    add column if not exists investment_started_on date,
    add column if not exists investment_last_valued_at timestamptz;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_accounts_investment_cost_basis_nonnegative'
    ) then
        alter table public.pf_accounts
            add constraint pf_accounts_investment_cost_basis_nonnegative
            check (investment_cost_basis >= 0);
    end if;
end;
$$;

create table if not exists public.pf_investment_snapshots (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,
    account_id uuid not null
        references public.pf_accounts(id)
        on delete cascade,
    snapshot_date date not null default current_date,
    market_value numeric(14, 2) not null
        check (market_value >= 0),
    cost_basis numeric(14, 2) not null default 0
        check (cost_basis >= 0),
    source text not null default 'automatic',
    created_by uuid default auth.uid()
        references auth.users(id)
        on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (account_id, snapshot_date)
);

create index if not exists
pf_investment_snapshots_household_date_idx
on public.pf_investment_snapshots (
    household_id,
    snapshot_date desc
);

create or replace function public.pf_investment_cost_basis_for_account(
    target_account_id uuid
)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
    select greatest(
        coalesce(account.investment_cost_basis, 0)
        + coalesce((
            select sum(
                case
                    when transaction.type = 'investment_contribution'
                         and transaction.destination_account_id = account.id
                        then transaction.amount
                    when transaction.type = 'investment_withdrawal'
                         and transaction.account_id = account.id
                        then -transaction.amount
                    else 0
                end
            )
            from public.pf_transactions transaction
            where transaction.household_id = account.household_id
              and transaction.status = 'paid'
              and (
                  (
                      transaction.type = 'investment_contribution'
                      and transaction.destination_account_id = account.id
                  )
                  or (
                      transaction.type = 'investment_withdrawal'
                      and transaction.account_id = account.id
                  )
              )
        ), 0),
        0
    )::numeric
    from public.pf_accounts account
    where account.id = target_account_id;
$$;

create or replace function public.pf_capture_investment_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    selected_cost_basis numeric;
begin
    if new.type <> 'investment' then
        return new;
    end if;

    selected_cost_basis := coalesce(
        public.pf_investment_cost_basis_for_account(new.id),
        new.investment_cost_basis,
        0
    );

    insert into public.pf_investment_snapshots (
        household_id,
        account_id,
        snapshot_date,
        market_value,
        cost_basis,
        source,
        created_by,
        updated_at
    )
    values (
        new.household_id,
        new.id,
        current_date,
        greatest(coalesce(new.balance, 0), 0),
        greatest(selected_cost_basis, 0),
        'account_balance',
        auth.uid(),
        now()
    )
    on conflict (account_id, snapshot_date)
    do update set
        household_id = excluded.household_id,
        market_value = excluded.market_value,
        cost_basis = excluded.cost_basis,
        source = excluded.source,
        updated_at = now();

    return new;
end;
$$;

drop trigger if exists
pf_capture_investment_snapshot_trigger
on public.pf_accounts;

create trigger pf_capture_investment_snapshot_trigger
after insert or update of balance, investment_cost_basis, investment_asset_type
on public.pf_accounts
for each row
execute function public.pf_capture_investment_snapshot();

insert into public.pf_investment_snapshots (
    household_id,
    account_id,
    snapshot_date,
    market_value,
    cost_basis,
    source,
    created_by
)
select
    account.household_id,
    account.id,
    current_date,
    greatest(coalesce(account.balance, 0), 0),
    greatest(
        coalesce(
            public.pf_investment_cost_basis_for_account(account.id),
            0
        ),
        0
    ),
    'migration',
    account.owner_user_id
from public.pf_accounts account
where account.type = 'investment'
on conflict (account_id, snapshot_date)
do nothing;

create or replace view public.pf_investment_positions
with (security_invoker = true)
as
select
    account.id,
    account.household_id,
    account.name,
    account.institution_name,
    account.investment_asset_type,
    account.investment_started_on,
    account.investment_last_valued_at,
    account.is_active,
    round(greatest(coalesce(account.balance, 0), 0), 2)::numeric(14, 2) as current_value,
    round(greatest(coalesce(basis.cost_basis, 0), 0), 2)::numeric(14, 2) as cost_basis,
    case
        when coalesce(basis.cost_basis, 0) <= 0 then null
        else round(
            greatest(coalesce(account.balance, 0), 0)
            - basis.cost_basis,
            2
        )::numeric(14, 2)
    end as estimated_return,
    case
        when coalesce(basis.cost_basis, 0) <= 0 then null
        else round(
            (
                greatest(coalesce(account.balance, 0), 0)
                - basis.cost_basis
            ) / basis.cost_basis * 100,
            2
        )
    end as estimated_return_percentage
from public.pf_accounts account
left join lateral (
    select public.pf_investment_cost_basis_for_account(account.id) as cost_basis
) basis on true
where account.type = 'investment';

-- ---------------------------------------------------------
-- 3. LIQUIDAÇÃO PARCIAL DE MOVIMENTAÇÕES PLANEJADAS
-- ---------------------------------------------------------

create table if not exists public.pf_transaction_settlements (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,
    planned_transaction_id uuid not null
        references public.pf_transactions(id)
        on delete cascade,
    settlement_transaction_id uuid not null
        references public.pf_transactions(id)
        on delete cascade,
    account_id uuid not null
        references public.pf_accounts(id)
        on delete restrict,
    amount numeric(14, 2) not null
        check (amount > 0),
    settled_on date not null default current_date,
    notes text,
    created_by uuid not null default auth.uid()
        references auth.users(id)
        on delete restrict,
    created_at timestamptz not null default now(),
    unique (settlement_transaction_id)
);

create index if not exists
pf_transaction_settlements_planned_idx
on public.pf_transaction_settlements (
    planned_transaction_id,
    settled_on,
    created_at
);

create or replace function public.pf_register_pending_transaction_settlement(
    target_transaction_id uuid,
    target_account_id uuid,
    settlement_amount numeric,
    settlement_date date default current_date,
    settlement_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_transaction public.pf_transactions%rowtype;
    selected_account public.pf_accounts%rowtype;
    remaining_after numeric;
    created_transaction_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if settlement_amount is null or settlement_amount <= 0 then
        raise exception 'O valor precisa ser maior que zero.';
    end if;

    select *
    into selected_transaction
    from public.pf_transactions transaction
    where transaction.id = target_transaction_id
    for update;

    if not found then
        raise exception 'Movimentação planejada não encontrada.';
    end if;

    if not public.pf_can_write(selected_transaction.household_id) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    if selected_transaction.status not in ('planned', 'overdue') then
        raise exception 'A movimentação não está pendente.';
    end if;

    if selected_transaction.type not in ('income', 'expense') then
        raise exception 'Somente receitas e despesas pendentes podem ser liquidadas por este fluxo.';
    end if;

    if settlement_amount > selected_transaction.amount + 0.005 then
        raise exception
            'O valor não pode ser maior que o saldo restante de %.',
            selected_transaction.amount;
    end if;

    select *
    into selected_account
    from public.pf_accounts account
    where account.id = target_account_id
      and account.household_id = selected_transaction.household_id
      and account.is_active = true;

    if not found then
        raise exception 'Conta não encontrada ou inativa.';
    end if;

    remaining_after := greatest(
        selected_transaction.amount - settlement_amount,
        0
    );

    insert into public.pf_transactions (
        household_id,
        account_id,
        destination_account_id,
        category_id,
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
        selected_transaction.household_id,
        target_account_id,
        null,
        selected_transaction.category_id,
        selected_transaction.debt_id,
        current_user_id,
        coalesce(
            selected_transaction.responsible_user_id,
            current_user_id
        ),
        selected_transaction.type,
        'paid',
        case
            when selected_transaction.type = 'income'
                then 'Recebimento - '
            else 'Pagamento - '
        end || selected_transaction.description,
        selected_transaction.merchant,
        settlement_amount,
        settlement_amount,
        coalesce(settlement_date, current_date),
        selected_transaction.due_date,
        (
            coalesce(settlement_date, current_date)::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        'manual',
        nullif(trim(settlement_notes), ''),
        jsonb_build_object(
            'origin', 'dashboard_obligation_settlement',
            'planned_transaction_id', selected_transaction.id,
            'partial_settlement', remaining_after > 0.005
        )
    )
    returning id into created_transaction_id;

    insert into public.pf_transaction_settlements (
        household_id,
        planned_transaction_id,
        settlement_transaction_id,
        account_id,
        amount,
        settled_on,
        notes,
        created_by
    )
    values (
        selected_transaction.household_id,
        selected_transaction.id,
        created_transaction_id,
        target_account_id,
        settlement_amount,
        coalesce(settlement_date, current_date),
        nullif(trim(settlement_notes), ''),
        current_user_id
    );

    update public.pf_transactions
    set
        amount = case
            when remaining_after <= 0.005 then selected_transaction.amount
            else remaining_after
        end,
        status = case
            when remaining_after <= 0.005 then 'cancelled'
            else status
        end,
        metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object(
                'settlement_completed', remaining_after <= 0.005,
                'remaining_amount', remaining_after,
                'last_settlement_transaction_id', created_transaction_id
            ),
        updated_at = now()
    where id = selected_transaction.id;

    return created_transaction_id;
end;
$$;

create or replace view public.pf_upcoming_obligations
with (security_invoker = true)
as
select
    'commitment'::text as source_type,
    commitment.id as source_id,
    commitment.household_id,
    commitment.direction,
    commitment.counterparty,
    commitment.description,
    commitment.total_amount,
    commitment.settled_amount,
    commitment.remaining_amount,
    commitment.due_date,
    commitment.computed_status,
    commitment.default_account_id,
    commitment.category_id,
    commitment.source,
    commitment.notes,
    commitment.created_at
from public.pf_commitment_progress commitment
where commitment.computed_status not in ('settled', 'cancelled')
  and commitment.remaining_amount > 0.005

union all

select
    'transaction'::text as source_type,
    transaction.id as source_id,
    transaction.household_id,
    case
        when transaction.type = 'income' then 'receivable'
        else 'payable'
    end as direction,
    coalesce(transaction.merchant, transaction.description) as counterparty,
    transaction.description,
    coalesce(transaction.original_amount, transaction.amount) as total_amount,
    greatest(
        coalesce(transaction.original_amount, transaction.amount)
        - transaction.amount,
        0
    ) as settled_amount,
    transaction.amount as remaining_amount,
    transaction.due_date,
    case
        when transaction.due_date < current_date then 'overdue'
        else 'pending'
    end as computed_status,
    transaction.account_id as default_account_id,
    transaction.category_id,
    transaction.source,
    transaction.notes,
    transaction.created_at
from public.pf_transactions transaction
where transaction.status in ('planned', 'overdue')
  and transaction.type in ('income', 'expense')
  and transaction.amount > 0.005;

-- ---------------------------------------------------------
-- 4. RLS, GRANTS E AUDITORIA
-- ---------------------------------------------------------

alter table public.pf_investment_snapshots enable row level security;
alter table public.pf_transaction_settlements enable row level security;

revoke all on public.pf_investment_snapshots from anon;
revoke all on public.pf_transaction_settlements from anon;

grant select on public.pf_investment_snapshots to authenticated;
grant select on public.pf_transaction_settlements to authenticated;

drop policy if exists pf_investment_snapshots_read on public.pf_investment_snapshots;
create policy pf_investment_snapshots_read
on public.pf_investment_snapshots
for select
to authenticated
using ((select public.pf_is_member(household_id)));

drop policy if exists pf_transaction_settlements_read on public.pf_transaction_settlements;
create policy pf_transaction_settlements_read
on public.pf_transaction_settlements
for select
to authenticated
using ((select public.pf_is_member(household_id)));

revoke all
on function public.pf_register_pending_transaction_settlement(
    uuid,
    uuid,
    numeric,
    date,
    text
)
from public, anon;

grant execute
on function public.pf_register_pending_transaction_settlement(
    uuid,
    uuid,
    numeric,
    date,
    text
)
to authenticated;

revoke all
on function public.pf_investment_cost_basis_for_account(uuid)
from public, anon;

grant execute
on function public.pf_investment_cost_basis_for_account(uuid)
to authenticated;

grant select on public.pf_cost_of_living_monthly to authenticated;
grant select on public.pf_cost_of_living_summary to authenticated;
grant select on public.pf_cost_of_living_breakdown to authenticated;
grant select on public.pf_investment_positions to authenticated;
grant select on public.pf_upcoming_obligations to authenticated;

do $$
begin
    if to_regprocedure('public.pf_capture_audit()') is not null then
        drop trigger if exists pf_audit_changes_trigger
        on public.pf_transaction_settlements;

        create trigger pf_audit_changes_trigger
        after insert or update or delete
        on public.pf_transaction_settlements
        for each row
        execute function public.pf_capture_audit();
    end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
