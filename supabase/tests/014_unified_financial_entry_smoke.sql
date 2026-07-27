-- Execute depois da migration 014.
-- Somente leitura: não altera dados.

select
    routine_name,
    security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
      'pf_create_commitment_with_initial_settlement',
      'pf_create_other_debt_with_initial_payment'
  )
order by routine_name;

select
    to_regclass('public.pf_commitments')
        as commitments_table,
    to_regclass('public.pf_commitment_settlements')
        as settlements_table,
    to_regclass('public.pf_commitment_progress')
        as commitment_view,
    to_regclass('public.pf_debt_positions')
        as debt_position_view;
