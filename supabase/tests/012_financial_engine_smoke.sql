-- Execute depois da migration 012.
-- Somente leitura: não altera dados.

select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'pf_debts'
  and column_name in (
      'debt_group',
      'interest_enabled',
      'auto_accrue_interest',
      'interest_rate',
      'interest_period',
      'interest_method',
      'interest_start_date',
      'grace_period_days'
  )
order by column_name;

select
    to_regclass('public.pf_commitments')
        as commitments_table,
    to_regclass('public.pf_commitment_settlements')
        as settlements_table,
    to_regclass('public.pf_commitment_progress')
        as commitment_view,
    to_regclass('public.pf_debt_positions')
        as debt_position_view;

select
    creditor,
    debt_group,
    ledger_balance,
    accrued_interest,
    projected_penalty,
    projected_late_interest,
    projected_balance,
    daily_growth,
    overdue_days
from public.pf_debt_positions
order by projected_balance desc
limit 20;

select
    direction,
    counterparty,
    description,
    total_amount,
    settled_amount,
    remaining_amount,
    computed_status
from public.pf_commitment_progress
order by created_at desc
limit 20;
