-- Executar depois de 040_web_push_pwa.sql. Somente leitura / rollback.
begin;

do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pf_reminder_settings' and column_name='push_enabled') then
    raise exception 'push_enabled nao existe.';
  end if;
  if to_regclass('public.pf_push_subscriptions') is null then raise exception 'pf_push_subscriptions nao existe.'; end if;
  if to_regclass('public.pf_push_outbox') is null then raise exception 'pf_push_outbox nao existe.'; end if;
  if to_regprocedure('public.pf_push_dispatch_needed_v1()') is null then raise exception 'pf_push_dispatch_needed_v1 nao existe.'; end if;
  if to_regprocedure('public.pf_claim_push_reminders_v1()') is null then raise exception 'pf_claim_push_reminders_v1 nao existe.'; end if;
  if to_regprocedure('public.pf_push_job_is_due_v1(uuid)') is null then raise exception 'pf_push_job_is_due_v1 nao existe.'; end if;
  if to_regprocedure('public.pf_claim_push_action_v1(uuid,uuid,text)') is null then raise exception 'pf_claim_push_action_v1 nao existe.'; end if;
  if has_table_privilege('authenticated','public.pf_push_subscriptions','SELECT') then raise exception 'Authenticated nao deve ler endpoints/chaves push.'; end if;
  if not has_table_privilege('authenticated','public.pf_push_outbox','SELECT') then raise exception 'Authenticated deve conseguir ler o proprio historico de push via RLS.'; end if;
end $$;

rollback;
select 'TESTE_OK_WEB_PUSH_ROLLBACK_SEM_GRAVAR' as resultado;
