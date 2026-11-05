-- Painel mensal de faturas e pagamento integral (requer as migracoes 001 a 038).
-- Executar este arquivo inteiro no SQL Editor do Supabase. Pode ser repetido.
-- Nao altera saldos bancarios, limites, reservas ou lancamentos ja pagos na migracao.
begin;

alter table public.pf_accounts add column if not exists card_owner_type text not null default 'own'
 check (card_owner_type in ('own','third_party'));
alter table public.pf_accounts add column if not exists card_holder_name text;
update public.pf_accounts set card_owner_type='third_party',card_holder_name=coalesce(card_holder_name,btrim(split_part(name,' - ',1)))
 where type='credit_card' and name ~* '(emprestad|terceir)' and card_owner_type='own';

create or replace function public.pf_card_holder_key(p_name text) returns text
 language sql immutable strict set search_path=public,pg_temp as $$
 select lower(regexp_replace(btrim(p_name),'\s+',' ','g'));
$$;

-- Funcao interna: reutiliza o cadastro de controle existente, sem criar conta bancaria.
create or replace function public.pf_ensure_third_party_card_v1(p_household uuid,p_holder text,p_institution text,p_due date)
 returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare card uuid; matches integer; holder text:=nullif(btrim(p_holder),'');
begin
 if holder is null then raise exception 'Informe o titular do cartao de terceiro.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household::text,38));
 select count(*),(array_agg(a.id order by a.created_at,a.id))[1] into matches,card
 from public.pf_accounts a where a.household_id=p_household and a.type='credit_card' and (
   (a.card_owner_type='third_party' and public.pf_card_holder_key(a.card_holder_name)=public.pf_card_holder_key(holder))
   or (a.card_holder_name is null and public.pf_card_holder_key(split_part(a.name,' - ',1))=public.pf_card_holder_key(holder)
       and a.name ~* '(emprestad|terceir|controle)')
 );
 if matches>1 then raise exception 'Ha mais de um cadastro para o cartao de %. Unifique os cadastros antes de continuar.',holder; end if;
 if card is null then
  insert into public.pf_accounts(household_id,owner_user_id,name,institution_name,type,balance,card_owner_type,card_holder_name,due_day)
  select p_household,h.created_by,holder||' - Cartao de terceiro',nullif(btrim(p_institution),''),'credit_card',0,'third_party',holder,extract(day from p_due)::int
  from public.pf_households h where h.id=p_household returning id into card;
 else
  update public.pf_accounts set card_owner_type='third_party',card_holder_name=holder where id=card;
 end if;
 if card is null then raise exception 'Grupo nao encontrado.'; end if;
 return card;
end $$;
revoke all on function public.pf_ensure_third_party_card_v1(uuid,text,text,date) from public,anon,authenticated;

create or replace function public.pf_attach_third_party_statement_v1() returns trigger
 language plpgsql security definer set search_path=public,pg_temp as $$
declare card uuid; bill uuid; paid numeric; previous_trust text:=coalesce(current_setting('pf.trusted_finance',true),'');
begin
 if new.card_statement_id is not null and new.status in ('paid','cancelled') and new.metadata->>'card_owner_type'='third_party' then
  perform public.pf_refresh_card_account((select account_id from public.pf_card_statements where id=new.card_statement_id));
  return new;
 end if;
 if new.type<>'expense' or new.status not in ('planned','overdue') or new.card_forecast
    or new.metadata->>'payment_method' is distinct from 'credit_card'
    or nullif(new.metadata->>'credit_card_account_id','') is not null
    or nullif(btrim(new.metadata->>'card_holder'),'') is null
    or coalesce(new.metadata->>'settlement_completed','false')='true' then return new; end if;
 if exists(select 1 from public.pf_transaction_settlements where planned_transaction_id=new.id) then return new; end if;
 if new.due_date is null then raise exception 'Informe o vencimento da compra no cartao de terceiro.'; end if;
 card:=public.pf_ensure_third_party_card_v1(new.household_id,new.metadata->>'card_holder',new.metadata->>'card_institution',new.due_date);
 if exists(select 1 from public.pf_card_statements where id=new.card_statement_id and account_id=card and due_date=new.due_date) then
  perform public.pf_refresh_card_account(card); return new;
 end if;
 insert into public.pf_card_statements(household_id,account_id,due_date) values(new.household_id,card,new.due_date)
 on conflict(account_id,due_date) do nothing;
 select id,paid_amount into bill,paid from public.pf_card_statements where account_id=card and due_date=new.due_date for update;
 if paid>0 then raise exception 'Esta fatura ja recebeu pagamento. Confira o vencimento da nova compra.'; end if;
 perform set_config('pf.trusted_finance','on',true);
 update public.pf_transactions set card_statement_id=bill,
   metadata=metadata||jsonb_build_object('card_owner_type','third_party'),updated_at=now() where id=new.id;
 perform public.pf_refresh_card_account(card);
 perform set_config('pf.trusted_finance',previous_trust,true);
 return new;
