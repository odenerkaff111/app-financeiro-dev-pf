-- Execute depois da migration 015.
-- Somente leitura.

select
    constraint_name,
    check_clause
from information_schema.check_constraints
where constraint_schema = 'public'
  and constraint_name = 'pf_ai_messages_action_type_check';

select
    to_regclass('public.pf_debt_positions') as debt_positions,
    to_regclass('public.pf_commitment_progress') as commitment_progress,
    to_regclass('public.pf_audit_log') as audit_log;

select
    event_object_table,
    trigger_name
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in (
      'pf_commitments',
      'pf_commitment_settlements'
  )
  and trigger_name = 'pf_audit_changes_trigger'
order by event_object_table;
