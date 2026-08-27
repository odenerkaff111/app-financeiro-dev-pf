-- Somente leitura. Execute depois da migration 016.

select
    to_regclass('public.pf_upcoming_obligations') as upcoming_obligations,
    to_regclass('public.pf_investment_positions') as investment_positions,
    to_regclass('public.pf_investment_snapshots') as investment_snapshots,
    to_regclass('public.pf_cost_of_living_summary') as cost_of_living_summary,
    to_regclass('public.pf_transaction_settlements') as transaction_settlements;

select
    routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
      'pf_register_pending_transaction_settlement',
      'pf_investment_cost_basis_for_account'
  )
order by routine_name;

select
    household_id,
    observed_months,
    average_monthly_cost,
    first_month,
    last_month
from public.pf_cost_of_living_summary;

select
    household_id,
    name,
    current_value,
    cost_basis,
    estimated_return,
    estimated_return_percentage
from public.pf_investment_positions
order by current_value desc;

select
    source_type,
    direction,
    counterparty,
    description,
    remaining_amount,
    due_date,
    computed_status
from public.pf_upcoming_obligations
order by
    due_date asc nulls last,
    created_at asc
limit 20;
