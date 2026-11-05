-- Somente leitura. Executar apos 043_ai_finance_batch_v1.sql.
select
  to_regclass('public.pf_ai_finance_batches') is not null as tabela_de_propostas,
  to_regclass('public.pf_ai_model_request_buckets') is not null as limites_persistentes,
  to_regprocedure('public.pf_prepare_ai_finance_batch_v1(uuid,jsonb)') is not null as rpc_preparar,
  to_regprocedure('public.pf_confirm_ai_finance_batch_v1(uuid)') is not null as rpc_confirmar,
  to_regprocedure('public.pf_cancel_ai_finance_batch_v1(uuid)') is not null as rpc_cancelar,
  to_regprocedure('public.pf_claim_ai_model_request_v1(uuid)') is not null as rpc_limite,
  exists(
    select 1 from pg_constraint c
    where c.conrelid='public.pf_ai_messages'::regclass
      and c.conname='pf_ai_messages_action_type_check'
      and pg_get_constraintdef(c.oid) like '%batch_update%'
  ) as tipo_do_chat_ativo;
-- Todas as colunas devem retornar true.
