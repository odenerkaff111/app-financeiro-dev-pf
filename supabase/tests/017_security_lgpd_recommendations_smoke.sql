-- Somente leitura. Execute depois da migration 017.

select
    to_regclass('public.pf_security_events') as security_events,
    to_regclass('public.pf_financial_recommendations') as recommendations,
    to_regclass('public.pf_privacy_requests') as privacy_requests,
    to_regclass('public.pf_data_retention_settings') as retention_settings,
    to_regclass('public.pf_active_financial_recommendations') as active_recommendations;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
      'pf_log_security_event',
      'pf_create_privacy_request',
      'pf_purge_expired_compliance_data'
  )
order by routine_name;

select
    household_id,
    audit_retention_days,
    security_event_retention_days,
    recommendation_retention_days
from public.pf_data_retention_settings;

select
    tablename,
    policyname,
    cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
      'pf_security_events',
      'pf_financial_recommendations',
      'pf_privacy_requests',
      'pf_data_retention_settings'
  )
order by tablename, policyname;
