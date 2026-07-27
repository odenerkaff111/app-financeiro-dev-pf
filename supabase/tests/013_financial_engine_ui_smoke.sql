-- Execute depois da migration 013.
-- Somente leitura: não altera dados.

select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'pf_debts'
  and column_name in (
      'debt_kind',
      'interest_accrued_through',
      'penalty_applied'
  )
order by column_name;

select
    to_regprocedure(
        'public.pf_create_other_debt(uuid,text,text,numeric,text,date,date,numeric,integer,boolean,boolean,numeric,text,text,numeric,numeric,integer,uuid,text)'
    ) as create_other_debt,
    to_regprocedure(
        'public.pf_register_debt_payment(uuid,uuid,numeric,date,boolean,text)'
    ) as register_debt_payment;

select
    creditor,
    debt_group,
    debt_kind,
    ledger_balance,
    accrued_interest,
    projected_penalty,
    projected_late_interest,
    projected_balance,
    daily_growth
from public.pf_debt_positions
order by projected_balance desc
limit 20;

-- Validação matemática sem alterar dados.
select
    public.pf_calculate_interval_interest(
        1000,
        current_date - 10,
        current_date,
        1,
        'daily',
        'simple'
    ) as simple_interest_10_days,
    public.pf_calculate_interval_interest(
        1000,
        current_date - 10,
        current_date,
        1,
        'daily',
        'compound'
    ) as compound_interest_10_days;
