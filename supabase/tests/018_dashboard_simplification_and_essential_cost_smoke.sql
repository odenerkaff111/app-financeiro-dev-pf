-- Execute depois da migration 018. Somente leitura.

select
    table_name,
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'pf_commitments' and column_name = 'is_essential')
    or (table_name = 'pf_transactions' and column_name = 'is_essential')
    or (table_name = 'pf_recurring_templates' and column_name = 'is_essential')
  )
order by table_name;

select
    to_regprocedure(
        'public.pf_create_commitment_with_initial_settlement_v2(uuid,text,text,text,numeric,date,uuid,uuid,uuid,text,text,text,boolean,numeric,uuid,date,text)'
    ) as commitment_v2,
    to_regprocedure(
        'public.pf_register_pending_transaction_settlement(uuid,uuid,numeric,date,text)'
    ) as transaction_settlement;

select
    to_regclass('public.pf_cost_of_living_monthly') as monthly_view,
    to_regclass('public.pf_cost_of_living_summary') as summary_view,
    to_regclass('public.pf_cost_of_living_breakdown') as breakdown_view;

select
    household_id,
    observed_months,
    average_monthly_cost,
    observed_total
from public.pf_cost_of_living_summary
order by household_id;

select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'pf_upcoming_obligations'
  and column_name = 'is_essential';
