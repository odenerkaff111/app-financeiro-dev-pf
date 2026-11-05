-- Family finance v2. Additive structure; no historical data loads or balance resets.
begin;
create schema if not exists pf_private;
revoke all on schema pf_private from public,anon;
grant usage on schema pf_private to authenticated;

alter table public.pf_ai_finance_batches add column if not exists operation_version integer not null default 1;
alter table public.pf_ai_finance_batches add column if not exists context_snapshot text;
alter table public.pf_ai_finance_batches drop constraint if exists pf_ai_batch_ops_array;
alter table public.pf_ai_finance_batches add constraint pf_ai_batch_ops_array check(jsonb_typeof(operations)='array' and jsonb_array_length(operations) between 1 and 60);

create table if not exists public.pf_family_preferences(
 household_id uuid primary key references public.pf_households(id) on delete cascade,
 minimum_reserve numeric(14,2) not null default 0 check(minimum_reserve>=0),
 updated_at timestamptz not null default now()
);
alter table public.pf_family_preferences enable row level security;
revoke all on public.pf_family_preferences from public,anon,authenticated;
grant select on public.pf_family_preferences to authenticated;
grant all on public.pf_family_preferences to service_role;
drop policy if exists family_preferences_read on public.pf_family_preferences;
create policy family_preferences_read on public.pf_family_preferences for select to authenticated using(public.pf_is_member(household_id));

create table if not exists public.pf_ai_drafts(
 conversation_id uuid primary key references public.pf_ai_conversations(id) on delete cascade,
 household_id uuid not null references public.pf_households(id) on delete cascade,
 created_by uuid not null references auth.users(id),
 transcript jsonb not null default '[]'::jsonb check(jsonb_typeof(transcript)='array' and length(transcript::text)<=100000),
 updated_at timestamptz not null default now()
);
alter table public.pf_ai_drafts enable row level security;
revoke all on public.pf_ai_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.pf_ai_drafts to authenticated;
grant all on public.pf_ai_drafts to service_role;
drop policy if exists drafts_owned on public.pf_ai_drafts;
create policy drafts_owned on public.pf_ai_drafts for all to authenticated
 using(created_by=(select auth.uid()) and public.pf_can_write(household_id))
 with check(created_by=(select auth.uid()) and public.pf_can_write(household_id) and exists(
 select 1 from public.pf_ai_conversations c where c.id=conversation_id and c.household_id=pf_ai_drafts.household_id and c.created_by=(select auth.uid())));

