-- Execute depois da migration 019.
-- Somente leitura: não altera dados.

select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'pf_debt_progress'
  and column_name in (
      'debt_group',
      'interest_enabled',
      'accrued_interest',
      'projected_balance',
      'daily_growth'
  )
order by column_name;

select
    p.proname as function_name
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'pf_create_debt_with_initial_payment_v2';

select
    debt_group,
    count(*) as quantity,
    round(sum(projected_balance), 2) as projected_balance
from public.pf_debt_progress
group by debt_group
order by debt_group;
