-- KYRA 043: plan/confirm financeiro em lote. Executar no SQL Editor antes de publicar a UI.
-- Nenhum LLM recebe permissao de escrita; a aprovacao humana dispara este RPC atomico.
begin;

create table if not exists public.pf_ai_finance_batches (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    created_by uuid not null references auth.users(id),
    status text not null default 'pending' check(status in ('pending','confirmed','cancelled')),
    operations jsonb not null,
    account_snapshot jsonb not null default '{}'::jsonb,
    statement_snapshot jsonb not null default '{}'::jsonb,
    debt_snapshot jsonb not null default '{}'::jsonb,
    loan_snapshot jsonb not null default '{}'::jsonb,
    obligation_snapshot jsonb not null default '{}'::jsonb,
    result jsonb,
    created_at timestamptz not null default now(),
    confirmed_at timestamptz,
    expires_at timestamptz not null default(now() + interval '60 minutes'),
    constraint pf_ai_batch_ops_array check(jsonb_typeof(operations) = 'array' and jsonb_array_length(operations) between 1 and 20)
);

create index if not exists pf_ai_finance_batches_household_idx
on public.pf_ai_finance_batches(household_id, created_at desc);

alter table public.pf_ai_finance_batches enable row level security;
revoke all on public.pf_ai_finance_batches from public, anon, authenticated;
grant select on public.pf_ai_finance_batches to authenticated;
grant all on public.pf_ai_finance_batches to service_role;

drop policy if exists pf_ai_finance_batches_read on public.pf_ai_finance_batches;
create policy pf_ai_finance_batches_read on public.pf_ai_finance_batches
for select to authenticated using(public.pf_is_member(household_id) and created_by = (select auth.uid()));

-- Limite atomico para uso da inferencia: no maximo 10 requisicoes a cada 10 min/usuario.
-- Chamadas que terminem em erro de IA tambem consomem uma vaga.
create table if not exists public.pf_ai_model_request_buckets (
  household_id uuid not null references public.pf_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_start timestamptz not null,
  calls integer not null default 0 check(calls between 0 and 10),
  primary key(household_id,user_id,bucket_start)
);
alter table public.pf_ai_model_request_buckets enable row level security;
revoke all on public.pf_ai_model_request_buckets from public,anon,authenticated;
grant all on public.pf_ai_model_request_buckets to service_role;