create table if not exists public.pf_finance_change_audit(
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.pf_households(id),
 batch_id uuid not null references public.pf_ai_finance_batches(id),transaction_id uuid references public.pf_transactions(id),
 created_by uuid not null references auth.users(id),before_value jsonb not null,after_value jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists pf_finance_change_audit_household_idx on public.pf_finance_change_audit(household_id,created_at desc);
alter table public.pf_finance_change_audit enable row level security;
revoke all on public.pf_finance_change_audit from public,anon,authenticated;
grant select on public.pf_finance_change_audit to authenticated;
grant all on public.pf_finance_change_audit to service_role;
drop policy if exists finance_audit_read on public.pf_finance_change_audit;
create policy finance_audit_read on public.pf_finance_change_audit for select to authenticated using(public.pf_is_member(household_id));

create or replace function pf_private.family_fingerprint(h uuid) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.pf_can_write(h) then raise exception 'Sem permissao de escrita.';end if;
 return md5(jsonb_build_object(
 'accounts',(select jsonb_agg(to_jsonb(a) order by id) from public.pf_accounts a where household_id=h),
 'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.pf_transactions t where household_id=h),
 'statements',(select jsonb_agg(to_jsonb(s) order by id) from public.pf_card_statements s where household_id=h),
 'debts',(select jsonb_agg(to_jsonb(d) order by id) from public.pf_debts d where household_id=h),
 'loans',(select jsonb_agg(to_jsonb(l) order by id) from public.pf_personal_loan_positions l where household_id=h),
 'recurring',(select jsonb_agg(to_jsonb(r) order by id) from public.pf_recurring_templates r where household_id=h),
 'budgets',(select jsonb_agg(to_jsonb(b) order by id) from public.pf_budgets b where household_id=h),
 'preferences',(select to_jsonb(p) from public.pf_family_preferences p where household_id=h)
 )::text);
end $$;

create or replace function pf_private.validate_family_operation(h uuid,o jsonb,ops jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare k text:=o->>'kind';a public.pf_accounts%rowtype;dest public.pf_accounts%rowtype;
 t public.pf_transactions%rowtype;s public.pf_card_statement_dashboard%rowtype;
 v numeric;d date;due date;rid uuid;
begin
 if auth.uid() is null or not public.pf_can_write(h) then raise exception 'Sem permissao de escrita.';end if;
 if k is null or k not in ('income','expense','transfer','investment_contribution','investment_withdrawal','pay_card_statement','debt_payment','loan_repayment','card_purchase','settle_obligation','reconcile_account','plan_income','plan_expense','receive_income','update_transaction','cancel_transaction','reconcile_card','set_reserve','update_recurring','cancel_recurring') then raise exception 'Operacao nao permitida.';end if;
 if jsonb_typeof(o->'amount') is distinct from 'number' then raise exception 'Valor numerico obrigatorio.';end if;
 v:=(o->>'amount')::numeric;
 if abs(v)>1000000 or round(v,2)<>v or v::text in ('NaN','Infinity','-Infinity') or (v<0 and k<>'reconcile_account') or (v=0 and k not in ('reconcile_account','reconcile_card','set_reserve','cancel_transaction','cancel_recurring')) then raise exception 'Valor invalido.';end if;
 if coalesce(o->>'occurred_on','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Data obrigatoria.';end if;
 d:=(o->>'occurred_on')::date;
 if d<date '2020-01-01' or d>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data realizada deve ser atual ou passada.';end if;
 if nullif(o->>'due_on','') is not null then
  if (o->>'due_on')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Vencimento invalido.';end if;
  due:=(o->>'due_on')::date;if due<date '2020-01-01' then raise exception 'Vencimento invalido.';end if;
 end if;
 if length(btrim(coalesce(o->>'description','')))<3 then raise exception 'Descricao obrigatoria.';end if;
 if nullif(o->>'account_id','') is not null then
  select * into a from public.pf_accounts where id=(o->>'account_id')::uuid and household_id=h and is_active;
  if not found then raise exception 'Conta nao autorizada.';end if;
 elsif k not in ('plan_income','plan_expense','set_reserve','cancel_transaction','update_recurring','cancel_recurring') then raise exception 'Selecione a conta real.';end if;
 if nullif(o->>'destination_account_id','') is not null then
  select * into dest from public.pf_accounts where id=(o->>'destination_account_id')::uuid and household_id=h and is_active;
  if not found then raise exception 'Destino nao autorizado.';end if;
 end if;
 if k in ('card_purchase','reconcile_card') then
  if a.type<>'credit_card' then raise exception 'Selecione o cartao.';end if;
 elsif a.type='credit_card' then raise exception 'Cartao nao e conta bancaria de origem.';end if;
 if k in ('income','expense','debt_payment','loan_repayment','pay_card_statement','settle_obligation','receive_income','plan_income','plan_expense') and a.type not in ('checking','savings','cash','wallet') then raise exception 'Selecione uma conta de dinheiro.';end if;
 if nullif(o->>'category_id','') is not null and not exists(select 1 from public.pf_categories c where id=(o->>'category_id')::uuid and household_id=h and kind=case when k in ('income','plan_income','receive_income') then 'income' else 'expense' end) then raise exception 'Categoria nao autorizada ou incompativel.';end if;
 if k in ('transfer','investment_contribution','investment_withdrawal') then
  if dest.id is null or dest.id=a.id or dest.type='credit_card' then raise exception 'Origem e destino diferentes sao obrigatorios.';end if;
  if k='transfer' and (a.type='investment' or dest.type='investment') then raise exception 'Use aporte ou resgate para investimentos.';end if;
  if k='investment_contribution' and (dest.type<>'investment' or a.type='investment') then raise exception 'Aporte exige banco e investimento.';end if;
  if k='investment_withdrawal' and (a.type<>'investment' or dest.type='investment') then raise exception 'Resgate exige investimento e banco.';end if;
 end if;
 if k in ('plan_income','plan_expense') and due is null then raise exception 'Informe quando espera receber ou pagar.';end if;
 if k='card_purchase' then
  if due is null or nullif(o->>'category_id','') is null or coalesce((o->>'installments')::integer,1) not between 1 and 24 then raise exception 'Compra exige categoria, primeiro vencimento e parcelas validas.';end if;
  if coalesce((o->>'monthly')::boolean,false) and coalesce((o->>'installments')::integer,1)<>1 then raise exception 'Assinatura mensal nao e parcelamento.';end if;
  if a.card_owner_type='third_party' and nullif(btrim(a.card_holder_name),'') is null then raise exception 'Confira o titular do cartao de terceiro em Contas.';end if;
 end if;
 if k='pay_card_statement' then
  select * into s from public.pf_card_statement_dashboard where id=(o->>'card_statement_id')::uuid and household_id=h;
  if not found or s.remaining_amount<>v or s.remaining_amount<=0 or s.version_token is distinct from o->>'statement_version' then raise exception 'Fatura mudou ou pagamento nao e integral. Reanalise.';end if;
 end if;
 if k='reconcile_card' then
  if due is null then raise exception 'Informe o vencimento da fatura.';end if;
  if nullif(o->>'available_credit','') is not null and (jsonb_typeof(o->'available_credit')<>'number' or abs((o->>'available_credit')::numeric)>1000000 or (o->>'available_credit')::numeric<0 or round((o->>'available_credit')::numeric,2)<>(o->>'available_credit')::numeric) then raise exception 'Limite disponivel invalido.';end if;
 end if;
 if k='debt_payment' and not exists(select 1 from public.pf_debts where id=(o->>'debt_id')::uuid and household_id=h and status<>'cancelled' and current_balance>=v and (not coalesce((o->>'count_installment')::boolean,false) or installment_amount=v)) then raise exception 'Divida ou valor de parcela invalido.';end if;
 if k='loan_repayment' and not exists(select 1 from public.pf_personal_loan_positions where id=(o->>'loan_id')::uuid and household_id=h and cancelled_at is null and remaining_amount>=v) then raise exception 'Emprestimo ou valor invalido.';end if;
 if k in ('settle_obligation','receive_income','update_transaction','cancel_transaction') then
  select * into t from public.pf_transactions where id=coalesce(nullif(o->>'transaction_id',''),nullif(o->>'obligation_id',''))::uuid and household_id=h;
  if not found or t.status='cancelled' or t.card_statement_id is not null or t.card_forecast or t.debt_id is not null or t.type not in ('income','expense','transfer','investment_contribution','investment_withdrawal') or t.metadata->>'origin' in ('card_statement_payment','personal_loan','personal_loan_repayment') then raise exception 'Registro exige gerenciamento especifico; nao altere isoladamente.';end if;
  if exists(select 1 from public.pf_transaction_settlements where planned_transaction_id=t.id) then raise exception 'Ha baixas parciais anteriores. Concilie o registro antes.';end if;
  if k in ('settle_obligation','receive_income') and (t.status not in ('planned','overdue') or t.amount<>v or t.type<>case when k='receive_income' then 'income' else 'expense' end) then raise exception 'Previsao alterada, ja recebida/paga ou valor diferente. Reanalise.';end if;
  if k in ('update_transaction','cancel_transaction') then
   if t.updated_at is distinct from (o->>'transaction_version')::timestamptz then raise exception 'Registro mudou. Reanalise a correcao.';end if;
   if t.type not in ('income','expense') then raise exception 'Corrija transferencias e investimentos com conciliacao assistida, preservando as duas contas.';end if;
   if t.status='paid' and (t.metadata ? 'balance_snapshot_accounts' or t.metadata->>'skip_balance_update'='true') and not exists(select 1 from jsonb_array_elements(ops) z where z->>'kind'='reconcile_account' and z->>'account_id'=t.account_id::text) then raise exception 'O registro pertence a saldo ja conciliado. Informe tambem o saldo atual da conta para conferir a correcao.';end if;
   if k='update_transaction' and a.id is distinct from t.account_id then raise exception 'Esta correcao altera somente o valor. Troca de conta exige conciliacao especifica.';end if;
  end if;
 end if;
 if k in ('income','expense') and nullif(o->>'recurrence_id','') is not null then
  rid:=(o->>'recurrence_id')::uuid;
  if coalesce((o->>'monthly')::boolean,false) or not exists(select 1 from public.pf_recurring_templates where id=rid and household_id=h and is_active and type=k and credit_card_account_id is null) then raise exception 'Recorrencia existente invalida. Nao crie outra assinatura.';end if;
  if exists(select 1 from public.pf_transactions z where z.household_id=h and z.recurrence_key=rid and coalesce(z.metadata->>'generated_for',to_char(coalesce(z.due_date,z.occurred_on),'YYYY-MM'))=to_char(coalesce(due,d),'YYYY-MM')) then raise exception 'Ja existe previsao deste ciclo. De baixa no registro existente.';end if;
 end if;
 if k in ('update_recurring','cancel_recurring') then
  rid:=nullif(o->>'recurrence_id','')::uuid;
  if not exists(select 1 from public.pf_recurring_templates where id=rid and household_id=h and is_active and (ends_on is null or ends_on>=due)) or due is null then raise exception 'Recorrencia ativa e data de inicio da alteracao sao obrigatorias.';end if;
  if due<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Altere recorrencias desta data em diante; historico pago e preservado.';end if;
 end if;
end $$;

create or replace function pf_private.prepare_family_batch(h uuid,ops jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare o jsonb;bid uuid;
begin
 perform public.pf_control_write(h);
 if ops is null or jsonb_typeof(ops)<>'array' or jsonb_array_length(ops) not between 1 and 60 or length(ops::text)>100000 then raise exception 'Informe entre 1 e 60 operacoes com tamanho permitido.';end if;
 for o in select value from jsonb_array_elements(ops) loop perform pf_private.validate_family_operation(h,o,ops);end loop;
 insert into public.pf_ai_finance_batches(household_id,created_by,operations,account_snapshot,statement_snapshot,debt_snapshot,loan_snapshot,obligation_snapshot,operation_version,context_snapshot)
 values(h,auth.uid(),ops,'{}','{}','{}','{}','{}',2,pf_private.family_fingerprint(h)) returning id into bid;
 return bid;
end $$;

create or replace function pf_private.confirm_family_batch(bid uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.pf_ai_finance_batches%rowtype;o jsonb;k text;v numeric;d date;due date;
 a public.pf_accounts%rowtype;t public.pf_transactions%rowtype;old_value jsonb;new_value jsonb;
 rid uuid;new_rid uuid;r public.pf_recurring_templates%rowtype;txid uuid;gid uuid;request_id uuid;idx integer:=0;receipt jsonb:='[]';household uuid;current_balance numeric;
begin
 select household_id into household from public.pf_ai_finance_batches where id=bid;
 if household is null or auth.uid() is null or not public.pf_can_write(household) then raise exception 'Plano nao autorizado.';end if;
 perform public.pf_control_write(household);
 select * into b from public.pf_ai_finance_batches where id=bid for update;
 if b.created_by<>auth.uid() or b.operation_version<>2 then raise exception 'Plano nao autorizado ou versao incorreta.';end if;
 if b.status='confirmed' then return b.result;end if;
 if b.status<>'pending' or b.expires_at<now() then raise exception 'Previa cancelada ou expirada. Reanalise.';end if;
 perform 1 from public.pf_accounts where household_id=b.household_id order by id for update;
 if b.context_snapshot is distinct from pf_private.family_fingerprint(b.household_id) then raise exception 'Dados financeiros mudaram apos a previa. Reanalise antes de confirmar.';end if;
 for o in select value from jsonb_array_elements(b.operations) loop perform pf_private.validate_family_operation(b.household_id,o,b.operations);end loop;
 for o in select value from jsonb_array_elements(b.operations) loop
  idx:=idx+1;k:=o->>'kind';v:=(o->>'amount')::numeric;d:=(o->>'occurred_on')::date;due:=nullif(o->>'due_on','')::date;txid:=null;gid:=null;
  request_id:=md5(bid::text||':'||idx::text)::uuid;
  select * into a from public.pf_accounts where id=nullif(o->>'account_id','')::uuid and household_id=b.household_id;
  -- Cross-message duplicates are checked under the same household lock.
  if k in ('income','expense','transfer','investment_contribution','investment_withdrawal','plan_income','plan_expense') and exists(
   select 1 from public.pf_transactions z where z.household_id=b.household_id and z.status<>'cancelled'
   and z.type=case when k='plan_income' then 'income' when k='plan_expense' then 'expense' else k end and z.amount=v
   and z.occurred_on=d and z.account_id is not distinct from a.id
   and z.destination_account_id is not distinct from nullif(o->>'destination_account_id','')::uuid
   and (k not in ('plan_income','plan_expense') or z.due_date=due)
   and (k in ('transfer','investment_contribution','investment_withdrawal') or lower(btrim(z.description))=lower(btrim(o->>'description')) or (nullif(btrim(o->>'merchant'),'') is not null and lower(btrim(z.merchant))=lower(btrim(o->>'merchant'))))
  ) then raise exception 'Possivel movimentacao repetida. Nenhum item deste lote foi gravado.';end if;
  if k in ('income','expense','transfer','investment_contribution','investment_withdrawal','plan_income','plan_expense') then
   insert into public.pf_transactions(household_id,created_by,type,status,description,merchant,amount,original_amount,account_id,destination_account_id,category_id,occurred_on,due_date,paid_at,source,external_id,notes,metadata)
   values(b.household_id,auth.uid(),case when k='plan_income' then 'income' when k='plan_expense' then 'expense' else k end,
   case when k in ('plan_income','plan_expense') then 'planned' else 'paid' end,btrim(o->>'description'),nullif(o->>'merchant',''),v,v,a.id,nullif(o->>'destination_account_id','')::uuid,nullif(o->>'category_id','')::uuid,d,coalesce(due,d),
   case when k in ('plan_income','plan_expense') then null else (d+time '12:00') at time zone 'America/Sao_Paulo' end,
   'ai','kyra-family:'||bid||':'||idx,nullif(o->>'notes',''),jsonb_build_object('origin','family_ai_batch','batch_id',bid,'time_unknown',true,'expected_receipt',k='plan_income','receipt_confidence',case when coalesce((o->>'receipt_confirmed')::boolean,false) then 'confirmed' else 'expected' end)) returning id into txid;
   if k in ('income','expense') and nullif(o->>'recurrence_id','') is not null then
    update public.pf_transactions set recurrence_key=(o->>'recurrence_id')::uuid,metadata=metadata||jsonb_build_object('generated_for',to_char(coalesce(due,d),'YYYY-MM')) where id=txid;
   end if;
   if coalesce((o->>'monthly')::boolean,false) and k in ('expense','income','plan_income','plan_expense') then
    insert into public.pf_recurring_templates(household_id,created_by,account_id,category_id,type,description,merchant,amount,day_of_month,starts_on,is_active,auto_generate,import_key)
    values(b.household_id,auth.uid(),a.id,nullif(o->>'category_id','')::uuid,case when k in ('income','plan_income') then 'income' else 'expense' end,o->>'description',nullif(o->>'merchant',''),v,extract(day from coalesce(due,d)),coalesce(due,d),true,true,'kyra-family:'||bid||':'||idx) returning id into rid;
    update public.pf_transactions set recurrence_key=rid,metadata=metadata||jsonb_build_object('generated_for',to_char(coalesce(due,d),'YYYY-MM')) where id=txid;
   end if;
  elsif k='card_purchase' then
   if exists(select 1 from public.pf_transactions z join public.pf_card_statements cs on cs.id=z.card_statement_id
    where z.household_id=b.household_id and cs.account_id=a.id and z.status<>'cancelled' and not z.card_forecast
    and z.occurred_on=d and z.due_date=due and coalesce(z.installment_number,1)=1
    and coalesce(z.installment_total,1)=coalesce((o->>'installments')::integer,1)
    and (lower(btrim(z.description))=lower(btrim(o->>'description')) or (nullif(btrim(o->>'merchant'),'') is not null and lower(btrim(z.merchant))=lower(btrim(o->>'merchant'))))
    and (select sum(z2.amount) from public.pf_transactions z2 where z2.household_id=b.household_id and z2.status<>'cancelled'
      and (z2.installment_group_id=z.installment_group_id or z2.id=z.id))=v
   ) then raise exception 'Possivel compra de cartao repetida. Nenhum item deste lote foi gravado.';end if;
   if a.card_owner_type='third_party' then
    gid:=public.pf_create_third_party_purchase_v2(b.household_id,a.card_holder_name,coalesce(a.institution_name,''),o->>'description',nullif(o->>'merchant',''),v,coalesce((o->>'installments')::integer,1),due,(o->>'category_id')::uuid,d,nullif(o->>'notes',''),false,request_id);
    if coalesce((o->>'monthly')::boolean,false) then
     insert into public.pf_recurring_templates(household_id,created_by,category_id,type,description,merchant,amount,day_of_month,starts_on,is_active,auto_generate,credit_card_account_id,import_key)
     values(b.household_id,auth.uid(),(o->>'category_id')::uuid,'expense',o->>'description',nullif(o->>'merchant',''),v,extract(day from due),due,true,true,a.id,'kyra-family:'||bid||':'||idx) returning id into rid;
     update public.pf_transactions set recurrence_key=rid,metadata=metadata||jsonb_build_object('recurrence_charge_month',to_char(due,'YYYY-MM')) where household_id=b.household_id and installment_group_id=gid;
    end if;
   else
    gid:=public.pf_create_card_purchase_v2(b.household_id,a.id,o->>'description',nullif(o->>'merchant',''),v,coalesce((o->>'installments')::integer,1),due,(o->>'category_id')::uuid,null,d,false,coalesce((o->>'monthly')::boolean,false),null,nullif(o->>'notes',''),false,request_id);
   end if;
  elsif k='pay_card_statement' then
   txid:=(public.pf_pay_card_statement_v2((o->>'card_statement_id')::uuid,a.id,d,request_id,o->>'statement_version')->>'id')::uuid;
  elsif k='debt_payment' then
   txid:=public.pf_register_debt_payment((o->>'debt_id')::uuid,a.id,v,d,coalesce((o->>'count_installment')::boolean,false), 'Kyra familia: '||bid);
  elsif k='loan_repayment' then
   txid:=public.pf_receive_personal_loan_v1((o->>'loan_id')::uuid,a.id,v,d,request_id);
  elsif k in ('settle_obligation','receive_income','update_transaction','cancel_transaction') then
   select * into t from public.pf_transactions where id=coalesce(nullif(o->>'transaction_id',''),nullif(o->>'obligation_id',''))::uuid and household_id=b.household_id for update;old_value:=to_jsonb(t);
   if k in ('settle_obligation','receive_income') then
    update public.pf_transactions set status='paid',account_id=a.id,paid_at=(d+time '12:00') at time zone 'America/Sao_Paulo',occurred_on=d,updated_at=now(),metadata=metadata||jsonb_build_object('settled_by_batch',bid) where id=t.id;
   elsif k='update_transaction' then
    update public.pf_transactions set amount=v,original_amount=v,updated_at=now(),metadata=metadata||jsonb_build_object('corrected_by_batch',bid,'previous_amount',t.amount) where id=t.id;
   else
    update public.pf_transactions set status='cancelled',updated_at=now(),metadata=metadata||jsonb_build_object('cancelled_by_batch',bid) where id=t.id;
   end if;
   select to_jsonb(z) into new_value from public.pf_transactions z where id=t.id;
   insert into public.pf_finance_change_audit(household_id,batch_id,transaction_id,created_by,before_value,after_value) values(b.household_id,bid,t.id,auth.uid(),old_value,new_value);txid:=t.id;
  elsif k='reconcile_account' then
   select balance into current_balance from public.pf_accounts where id=a.id;
   txid:=public.pf_reconcile_account_v1(a.id,v,o->>'description',current_balance);
  elsif k='reconcile_card' then
   txid:=public.pf_reconcile_card_v1(a.id,due,v,coalesce(nullif(o->>'available_credit','')::numeric,a.available_credit),o->>'description');
  elsif k='set_reserve' then
   insert into public.pf_family_preferences(household_id,minimum_reserve) values(b.household_id,v)
   on conflict(household_id) do update set minimum_reserve=excluded.minimum_reserve,updated_at=now();
  elsif k in ('update_recurring','cancel_recurring') then
   rid:=(o->>'recurrence_id')::uuid;
   perform set_config('pf.reconciliation_batch','on',true);
   select * into r from public.pf_recurring_templates where id=rid and household_id=b.household_id for update;
   update public.pf_recurring_templates set is_active=case when due<=starts_on then false else is_active end,ends_on=case when due>starts_on then due-1 else ends_on end,updated_at=now() where id=rid and household_id=b.household_id;
   new_rid:=null;
   if k='update_recurring' then
    insert into public.pf_recurring_templates(household_id,created_by,account_id,category_id,type,description,merchant,amount,day_of_month,starts_on,ends_on,is_active,auto_generate,is_variable,is_essential,credit_card_account_id,notes,import_key)
    values(b.household_id,auth.uid(),r.account_id,r.category_id,r.type,r.description,r.merchant,v,r.day_of_month,greatest(due,r.starts_on),r.ends_on,true,r.auto_generate,r.is_variable,r.is_essential,r.credit_card_account_id,r.notes,'kyra-family:'||bid||':'||idx) returning id into new_rid;
   end if;
   perform set_config('pf.reconciliation_batch','off',true);
   update public.pf_transactions z set amount=case when k='update_recurring' then v else z.amount end,original_amount=case when k='update_recurring' then v else z.original_amount end,
    status=case when k='cancel_recurring' then 'cancelled' else z.status end,recurrence_key=coalesce(new_rid,z.recurrence_key),updated_at=now(),metadata=z.metadata||jsonb_build_object('recurring_changed_batch',bid)
    where z.household_id=b.household_id and z.recurrence_key=rid and z.status in ('planned','overdue') and coalesce(z.due_date,z.occurred_on)>=due and z.card_statement_id is null
    and not exists(select 1 from public.pf_transaction_settlements x where x.planned_transaction_id=z.id);
  end if;
  receipt:=receipt||jsonb_build_array(jsonb_build_object('position',idx,'kind',k,'id',txid,'group_id',gid,'amount',v));
 end loop;
 update public.pf_ai_finance_batches set status='confirmed',confirmed_at=now(),result=jsonb_build_object('batch_id',bid,'operations',receipt,'confirmed_at',now()) where id=bid;
 return jsonb_build_object('batch_id',bid,'operations',receipt,'confirmed_at',now());
end $$;

create or replace function public.pf_prepare_ai_finance_batch_v2(p_household uuid,p_operations jsonb) returns uuid language sql security invoker set search_path=public,pg_temp as $$select pf_private.prepare_family_batch(p_household,p_operations)$$;
create or replace function public.pf_confirm_ai_finance_batch_v2(p_batch uuid) returns jsonb language sql security invoker set search_path=public,pg_temp as $$select pf_private.confirm_family_batch(p_batch)$$;
revoke all on all functions in schema pf_private from public,anon;
grant execute on function pf_private.family_fingerprint(uuid),pf_private.validate_family_operation(uuid,jsonb,jsonb),pf_private.prepare_family_batch(uuid,jsonb),pf_private.confirm_family_batch(uuid) to authenticated;
revoke all on function public.pf_prepare_ai_finance_batch_v2(uuid,jsonb),public.pf_confirm_ai_finance_batch_v2(uuid) from public,anon;
grant execute on function public.pf_prepare_ai_finance_batch_v2(uuid,jsonb),public.pf_confirm_ai_finance_batch_v2(uuid) to authenticated;
commit;
notify pgrst,'reload schema';
