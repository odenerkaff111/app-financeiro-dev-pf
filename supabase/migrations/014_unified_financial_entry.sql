begin;

-- =========================================================
-- CRIA UM COMPROMISSO E, OPCIONALMENTE, REGISTRA UMA
-- LIQUIDAÇÃO INICIAL NA MESMA TRANSAÇÃO DO POSTGRES.
-- =========================================================

create or replace function public.pf_create_commitment_with_initial_settlement(
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
    if coalesce(initial_settlement_amount, 0) < 0 then
        raise exception 'O valor já liquidado não pode ser negativo.';
    end if;

    if coalesce(initial_settlement_amount, 0) > commitment_total_amount then
        raise exception 'O valor já liquidado não pode ser maior que o valor total.';
    end if;

    if coalesce(initial_settlement_amount, 0) > 0
       and initial_settlement_account_id is null then
        raise exception 'Selecione a conta usada na liquidação inicial.';
    end if;

    created_commitment_id := public.pf_create_commitment(
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
        commitment_source
    );

    if coalesce(initial_settlement_amount, 0) > 0 then
        created_transaction_id := public.pf_register_commitment_settlement(
            created_commitment_id,
            initial_settlement_account_id,
            initial_settlement_amount,
            coalesce(initial_settlement_date, current_date),
            coalesce(
                nullif(trim(initial_settlement_notes), ''),
                'Liquidação inicial registrada junto com o compromisso'
            ),
            commitment_source
        );
    end if;

    return query
    select
        created_commitment_id,
        created_transaction_id;
end;
$$;

revoke all
on function public.pf_create_commitment_with_initial_settlement(
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
    numeric,
    uuid,
    date,
    text
)
from public, anon;

grant execute
on function public.pf_create_commitment_with_initial_settlement(
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
    numeric,
    uuid,
    date,
    text
)
to authenticated;

-- =========================================================
-- CRIA UMA OUTRA DÍVIDA E, OPCIONALMENTE, REGISTRA UM
-- PAGAMENTO INICIAL NA MESMA TRANSAÇÃO DO POSTGRES.
-- =========================================================

create or replace function public.pf_create_other_debt_with_initial_payment(
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
    created_debt_id uuid;
    created_transaction_id uuid;
begin
    if coalesce(initial_payment_amount, 0) < 0 then
        raise exception 'O pagamento inicial não pode ser negativo.';
    end if;

    if coalesce(initial_payment_amount, 0) > debt_original_amount then
        raise exception 'O pagamento inicial não pode ser maior que o valor original.';
    end if;

    if coalesce(initial_payment_amount, 0) > 0
       and initial_payment_account_id is null then
        raise exception 'Selecione a conta usada no pagamento inicial.';
    end if;

    created_debt_id := public.pf_create_other_debt(
        target_household_id,
        debt_creditor,
        debt_description,
        debt_original_amount,
        debt_kind,
        debt_start_date,
        debt_due_date,
        debt_installment_amount,
        debt_total_installments,
        debt_interest_enabled,
        debt_auto_accrue_interest,
        debt_interest_rate,
        debt_interest_period,
        debt_interest_method,
        debt_penalty_rate,
        debt_daily_late_interest_rate,
        debt_grace_period_days,
        debt_responsible_user_id,
        debt_visibility_scope
    );

    if coalesce(initial_payment_amount, 0) > 0 then
        created_transaction_id := public.pf_register_debt_payment(
            created_debt_id,
            initial_payment_account_id,
            initial_payment_amount,
            coalesce(initial_payment_date, current_date),
            coalesce(initial_payment_count_installment, false),
            coalesce(
                nullif(trim(initial_payment_notes), ''),
                'Pagamento inicial registrado junto com a dívida'
            )
        );
    end if;

    return query
    select
        created_debt_id,
        created_transaction_id;
end;
$$;

revoke all
on function public.pf_create_other_debt_with_initial_payment(
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
on function public.pf_create_other_debt_with_initial_payment(
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
