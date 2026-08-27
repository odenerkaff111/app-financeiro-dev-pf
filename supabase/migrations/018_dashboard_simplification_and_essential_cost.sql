begin;

-- =========================================================
-- DASHBOARD ENXUTO + CUSTO DE VIDA EXPLICITAMENTE ESSENCIAL
-- =========================================================

-- A partir desta migration, "essencial" deixa de depender de inferência
-- por nome de categoria e passa a poder ser marcado no próprio registro.
alter table public.pf_commitments
    add column if not exists is_essential boolean not null default false;

alter table public.pf_transactions
    add column if not exists is_essential boolean not null default false;

alter table public.pf_recurring_templates
    add column if not exists is_essential boolean not null default false;

create index if not exists pf_commitments_essential_idx
on public.pf_commitments (household_id, due_date)
where is_essential = true
  and direction = 'payable'
  and status <> 'cancelled';

create index if not exists pf_transactions_essential_idx
on public.pf_transactions (household_id, due_date, occurred_on)
where is_essential = true
  and type = 'expense'
  and status <> 'cancelled';

-- =========================================================
-- CRIA COMPROMISSO COM FLAG DE DESPESA ESSENCIAL
-- Mantemos o RPC anterior intacto para compatibilidade com IA/legado.
-- =========================================================

create or replace function public.pf_create_commitment_with_initial_settlement_v2(
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
    commitment_source text default 'manual',
    commitment_is_essential boolean default false,
    initial_settlement_amount numeric default 0,
    initial_settlement_account_id uuid default null,
    initial_settlement_date date default current_date,
    initial_settlement_notes text default null
)
returns table (
    commitment_id uuid,
    transaction_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    created_commitment_id uuid;
    created_transaction_id uuid;
begin
    select
        result.commitment_id,
        result.transaction_id
    into
        created_commitment_id,
        created_transaction_id
    from public.pf_create_commitment_with_initial_settlement(
        target_household_id,
        commitment_direction,
        commitment_counterparty,
        commitment_description,
        commitment_total_amount,
        commitment_due_date,
        commitment_category_id,
        commitment_default_account_id,
        commitment_responsible_user_id,
        commitment_visibility_scope,
        commitment_notes,
        commitment_source,
        initial_settlement_amount,
        initial_settlement_account_id,
        initial_settlement_date,
        initial_settlement_notes
    ) result;

    update public.pf_commitments
    set
        is_essential = case
            when commitment_direction = 'payable'
                then coalesce(commitment_is_essential, false)
            else false
        end,
        updated_at = now()
    where id = created_commitment_id;

    return query
    select
        created_commitment_id,
        created_transaction_id;
end;
$$;

revoke all
on function public.pf_create_commitment_with_initial_settlement_v2(
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
    text,
    boolean,
    numeric,
    uuid,
    date,
    text
)
from public, anon;

grant execute
on function public.pf_create_commitment_with_initial_settlement_v2(
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
    text,
    boolean,
    numeric,
    uuid,
    date,
    text
)
to authenticated;

-- =========================================================
-- LIQUIDAÇÃO DE MOVIMENTAÇÃO PLANEJADA
-- Propaga a flag essencial para o lançamento efetivamente pago.
-- =========================================================

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
        is_essential,
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
        selected_transaction.is_essential,
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

-- =========================================================
-- PRÓXIMAS OBRIGAÇÕES
-- Expõe a classificação essencial para edição rápida no Dashboard.
-- =========================================================

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
    commitment.created_at,
    source_commitment.is_essential
from public.pf_commitment_progress commitment
join public.pf_commitments source_commitment
  on source_commitment.id = commitment.id
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
    transaction.created_at,
    transaction.is_essential
from public.pf_transactions transaction
where transaction.status in ('planned', 'overdue')
  and transaction.type in ('income', 'expense')
  and transaction.amount > 0.005;

grant select on public.pf_upcoming_obligations to authenticated;

-- =========================================================
-- CUSTO DE VIDA
-- Somente registros explicitamente marcados como essenciais.
-- =========================================================

create or replace view public.pf_cost_of_living_monthly
with (security_invoker = true)
as
with essential_commitments as (
    select
        commitment.household_id,
        date_trunc(
            'month',
            coalesce(commitment.due_date, commitment.issued_on)
        )::date as reference_month,
        commitment.total_amount::numeric as amount
    from public.pf_commitments commitment
    where commitment.direction = 'payable'
      and commitment.is_essential = true
      and commitment.status <> 'cancelled'
      and coalesce(commitment.due_date, commitment.issued_on)
          >= (date_trunc('month', current_date) - interval '5 months')::date
),
essential_transactions as (
    select
        transaction.household_id,
        date_trunc(
            'month',
            coalesce(transaction.due_date, transaction.occurred_on)
        )::date as reference_month,
        transaction.amount::numeric as amount
    from public.pf_transactions transaction
    where transaction.type = 'expense'
      and transaction.is_essential = true
      and transaction.status in ('paid', 'planned', 'overdue')
      and coalesce(transaction.due_date, transaction.occurred_on)
          >= (date_trunc('month', current_date) - interval '5 months')::date
),
combined as (
    select * from essential_commitments
    union all
    select * from essential_transactions
)
select
    combined.household_id,
    combined.reference_month,
    round(sum(combined.amount), 2)::numeric(14, 2) as essential_amount
from combined
group by
    combined.household_id,
    combined.reference_month;

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
with source_monthly as (
    select
        commitment.household_id,
        null::uuid as category_id,
        commitment.description as category_name,
        date_trunc(
            'month',
            coalesce(commitment.due_date, commitment.issued_on)
        )::date as reference_month,
        sum(commitment.total_amount)::numeric as month_amount
    from public.pf_commitments commitment
    where commitment.direction = 'payable'
      and commitment.is_essential = true
      and commitment.status <> 'cancelled'
      and coalesce(commitment.due_date, commitment.issued_on)
          >= (date_trunc('month', current_date) - interval '5 months')::date
    group by
        commitment.household_id,
        commitment.description,
        date_trunc(
            'month',
            coalesce(commitment.due_date, commitment.issued_on)
        )::date

    union all

    select
        transaction.household_id,
        transaction.category_id,
        coalesce(category.name, transaction.description) as category_name,
        date_trunc(
            'month',
            coalesce(transaction.due_date, transaction.occurred_on)
        )::date as reference_month,
        sum(transaction.amount)::numeric as month_amount
    from public.pf_transactions transaction
    left join public.pf_categories category
      on category.id = transaction.category_id
     and category.household_id = transaction.household_id
    where transaction.type = 'expense'
      and transaction.is_essential = true
      and transaction.status in ('paid', 'planned', 'overdue')
      and coalesce(transaction.due_date, transaction.occurred_on)
          >= (date_trunc('month', current_date) - interval '5 months')::date
    group by
        transaction.household_id,
        transaction.category_id,
        coalesce(category.name, transaction.description),
        date_trunc(
            'month',
            coalesce(transaction.due_date, transaction.occurred_on)
        )::date
)
select
    source_monthly.household_id,
    source_monthly.category_id,
    source_monthly.category_name,
    count(*)::integer as observed_months,
    round(avg(source_monthly.month_amount), 2)::numeric(14, 2) as average_monthly_amount
from source_monthly
group by
    source_monthly.household_id,
    source_monthly.category_id,
    source_monthly.category_name;

grant select on public.pf_cost_of_living_monthly to authenticated;
grant select on public.pf_cost_of_living_summary to authenticated;
grant select on public.pf_cost_of_living_breakdown to authenticated;

commit;

notify pgrst, 'reload schema';