end $$;
revoke all on function public.pf_attach_third_party_statement_v1() from public,anon,authenticated;

-- Somente parcelas em aberto. Vencimentos divergentes permanecem separados para conferencia.
-- Um saldo sem detalhamento preexistente exige conciliacao humana para evitar duplicacao.
do $$ declare r record; card uuid; bill uuid; before_trust text:=coalesce(current_setting('pf.trusted_finance',true),''); begin
 perform set_config('pf.trusted_finance','on',true);
 for r in select * from public.pf_transactions t where t.type='expense' and t.status in ('planned','overdue')
  and t.card_statement_id is null and not t.card_forecast and t.due_date is not null
  and t.metadata->>'payment_method'='credit_card' and nullif(t.metadata->>'credit_card_account_id','') is null
  and nullif(btrim(t.metadata->>'card_holder'),'') is not null and coalesce(t.metadata->>'settlement_completed','false')<>'true'
  and not exists(select 1 from public.pf_transaction_settlements z where z.planned_transaction_id=t.id)
  order by t.household_id,t.due_date,t.id
 loop
  card:=public.pf_ensure_third_party_card_v1(r.household_id,r.metadata->>'card_holder',r.metadata->>'card_institution',r.due_date);
  if exists(select 1 from public.pf_card_statements where account_id=card and due_date=r.due_date and (unallocated_amount>0 or paid_amount>0)) then
   raise exception 'Cartao %, vencimento %: ha saldo conciliado ou pagamento anterior. Confira estes registros antes de vincular parcelas.',r.metadata->>'card_holder',r.due_date;
  end if;
  insert into public.pf_card_statements(household_id,account_id,due_date) values(r.household_id,card,r.due_date) on conflict(account_id,due_date) do nothing;
  select id into bill from public.pf_card_statements where account_id=card and due_date=r.due_date;
  update public.pf_transactions set card_statement_id=bill,metadata=metadata||jsonb_build_object('card_owner_type','third_party'),updated_at=now() where id=r.id;
  perform public.pf_refresh_card_account(card);
 end loop;
 perform set_config('pf.trusted_finance',before_trust,true);
end $$;
drop trigger if exists pf_attach_third_party_statement on public.pf_transactions;
create trigger pf_attach_third_party_statement after insert or update on public.pf_transactions
 for each row execute function public.pf_attach_third_party_statement_v1();

create or replace view public.pf_card_statement_dashboard with(security_invoker=true) as
select s.*,a.name as card_name,a.institution_name,a.card_owner_type,a.card_holder_name,
 coalesce(i.item_count,0)::int as item_count,
 md5(jsonb_build_array(s.id,s.due_date,s.unallocated_amount,s.paid_amount,coalesce(i.snapshot,'[]'::jsonb))::text) as version_token
from public.pf_card_statement_positions s join public.pf_accounts a on a.id=s.account_id and a.household_id=s.household_id
left join lateral (
 select count(*) filter(where t.status<>'cancelled' and not t.card_forecast) as item_count,
 jsonb_agg(jsonb_build_array(t.id,t.amount,t.status,t.due_date,t.card_forecast,extract(epoch from t.updated_at)) order by t.id) as snapshot
 from public.pf_transactions t where t.card_statement_id=s.id and t.household_id=s.household_id
) i on true;
grant select on public.pf_card_statement_dashboard to authenticated;

-- A assinatura antiga continua disponivel para o assistente e clientes ja instalados.
-- Preserva o limite confirmado: o gatilho 029 nao conhece as regras do pre-pago.
create or replace function public.pf_pay_card_statement_v1(p_statement uuid,p_bank uuid,p_date date,p_request uuid) returns uuid
 language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.pf_card_statements%rowtype; household uuid; remaining numeric; tx uuid; available_before numeric;
 prior public.pf_control_operations%rowtype;
