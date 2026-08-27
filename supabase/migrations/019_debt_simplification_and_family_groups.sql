begin;

-- =========================================================
-- DÍVIDAS: SOMENTE PESSOAIS OU OUTRAS DÍVIDAS
-- Mantém o motor existente e simplifica apenas a classificação.
-- =========================================================

create or replace view public.pf_debt_progress
with (security_invoker = true)
as
select
    debt.id,
    debt.household_id,
    debt.created_by,
    debt.creditor,
    debt.description,
    debt.type,
    debt.original_amount,
    debt.current_balance,
    debt.installment_amount,
    debt.total_installments,
    debt.paid_installments,

    case
        when debt.total_installments is null then null
        else greatest(
            debt.total_installments - debt.paid_installments,
            0
        )
    end as remaining_installments,

    debt.monthly_interest_rate,
    debt.penalty_rate,
    debt.daily_late_interest_rate,
    debt.interest_free,
    debt.start_date,
    debt.due_date,
    debt.status,
    debt.linked_account_id,
    debt.import_key,
    debt.created_at,
    debt.updated_at,

    coalesce(movement_summary.paid_amount, 0) as paid_amount,
    coalesce(movement_summary.interest_amount, 0) as interest_amount,
    coalesce(movement_summary.fee_amount, 0) as fee_amount,
    coalesce(movement_summary.discount_amount, 0) as discount_amount,

    case
        when debt.original_amount <= 0 then 0
        else round(
            least(
                100,
                (
                    coalesce(movement_summary.paid_amount, 0)
                    / debt.original_amount
                ) * 100
            ),
            2
        )
    end as progress_percentage,

    -- Campos adicionados ao final para preservar compatibilidade
    -- com as telas antigas que já consultavam esta view.
    debt.debt_group,
    debt.debt_kind,
    debt.interest_enabled,
    debt.auto_accrue_interest,
    debt.interest_rate,
    debt.interest_period,
    debt.interest_method,
    debt.interest_start_date,
    debt.interest_accrued_through,
    debt.penalty_applied,
    debt.grace_period_days,
    position.ledger_balance,
    position.accrued_interest,
    position.projected_penalty,
    position.projected_late_interest,
    position.projected_balance,
    position.daily_growth,
    position.overdue_days

from public.pf_debts debt

left join lateral (
    select
        sum(movement.amount)
            filter (where movement.movement_type = 'payment') as paid_amount,
        sum(movement.amount)
            filter (where movement.movement_type = 'interest') as interest_amount,
        sum(movement.amount)
            filter (where movement.movement_type = 'fee') as fee_amount,
        sum(movement.amount)
            filter (where movement.movement_type = 'discount') as discount_amount
    from public.pf_debt_movements movement
    where movement.debt_id = debt.id
) movement_summary on true

cross join lateral public.pf_calculate_debt_position(
    debt.id,
    current_date
) position;

revoke all
on public.pf_debt_progress
from public, anon;

grant select
on public.pf_debt_progress
to authenticated;

-- =========================================================
-- CRIAÇÃO SIMPLIFICADA DE DÍVIDA
-- O usuário decide apenas se a dívida é pessoal ou outra.
-- O detalhamento técnico continua no motor, mas não polui a UX.
-- =========================================================

create or replace function public.pf_create_debt_with_initial_payment_v2(
    target_household_id uuid,
    debt_creditor text,
    debt_description text,
    debt_original_amount numeric,
    target_debt_group text default 'other',
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
    debt_visibility_scope text default 'family',
    initial_payment_amount numeric default 0,
    initial_payment_account_id uuid default null,
    initial_payment_date date default current_date,
    initial_payment_count_installment boolean default false,
    initial_payment_notes text default null
)
returns table (
    debt_id uuid,
    transaction_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    created_row record;
begin
    if target_debt_group not in ('personal', 'other') then
        raise exception 'A classificação da dívida deve ser Pessoal ou Outras dívidas.';
    end if;

    if not public.pf_can_write(target_household_id) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    select *
    into created_row
    from public.pf_create_other_debt_with_initial_payment(
        target_household_id => target_household_id,
        debt_creditor => debt_creditor,
        debt_description => debt_description,
        debt_original_amount => debt_original_amount,
        debt_kind => 'other',
        debt_start_date => debt_start_date,
        debt_due_date => debt_due_date,
        debt_installment_amount => debt_installment_amount,
        debt_total_installments => debt_total_installments,
        debt_interest_enabled => debt_interest_enabled,
        debt_auto_accrue_interest => debt_auto_accrue_interest,
        debt_interest_rate => debt_interest_rate,
        debt_interest_period => debt_interest_period,
        debt_interest_method => debt_interest_method,
        debt_penalty_rate => debt_penalty_rate,
        debt_daily_late_interest_rate => debt_daily_late_interest_rate,
        debt_grace_period_days => debt_grace_period_days,
        debt_responsible_user_id => debt_responsible_user_id,
        debt_visibility_scope => debt_visibility_scope,
        initial_payment_amount => initial_payment_amount,
        initial_payment_account_id => initial_payment_account_id,
        initial_payment_date => initial_payment_date,
        initial_payment_count_installment => initial_payment_count_installment,
        initial_payment_notes => initial_payment_notes
    );

    update public.pf_debts
    set
        debt_group = target_debt_group,
        updated_at = now()
    where id = created_row.debt_id
      and household_id = target_household_id;

    return query
    select
        created_row.debt_id::uuid,
        created_row.transaction_id::uuid;
end;
$$;

revoke all
on function public.pf_create_debt_with_initial_payment_v2(
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
    text,
    numeric,
    uuid,
    date,
    boolean,
    text
)
from public, anon;

grant execute
on function public.pf_create_debt_with_initial_payment_v2(
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
    text,
    numeric,
    uuid,
    date,
    boolean,
    text
)
to authenticated;

commit;

notify pgrst, 'reload schema';