create or replace function public.pf_claim_ai_model_request_v1(p_household uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_bucket timestamptz := date_bin('10 minutes',now(),'2020-01-01T00:00:00Z'::timestamptz);
  v_calls integer;
begin
  if auth.uid() is null or not public.pf_is_member(p_household) then
    raise exception 'Sem acesso ao grupo familiar.';
  end if;
  insert into public.pf_ai_model_request_buckets(household_id,user_id,bucket_start,calls)
  values(p_household,auth.uid(),v_bucket,1)
  on conflict(household_id,user_id,bucket_start) do update set calls=public.pf_ai_model_request_buckets.calls+1
  where public.pf_ai_model_request_buckets.calls<10
  returning calls into v_calls;
  if v_calls is null then raise exception 'Limite de 10 analises a cada 10 minutos. Aguarde antes de tentar novamente.'; end if;
  return v_calls;
end $$;
revoke all on function public.pf_claim_ai_model_request_v1(uuid) from public,anon;
grant execute on function public.pf_claim_ai_model_request_v1(uuid) to authenticated;

-- A UI armazena a referencia do lote como uma proposta normal de chat.
do $$
begin
  alter table public.pf_ai_messages drop constraint if exists pf_ai_messages_action_type_check;
  alter table public.pf_ai_messages add constraint pf_ai_messages_action_type_check check (
    action_type is null or action_type in (
       'create_transaction','create_transfer','register_debt_payment',
       'register_debt_received','create_commitment','register_commitment_settlement',
       'create_other_debt','register_variable_recurring','import_statement','batch_update'
    )
  );
end $$;

-- Acoes persistidas sao sempre validas dentro do household. O cliente nao
-- pode gravar nesta tabela: somente uma RPC autenticada pode preparar o lote.
create or replace function public.pf_prepare_ai_finance_batch_v1(p_household uuid, p_operations jsonb)
returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
  v_entry jsonb;
  v_kind text;
  v_acct uuid;
  v_dest uuid;
  v_category uuid;
  v_debt uuid;
  v_loan uuid;
  v_obligation uuid;
  v_statement uuid;
  v_amount numeric;
  v_account_snapshot jsonb;
  v_statement_snapshot jsonb;
  v_debt_snapshot jsonb;
  v_loan_snapshot jsonb;
  v_obligation_snapshot jsonb;
begin
  if auth.uid() is null or not public.pf_can_write(p_household) then
    raise exception 'Acesso de escrita negado.';
  end if;
  if p_operations is null or jsonb_typeof(p_operations)<>'array' or jsonb_array_length(p_operations) not between 1 and 20 then
    raise exception 'A proposta exige entre 1 e 20 operacoes.';
  end if;
  if length(p_operations::text)>30000 then raise exception 'Lote muito grande.'; end if;

  for v_entry in select value from jsonb_array_elements(p_operations) loop
    if jsonb_typeof(v_entry)<>'object' then raise exception 'Operacao invalida.'; end if;
    v_kind := v_entry->>'kind';
    if v_kind not in ('income','expense','transfer','investment_contribution','investment_withdrawal',
                      'pay_card_statement','debt_payment','loan_repayment','card_purchase','settle_obligation','reconcile_account')
       or v_kind is null then raise exception 'Tipo de operacao nao autorizado: %',v_kind; end if;
    v_acct := nullif(v_entry->>'account_id','')::uuid;
    v_dest := nullif(v_entry->>'destination_account_id','')::uuid;
    v_category := nullif(v_entry->>'category_id','')::uuid;
    v_debt := nullif(v_entry->>'debt_id','')::uuid;
    v_loan := nullif(v_entry->>'loan_id','')::uuid;
    v_obligation := nullif(v_entry->>'obligation_id','')::uuid;
    v_statement := nullif(v_entry->>'card_statement_id','')::uuid;
    v_amount := nullif(v_entry->>'amount','')::numeric;
    if v_amount is null or v_amount<0 or (v_amount=0 and v_kind<>'reconcile_account') or v_amount>1000000 or round(v_amount,2)<>v_amount then
      raise exception 'Valor invalido ou sem precisao de centavos.';
    end if;
    if v_acct is null or not exists (
      select 1 from public.pf_accounts a where a.id=v_acct and a.household_id=p_household and a.is_active
    ) then raise exception 'Conta de origem ausente ou nao autorizada.'; end if;
    if v_dest is not null and not exists (
      select 1 from public.pf_accounts a where a.id=v_dest and a.household_id=p_household and a.is_active
    ) then raise exception 'Conta destino nao autorizada.'; end if;
    if v_category is not null and not exists (
      select 1 from public.pf_categories c where c.id=v_category and c.household_id=p_household
    ) then raise exception 'Categoria nao autorizada.'; end if;
    if v_kind <> 'card_purchase' and exists (
      select 1 from public.pf_accounts a where a.id=v_acct and a.type='credit_card'
    ) then raise exception 'Cartao de credito nao pode ser usado como conta bancaria de origem.'; end if;
    if v_kind in ('income','expense') and v_category is not null and not exists (
      select 1 from public.pf_categories c where c.id=v_category and c.kind=v_kind
    ) then raise exception 'Categoria incompatível com receita/despesa.'; end if;
    if v_kind in ('transfer','investment_contribution','investment_withdrawal') then
      if v_dest is null or v_dest=v_acct then raise exception 'Transferencia exige duas contas diferentes.'; end if;
      if v_kind='investment_contribution' and not exists (
        select 1 from public.pf_accounts where id=v_dest and type='investment'
      ) then raise exception 'O destino do investimento deve ser uma conta de investimento.'; end if;
      if v_kind='investment_withdrawal' and not exists (
        select 1 from public.pf_accounts where id=v_acct and type='investment'
      ) then raise exception 'O resgate deve sair de uma conta de investimento.'; end if;
    end if;
    if v_kind in ('income','expense','transfer','investment_contribution','investment_withdrawal') then
      if not exists(select 1 from public.pf_accounts where id=v_acct and type<>'credit_card') then
        raise exception 'Cartao de credito nao eh uma conta bancaria.';
      end if;
    end if;
    if v_kind in ('income','expense','transfer','investment_contribution','investment_withdrawal','card_purchase') then
      if nullif(btrim(coalesce(v_entry->>'description','')),'') is null then raise exception 'Descricao obrigatoria.'; end if;
    end if;
    if v_kind='card_purchase' and exists (
      select 1 from public.pf_accounts where id=v_acct and name ~* '(emprestad|terceir)'
    ) then raise exception 'Cartao de terceiro requer conciliação assistida.'; end if;
    if v_kind='pay_card_statement' and exists (
      select 1 from public.pf_card_statements s
      join public.pf_accounts a on a.id=s.account_id
      where s.id=v_statement and a.name ~* '(emprestad|terceir)'
    ) then raise exception 'Nao quite fatura de terceiro pelo fluxo de cartao proprio.'; end if;
    if v_kind='card_purchase' then
      if v_category is null or v_entry->>'due_on' is null then raise exception 'Compra no credito exige categoria e primeiro vencimento.'; end if;
      if not exists(select 1 from public.pf_categories c where c.id=v_category and c.kind='expense') then
        raise exception 'Compra no cartao exige categoria de despesa.'; end if;
      if not exists(select 1 from public.pf_accounts where id=v_acct and type='credit_card') then
        raise exception 'Conta da compra nao eh um cartao.';
      end if;
      if coalesce((v_entry->>'installments')::integer,1) not between 1 and 24 then raise exception 'Parcelas devem ser entre 1 e 24.'; end if;
    end if;
    if v_kind='pay_card_statement' then
      if v_statement is null or not exists(
        select 1 from public.pf_card_statements s
        join public.pf_accounts a on a.id=s.account_id
        where s.id=v_statement and s.household_id=p_household and a.type='credit_card'
      ) then raise exception 'Fatura nao autorizada.'; end if;
    end if;
    if v_kind='debt_payment' then
      if v_debt is null or not exists(select 1 from public.pf_debts where id=v_debt and household_id=p_household) then
        raise exception 'Divida nao autorizada.'; end if;
      if coalesce((v_entry->>'count_installment')::boolean,false) and not exists (
        select 1 from public.pf_debts where id=v_debt and installment_amount=v_amount
      ) then raise exception 'Parcela marcada como completa nao corresponde ao valor da prestacao.'; end if;
    end if;
    if v_kind='loan_repayment' then
      if v_loan is null or not exists(select 1 from public.pf_personal_loans where id=v_loan and household_id=p_household and cancelled_at is null) then
        raise exception 'Emprestimo a receber nao encontrado.'; end if;
    end if;
    if v_kind='settle_obligation' then
      if v_obligation is null or not exists(select 1 from public.pf_transactions t
        where t.id=v_obligation and t.household_id=p_household and t.status in ('planned','overdue')
          and t.type in ('expense','income') and t.card_statement_id is null and not t.card_forecast
          and coalesce(t.metadata->>'third_party_card','false')<>'true') then
        raise exception 'Obrigacao nao permitida ou ja liquidada.'; end if;
    end if;
    if v_kind='reconcile_account' then
      if length(btrim(coalesce(v_entry->>'description','')))<5 then raise exception 'Justificativa obrigatoria na conciliacao.'; end if;
    end if;
    if nullif(v_entry->>'occurred_on','') is null
       or (v_entry->>'occurred_on')::date > (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'Informe uma data de operacao valida e nao futura.';
    end if;
    if v_entry->>'due_on' is not null and (v_entry->>'due_on')::date < date '2020-01-01' then
      raise exception 'Vencimento invalido.';
    end if;
  end loop;

  select coalesce(jsonb_object_agg(a.id::text,jsonb_build_object('balance',a.balance,'available_credit',a.available_credit)),'{}'::jsonb)
  into v_account_snapshot from public.pf_accounts a
  where a.household_id=p_household and a.id in (
    select x.val::uuid from (
      select nullif(z->>'account_id','') val from jsonb_array_elements(p_operations) z
      union select nullif(z->>'destination_account_id','') from jsonb_array_elements(p_operations) z
    ) x where x.val is not null
  );
  select coalesce(jsonb_object_agg(s.id::text, p.remaining_amount),'{}'::jsonb)
  into v_statement_snapshot from public.pf_card_statements s
  join public.pf_card_statement_positions p on p.id=s.id
  where s.household_id=p_household and s.id in (
    select nullif(z->>'card_statement_id','')::uuid from jsonb_array_elements(p_operations) z
    where z->>'card_statement_id' is not null
  );
  select coalesce(jsonb_object_agg(d.id::text,d.current_balance),'{}'::jsonb)
  into v_debt_snapshot from public.pf_debts d
  where d.household_id=p_household and d.id in (
    select nullif(z->>'debt_id','')::uuid from jsonb_array_elements(p_operations) z
    where z->>'debt_id' is not null
  );
  select coalesce(jsonb_object_agg(l.id::text,p.remaining_amount),'{}'::jsonb)
  into v_loan_snapshot from public.pf_personal_loans l
  join public.pf_personal_loan_positions p on p.id=l.id
  where l.household_id=p_household and l.id in (
    select nullif(z->>'loan_id','')::uuid from jsonb_array_elements(p_operations) z
    where z->>'loan_id' is not null
  );
  select coalesce(jsonb_object_agg(t.id::text,jsonb_build_object('status',t.status,'amount',t.amount)),'{}'::jsonb)
  into v_obligation_snapshot from public.pf_transactions t
  where t.household_id=p_household and t.id in (
    select nullif(z->>'obligation_id','')::uuid from jsonb_array_elements(p_operations) z
    where z->>'obligation_id' is not null
  );

  insert into public.pf_ai_finance_batches(
    household_id,created_by,operations,account_snapshot,statement_snapshot,debt_snapshot,loan_snapshot,obligation_snapshot
  ) values(p_household,auth.uid(),p_operations,v_account_snapshot,v_statement_snapshot,v_debt_snapshot,v_loan_snapshot,v_obligation_snapshot)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.pf_confirm_ai_finance_batch_v1(p_batch uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  b public.pf_ai_finance_batches%rowtype;
  v_entry jsonb;
  v_kind text;
  v_id uuid;
  v_acct uuid;
  v_dest uuid;
  v_result jsonb := '[]'::jsonb;
  v_out uuid;
  v_amount numeric;
  v_day date;
  v_created uuid;
  v_snapshot record;
  v_statement record;
  v_debt record;
  v_loan record;
  v_obligation record;
  v_current numeric;
  v_index integer:=0;
begin
  select * into b from public.pf_ai_finance_batches where id=p_batch for update;
  if not found or auth.uid() is null or b.created_by<>auth.uid() or not public.pf_can_write(b.household_id) then
    raise exception 'Plano nao encontrado ou sem permissao.';
  end if;
  if b.status='confirmed' then return b.result; end if;
  if b.status<>'pending' then raise exception 'Este plano foi cancelado.'; end if;
  if b.expires_at<now() then raise exception 'A previa expirou. Solicite uma nova analise no chat.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(b.household_id::text,38));
  -- Bloqueia linhas financeiras na mesma transacao antes de comparar a previa.
  perform 1 from public.pf_accounts a
    where a.household_id=b.household_id
      and b.account_snapshot ? a.id::text order by a.id for update;
  perform 1 from public.pf_card_statements s
    where s.household_id=b.household_id
      and b.statement_snapshot ? s.id::text order by s.id for update;
  perform 1 from public.pf_debts d
    where d.household_id=b.household_id
      and b.debt_snapshot ? d.id::text order by d.id for update;
  perform 1 from public.pf_personal_loans l
    where l.household_id=b.household_id
      and b.loan_snapshot ? l.id::text order by l.id for update;
  perform 1 from public.pf_transactions t
    where t.household_id=b.household_id
      and b.obligation_snapshot ? t.id::text order by t.id for update;

  -- Snapshot da previa. Se algo mudou no app ou via SQL, nao aplicamos um plano desatualizado.
  for v_snapshot in select key,value from jsonb_each(b.account_snapshot) loop
    if not exists(select 1 from public.pf_accounts a where a.household_id=b.household_id and a.id=v_snapshot.key::uuid
      and a.balance is not distinct from (v_snapshot.value->>'balance')::numeric
      and a.available_credit is not distinct from (v_snapshot.value->>'available_credit')::numeric) then
      raise exception 'Saldo ou limite alterado depois da previa. Peça para analisar novamente.';
    end if;
  end loop;
  for v_statement in select key,value from jsonb_each(b.statement_snapshot) loop
    if not exists(select 1 from public.pf_card_statement_positions s where s.id=v_statement.key::uuid
      and s.remaining_amount is not distinct from (v_statement.value #>> '{}')::numeric) then
      raise exception 'Fatura mudou depois da previa. Reanalise.';
    end if;
  end loop;
  for v_debt in select key,value from jsonb_each(b.debt_snapshot) loop
    if not exists(select 1 from public.pf_debts d where d.id=v_debt.key::uuid and d.household_id=b.household_id
      and d.current_balance is not distinct from (v_debt.value #>> '{}')::numeric) then
      raise exception 'Divida mudou depois da previa. Reanalise.';
    end if;
  end loop;
  for v_loan in select key,value from jsonb_each(b.loan_snapshot) loop
    if not exists(select 1 from public.pf_personal_loan_positions l where l.id=v_loan.key::uuid and l.household_id=b.household_id
      and l.remaining_amount is not distinct from (v_loan.value #>> '{}')::numeric) then
      raise exception 'Emprestimo mudou depois da previa. Reanalise.';
    end if;
  end loop;
  for v_obligation in select key,value from jsonb_each(b.obligation_snapshot) loop
    if not exists(select 1 from public.pf_transactions t where t.id=v_obligation.key::uuid and t.household_id=b.household_id
      and t.status=(v_obligation.value->>'status') and t.amount=(v_obligation.value->>'amount')::numeric) then
      raise exception 'Obrigacao mudou depois da previa. Reanalise.';
    end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(b.operations) loop
    v_index:=v_index+1;
    v_kind:=v_entry->>'kind';
    v_acct := (v_entry->>'account_id')::uuid;
    v_dest := nullif(v_entry->>'destination_account_id','')::uuid;
    v_amount := (v_entry->>'amount')::numeric;
    v_day := (v_entry->>'occurred_on')::date;
    v_out := null;
    if v_kind in ('income','expense','transfer','investment_contribution','investment_withdrawal') then
      insert into public.pf_transactions(
        household_id,account_id,destination_account_id,category_id,
        created_by,responsible_user_id,type,status,description,merchant,amount,original_amount,
        occurred_on,due_date,paid_at,source,external_id,notes,metadata
      ) values(
        b.household_id,v_acct,v_dest,nullif(v_entry->>'category_id','')::uuid,
        auth.uid(),auth.uid(),v_kind,'paid',btrim(v_entry->>'description'),nullif(v_entry->>'merchant',''),
        v_amount,v_amount,v_day,v_day,(v_day + time '12:00') at time zone 'America/Sao_Paulo',
        'ai','kyra-ai-batch:'||b.id||':'||v_index,nullif(v_entry->>'notes',''),
        jsonb_build_object('origin','ai_confirmed_batch','batch_id',b.id,'batch_position',v_index)
      ) returning id into v_out;
    elsif v_kind='pay_card_statement' then
      v_out := public.pf_pay_card_statement_v1((v_entry->>'card_statement_id')::uuid,v_acct,v_day,gen_random_uuid());
    elsif v_kind='debt_payment' then
      v_out := public.pf_register_debt_payment(
        (v_entry->>'debt_id')::uuid,v_acct,v_amount,v_day,
        coalesce((v_entry->>'count_installment')::boolean,false),
        'Confirmado na Kyra (lote '||b.id||'). '||coalesce(v_entry->>'notes','')
      );
    elsif v_kind='loan_repayment' then
      v_out := public.pf_receive_personal_loan_v1((v_entry->>'loan_id')::uuid,v_acct,v_amount,v_day,gen_random_uuid());
    elsif v_kind='card_purchase' then
      v_out := public.pf_create_card_purchase_v2(
        b.household_id,v_acct,btrim(v_entry->>'description'),nullif(v_entry->>'merchant',''),
        v_amount,coalesce((v_entry->>'installments')::integer,1),
        (v_entry->>'due_on')::date,nullif(v_entry->>'category_id','')::uuid,null,v_day,
        false,coalesce((v_entry->>'monthly')::boolean,false),null,
        nullif(v_entry->>'notes',''),true,gen_random_uuid()
      );
    elsif v_kind='settle_obligation' then
      if not exists(select 1 from public.pf_transactions where id=(v_entry->>'obligation_id')::uuid
        and household_id=b.household_id and amount=v_amount and status in ('planned','overdue')
        and type='expense' and card_statement_id is null and not card_forecast) then
        raise exception 'Valor ou estado da obrigacao nao confere.';
      end if;
      update public.pf_transactions
      set account_id=v_acct,status='paid',occurred_on=v_day,
        paid_at=(v_day+time '12:00') at time zone 'America/Sao_Paulo',
        metadata=metadata||jsonb_build_object('origin','ai_settled_obligation','ai_batch_id',b.id),updated_at=now()
      where id=(v_entry->>'obligation_id')::uuid
      returning id into v_out;
    elsif v_kind='reconcile_account' then
      v_out := public.pf_reconcile_account_v1(v_acct,v_amount,v_entry->>'description',
        (b.account_snapshot->(v_acct::text)->>'balance')::numeric);
    else
      raise exception 'Operacao nao suportada neste momento: %',v_kind;
    end if;
    if v_out is null then raise exception 'A operacao % nao retornou comprovante.',v_index; end if;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'kind',v_kind,'amount',v_amount,'result_id',v_out,'position',v_index
    ));
  end loop;

  update public.pf_ai_finance_batches
  set status='confirmed',result=v_result,confirmed_at=now()
  where id=p_batch;
  return v_result;
end $$;

create or replace function public.pf_cancel_ai_finance_batch_v1(p_batch uuid)
returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.pf_ai_finance_batches set status='cancelled'
  where id=p_batch and status='pending' and created_by=auth.uid()
    and public.pf_can_write(household_id);
  return found;
end $$;

revoke all on function public.pf_prepare_ai_finance_batch_v1(uuid,jsonb) from public,anon;
revoke all on function public.pf_confirm_ai_finance_batch_v1(uuid) from public,anon;
revoke all on function public.pf_cancel_ai_finance_batch_v1(uuid) from public,anon;
grant execute on function public.pf_prepare_ai_finance_batch_v1(uuid,jsonb) to authenticated;
grant execute on function public.pf_confirm_ai_finance_batch_v1(uuid) to authenticated;
grant execute on function public.pf_cancel_ai_finance_batch_v1(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