begin
 select household_id into household from public.pf_card_statements where id=p_statement;
 if household is null then raise exception 'Fatura nao encontrada.'; end if;
 perform public.pf_control_write(household);
 if p_request is null then raise exception 'Identificador de pagamento obrigatorio.'; end if;
 select * into prior from public.pf_control_operations where household_id=household and request_id=p_request;
 if found then
  if prior.operation not in ('pay_card','pay_card_v2') or not exists(select 1 from public.pf_transactions
   where id=(prior.result->>'id')::uuid and household_id=household and account_id=p_bank and occurred_on=p_date
   and metadata->>'statement_id'=p_statement::text and metadata->>'origin'='card_statement_payment') then
   raise exception 'Requisicao ja usada em outra operacao.';
  end if;
  return (prior.result->>'id')::uuid;
 end if;
 select * into s from public.pf_card_statements where id=p_statement for update;
 perform 1 from public.pf_transactions where card_statement_id=s.id order by id for update;
 select remaining_amount into remaining from public.pf_card_statement_positions where id=s.id;
 if remaining<=0 then raise exception 'Fatura ja quitada.'; end if;
 if p_date is null or p_date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe a data real do pagamento.'; end if;
 if not exists(select 1 from public.pf_accounts where id=p_bank and household_id=household and is_active and type in ('checking','savings','cash','wallet')) then raise exception 'Selecione a conta bancaria pagadora.'; end if;
 if exists(select 1 from public.pf_transactions t where t.card_statement_id=s.id and (
  (t.status='paid' and t.metadata->>'paid_by_statement' is null) or
  exists(select 1 from public.pf_transaction_settlements z where z.planned_transaction_id=t.id))) then
  raise exception 'Ha baixa avulsa anterior nesta fatura. Concilie os pagamentos antes de pagar a fatura inteira.';
 end if;
 select available_credit into available_before from public.pf_accounts where id=s.account_id for update;
 if s.unallocated_amount>0 then
  insert into public.pf_transactions(household_id,created_by,type,status,description,amount,occurred_on,due_date,card_statement_id,card_included_in_snapshot,metadata)
  values(household,auth.uid(),'expense','planned','Parcela da fatura sem detalhamento',s.unallocated_amount,p_date,s.due_date,s.id,true,jsonb_build_object('credit_card_account_id',s.account_id,'origin','statement_unallocated'));
  update public.pf_card_statements set unallocated_amount=0 where id=s.id;
 end if;
 insert into public.pf_transactions(household_id,account_id,destination_account_id,created_by,type,status,description,amount,occurred_on,paid_at,metadata)
 values(household,p_bank,s.account_id,auth.uid(),'transfer','paid','Pagamento de fatura - '||s.due_date,remaining,p_date,
  (p_date+time '12:00') at time zone 'America/Sao_Paulo',jsonb_build_object('origin','card_statement_payment','statement_id',s.id)) returning id into tx;
 update public.pf_transactions set status='paid',paid_at=(p_date+time '12:00') at time zone 'America/Sao_Paulo',
  metadata=metadata||jsonb_build_object('skip_balance_update',true,'paid_by_statement',tx),updated_at=now()
 where card_statement_id=s.id and status in ('planned','overdue') and not card_forecast;
 update public.pf_card_statements set paid_amount=paid_amount+remaining where id=s.id;
 update public.pf_accounts set available_credit=available_before where id=s.account_id and available_credit is distinct from available_before;
 perform public.pf_refresh_card_account(s.account_id);
 insert into public.pf_control_operations(household_id,request_id,operation,result) values(household,p_request,'pay_card',jsonb_build_object('id',tx));
 return tx;
end $$;
revoke all on function public.pf_pay_card_statement_v1(uuid,uuid,date,uuid) from public,anon;
grant execute on function public.pf_pay_card_statement_v1(uuid,uuid,date,uuid) to authenticated;

-- Valida a versao mostrada na confirmacao. A repeticao da mesma requisicao retorna o recibo.
create or replace function public.pf_pay_card_statement_v2(p_statement uuid,p_bank uuid,p_date date,p_request uuid,p_expected_version text)
 returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.pf_card_statement_dashboard%rowtype; household uuid; prior public.pf_control_operations%rowtype;
 tx uuid; receipt jsonb; input jsonb:=jsonb_build_object('statement',p_statement,'bank',p_bank,'date',p_date,'version',p_expected_version);
begin
 select household_id into household from public.pf_card_statements where id=p_statement;
 if household is null then raise exception 'Fatura nao encontrada.'; end if;
 perform public.pf_control_write(household);
 if p_request is null then raise exception 'Identificador de pagamento obrigatorio.'; end if;
 select * into prior from public.pf_control_operations where household_id=household and request_id=p_request;
 if found then
  if prior.operation<>'pay_card_v2' or prior.result->'input' is distinct from input then raise exception 'Requisicao ja usada em outra operacao.'; end if;
  return prior.result;
 end if;
 perform 1 from public.pf_card_statements where id=p_statement for update;
 perform 1 from public.pf_transactions where card_statement_id=p_statement order by id for update;
 select * into s from public.pf_card_statement_dashboard where id=p_statement;
 if p_expected_version is null or s.version_token is distinct from p_expected_version then
  raise exception 'A fatura mudou desde a conferencia. Atualize o painel e confira os itens novamente.';
 end if;
 if s.remaining_amount<=0 then raise exception 'Fatura ja quitada.'; end if;
 if exists(select 1 from public.pf_transactions where card_statement_id=s.id and not card_forecast and status='paid' and metadata->>'paid_by_statement' is null) then
  raise exception 'Esta fatura possui item pago fora do fluxo de faturas. Concilie o pagamento anterior antes de pagar.';
 end if;
 if exists(select 1 from public.pf_transaction_settlements z join public.pf_transactions t on t.id=z.planned_transaction_id where t.card_statement_id=s.id) then
  raise exception 'Esta fatura possui baixa avulsa anterior. Concilie os pagamentos antes de pagar a fatura inteira.';
 end if;
 tx:=public.pf_pay_card_statement_v1(p_statement,p_bank,p_date,p_request);
 receipt:=jsonb_build_object('id',tx,'statement_id',s.id,'amount',s.remaining_amount,'item_count',s.item_count,
   'paid_on',p_date,'input',input,'credit_limit_changed',false);
 update public.pf_control_operations set operation='pay_card_v2',result=receipt where household_id=household and request_id=p_request;
 return receipt;
end $$;

-- Unificacao explicita: apenas faturas sem pagamento, do MESMO cartao e mes.
-- Nenhum outro mes, saldo de banco, limite ou compra paga e alterado.
create or replace function public.pf_merge_card_statements_v1(p_account uuid,p_month date,p_due date,p_expected_versions jsonb,p_request uuid)
 returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare household uuid; ids uuid[]; target uuid; expected jsonb; actual jsonb; prior public.pf_control_operations%rowtype;
 backup jsonb; total numeric; detail numeric; receipt jsonb; n integer;
 input jsonb:=jsonb_build_object('account',p_account,'month',p_month,'due',p_due,'versions',p_expected_versions);
begin
 select household_id into household from public.pf_accounts where id=p_account and type='credit_card';
 if household is null then raise exception 'Cartao nao encontrado.'; end if;
 perform public.pf_control_write(household);
 if p_request is null or p_month is null or p_due is null or date_trunc('month',p_month)<>date_trunc('month',p_due) then
  raise exception 'Escolha um vencimento no mesmo mes das faturas.';
 end if;
 select * into prior from public.pf_control_operations where household_id=household and request_id=p_request;
 if found then
  if prior.operation<>'merge_card' or prior.result->'input' is distinct from input then raise exception 'Requisicao ja usada em outra operacao.'; end if;
  return prior.result;
 end if;
 perform 1 from public.pf_card_statements where account_id=p_account and date_trunc('month',due_date)=date_trunc('month',p_month) order by id for update;
 select array_agg(id order by id),sum(total_amount),sum(unallocated_amount),count(*) into ids,total,detail,n
 from public.pf_card_statement_dashboard where account_id=p_account and date_trunc('month',due_date)=date_trunc('month',p_month) and remaining_amount>0;
 if coalesce(n,0)<2 then raise exception 'Selecione pelo menos duas faturas em aberto do mesmo mes.'; end if;
 perform 1 from public.pf_transactions where card_statement_id=any(ids) order by id for update;
 if exists(select 1 from public.pf_card_statements where id=any(ids) and paid_amount<>0) or
    exists(select 1 from public.pf_transactions where card_statement_id=any(ids) and status='paid') then
  raise exception 'Faturas com pagamentos anteriores nao podem ser unificadas.';
 end if;
 select jsonb_agg(jsonb_build_object('id',id,'version',version_token) order by id) into actual
 from public.pf_card_statement_dashboard where id=any(ids);
 select jsonb_agg(jsonb_build_object('id',v->>'id','version',v->>'version') order by v->>'id') into expected from jsonb_array_elements(p_expected_versions) v;
 if expected is distinct from actual then raise exception 'As faturas mudaram. Atualize o painel e confira novamente.'; end if;
 if exists(select 1 from public.pf_card_statements where account_id=p_account and due_date=p_due and paid_amount>0) then
  raise exception 'O vencimento escolhido ja possui uma fatura paga.';
 end if;
 select jsonb_build_object('statements',(select jsonb_agg(to_jsonb(s)) from public.pf_card_statements s where id=any(ids)),
  'items',(select jsonb_agg(jsonb_build_object('id',id,'due_date',due_date,'statement_id',card_statement_id)) from public.pf_transactions where card_statement_id=any(ids))) into backup;
 insert into public.pf_card_statements(household_id,account_id,due_date) values(household,p_account,p_due) on conflict(account_id,due_date) do nothing;
 select id into target from public.pf_card_statements where account_id=p_account and due_date=p_due;
 update public.pf_card_statements set unallocated_amount=0 where id=any(ids);
 update public.pf_card_statements set unallocated_amount=detail where id=target;
 update public.pf_transactions set card_statement_id=target,due_date=p_due,
  metadata=metadata||jsonb_build_object('statement_previous_due',due_date,'statement_merge_request',p_request),updated_at=now()
 where card_statement_id=any(ids) and status in ('planned','overdue') and not card_forecast;
 if (select total_amount from public.pf_card_statement_positions where id=target) is distinct from total then raise exception 'A unificacao nao conservou o total. Nenhuma alteracao foi salva.'; end if;
 perform public.pf_refresh_card_account(p_account);
 receipt:=jsonb_build_object('id',target,'amount',total,'due_date',p_due,'input',input,'before',backup);
 insert into public.pf_control_operations(household_id,request_id,operation,result) values(household,p_request,'merge_card',receipt);
 return receipt;
end $$;

-- Nova compra de terceiro usa a data informada e a mesma protecao contra repeticao.
create or replace function public.pf_create_third_party_purchase_v2(p_household uuid,p_holder text,p_institution text,p_description text,p_merchant text,
 p_amount numeric,p_count integer,p_first_due date,p_category uuid,p_purchased_on date,p_notes text,p_essential boolean,p_request uuid)
 returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare gid uuid; prior public.pf_control_operations%rowtype; input jsonb;
begin
 perform public.pf_control_write(p_household);
 if p_request is null or p_purchased_on is null or p_purchased_on>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe a data real da compra e o identificador da requisicao.'; end if;
 if nullif(btrim(p_description),'') is null then raise exception 'Informe a descricao da compra.'; end if;
 input:=jsonb_build_array(p_holder,p_institution,p_description,p_merchant,p_amount,p_count,p_first_due,p_category,p_purchased_on,p_notes,p_essential);
 select * into prior from public.pf_control_operations where household_id=p_household and request_id=p_request;
 if found then
  if prior.operation<>'third_party_purchase' or prior.result->'input' is distinct from input then raise exception 'Requisicao ja usada em outra operacao.'; end if;
  return (prior.result->>'id')::uuid;
 end if;
 if p_amount*100<p_count then raise exception 'Cada parcela deve ter pelo menos um centavo.'; end if;
 select installment_group_id into gid from public.pf_create_installment_purchase_v1(p_household,p_description,p_merchant,p_amount,p_count,p_first_due,p_category,null,p_holder,p_institution,p_notes,p_essential);
 update public.pf_transactions set occurred_on=p_purchased_on,
  metadata=metadata||jsonb_build_object('purchase_date',p_purchased_on,'date_unknown',false),updated_at=now()
 where household_id=p_household and installment_group_id=gid;
 insert into public.pf_control_operations(household_id,request_id,operation,result) values(p_household,p_request,'third_party_purchase',jsonb_build_object('id',gid,'input',input));
 return gid;
end $$;

revoke all on function public.pf_card_holder_key(text) from public,anon;
grant execute on function public.pf_card_holder_key(text) to authenticated;
revoke all on function public.pf_pay_card_statement_v2(uuid,uuid,date,uuid,text) from public,anon;
revoke all on function public.pf_merge_card_statements_v1(uuid,date,date,jsonb,uuid) from public,anon;
revoke all on function public.pf_create_third_party_purchase_v2(uuid,text,text,text,text,numeric,integer,date,uuid,date,text,boolean,uuid) from public,anon;
grant execute on function public.pf_pay_card_statement_v2(uuid,uuid,date,uuid,text),
 public.pf_merge_card_statements_v1(uuid,date,date,jsonb,uuid),
 public.pf_create_third_party_purchase_v2(uuid,text,text,text,text,numeric,integer,date,uuid,date,text,boolean,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
