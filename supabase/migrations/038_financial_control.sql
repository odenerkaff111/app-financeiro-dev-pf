-- 038: Controle de saldo, PF/PJ, emprestimos, faturas e parcelamentos.
-- Executar uma vez no SQL Editor. Seguro para repetir a estrutura.
begin;

alter table public.pf_accounts add column if not exists account_scope text not null default 'personal' check (account_scope in ('personal','business'));
alter table public.pf_accounts add column if not exists reconciliation_required boolean not null default false;
alter table public.pf_transactions add column if not exists financial_scope text not null default 'personal' check (financial_scope in ('personal','business'));
alter table public.pf_transactions drop constraint if exists pf_transactions_type_check;
alter table public.pf_transactions add constraint pf_transactions_type_check check(type in ('income','expense','transfer','debt_received','debt_payment','investment_contribution','investment_withdrawal','adjustment','loan_given','loan_repayment'));

create table if not exists public.pf_balance_reconciliations (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.pf_households(id),
 account_id uuid not null references public.pf_accounts(id), previous_balance numeric(14,2) not null,
 confirmed_balance numeric(14,2) not null, reason text not null check(length(btrim(reason))>=5),
 created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb
);
create table if not exists public.pf_reconciliation_tasks (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.pf_households(id),
 account_id uuid references public.pf_accounts(id), task_key text not null, description text not null,
 details jsonb not null default '{}'::jsonb, resolved_at timestamptz, resolved_by uuid references auth.users(id),
 created_at timestamptz not null default now(), unique(household_id,task_key)
);
create table if not exists public.pf_card_statements (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.pf_households(id),
 account_id uuid not null references public.pf_accounts(id), due_date date not null,
 unallocated_amount numeric(14,2) not null default 0 check(unallocated_amount>=0),
 paid_amount numeric(14,2) not null default 0 check(paid_amount>=0),
 created_at timestamptz not null default now(), unique(account_id,due_date)
);
alter table public.pf_transactions add column if not exists card_statement_id uuid references public.pf_card_statements(id);
alter table public.pf_transactions add column if not exists card_included_in_snapshot boolean not null default false;
alter table public.pf_transactions add column if not exists card_forecast boolean not null default false;
alter table public.pf_recurring_templates add column if not exists credit_card_account_id uuid references public.pf_accounts(id);
create index if not exists pf_transactions_card_statement_idx on public.pf_transactions(card_statement_id);
create table if not exists public.pf_personal_loans (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.pf_households(id),
 borrower text not null check(length(btrim(borrower))>0), principal numeric(14,2) not null check(principal>0),
 given_on date, due_date date, source_account_id uuid references public.pf_accounts(id),
 historical boolean not null default false, notes text, created_by uuid references auth.users(id),
 created_at timestamptz not null default now(), cancelled_at timestamptz
);
create table if not exists public.pf_loan_repayments (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.pf_households(id),
 loan_id uuid not null references public.pf_personal_loans(id), account_id uuid not null references public.pf_accounts(id),
 amount numeric(14,2) not null check(amount>0), received_on date not null,
 transaction_id uuid not null references public.pf_transactions(id), request_id uuid not null unique,
 created_at timestamptz not null default now()
);
create table if not exists public.pf_control_operations (
 household_id uuid not null references public.pf_households(id), request_id uuid not null,
 operation text not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(household_id,request_id)
);

-- All writes to new ledgers go through permission-checked RPCs.
do $$ declare n text; begin
 foreach n in array array['pf_balance_reconciliations','pf_reconciliation_tasks','pf_card_statements','pf_personal_loans','pf_loan_repayments','pf_control_operations'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('drop policy if exists control_read on public.%I',n);
  execute format('create policy control_read on public.%I for select to authenticated using (public.pf_is_member(household_id))',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
  execute format('grant select on public.%I to authenticated',n);
  execute format('grant all on public.%I to service_role',n);
 end loop;
end $$;

create or replace function public.pf_control_write(p_household uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not public.pf_can_write(p_household) then raise exception 'Sem permissao de escrita neste grupo.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_household::text,38));
 perform set_config('pf.trusted_finance','on',true);
end $$;

create or replace view public.pf_card_statement_positions with(security_invoker=true) as
select s.*,coalesce(t.itemized,0)::numeric(14,2) as itemized_amount,
 (s.unallocated_amount+coalesce(t.itemized,0))::numeric(14,2) as total_amount,
 greatest(s.unallocated_amount+coalesce(t.itemized,0)-s.paid_amount,0)::numeric(14,2) as remaining_amount
from public.pf_card_statements s left join lateral (
 select sum(amount) itemized from public.pf_transactions t
 where t.card_statement_id=s.id and t.status<>'cancelled' and not t.card_forecast
) t on true;
create or replace view public.pf_personal_loan_positions with(security_invoker=true) as
select l.*,coalesce(r.repaid,0)::numeric(14,2) as repaid_amount,
 greatest(l.principal-coalesce(r.repaid,0),0)::numeric(14,2) as remaining_amount
from public.pf_personal_loans l left join lateral (
 select sum(amount) repaid from public.pf_loan_repayments r where r.loan_id=l.id
) r on true;
grant select on public.pf_card_statement_positions,public.pf_personal_loan_positions to authenticated;

create or replace function public.pf_refresh_card_account(p_account uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.pf_accounts a set balance=coalesce((select s.remaining_amount from public.pf_card_statement_positions s
 where s.account_id=p_account and s.remaining_amount>0 order by s.due_date limit 1),0),balance_updated_at=now(),updated_at=now() where a.id=p_account;
end $$;

create or replace function public.pf_control_transaction_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare planned public.pf_transactions%rowtype; card_id uuid; trusted boolean:=coalesce(current_setting('pf.trusted_finance',true),'')='on';
begin
 if coalesce(current_setting('pf.reconciliation_batch',true),'')='on' then if tg_op='DELETE' then return old; else return new; end if; end if;
 if tg_op='DELETE' then
  if old.card_statement_id is not null or old.type in ('loan_given','loan_repayment') or old.metadata->>'origin'='card_statement_payment' then raise exception 'Use o gerenciamento de fatura ou emprestimo; nao exclua este registro isoladamente.'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and not trusted and (old.card_statement_id is not null or old.type in ('loan_given','loan_repayment') or old.metadata->>'origin'='card_statement_payment') then
  if to_jsonb(new)-array['notes','updated_at','budget_id'] is distinct from to_jsonb(old)-array['notes','updated_at','budget_id'] then raise exception 'Use o gerenciamento de fatura, parcelamento ou emprestimo para alterar este registro.'; end if;
 end if;
 if not trusted and (tg_op='INSERT' or old.metadata->>'skip_balance_update' is distinct from new.metadata->>'skip_balance_update')
 and (new.metadata->>'skip_balance_update'='true' or old.metadata->>'skip_balance_update'='true') then raise exception 'Use a conciliacao para registrar um saldo historico.'; end if;
 if not trusted and (tg_op='INSERT' or old.metadata->'balance_snapshot_accounts' is distinct from new.metadata->'balance_snapshot_accounts') and new.metadata ? 'balance_snapshot_accounts' then raise exception 'Use a conciliacao de conta.'; end if;
 if not trusted and (tg_op='INSERT' or old.card_statement_id is distinct from new.card_statement_id or old.type is distinct from new.type) and (new.card_statement_id is not null or new.type in ('loan_given','loan_repayment') or new.metadata->>'origin'='card_statement_payment') then raise exception 'Use o formulario especifico desta operacao.'; end if;
 if not trusted and tg_op='UPDATE' and old.metadata ? 'balance_snapshot_accounts' and old.metadata->'balance_snapshot_accounts' is distinct from new.metadata->'balance_snapshot_accounts' then raise exception 'Um marcador de conciliacao nao pode ser removido.'; end if;
 -- Existing settlement RPCs must carry only the explicitly selected budget.
 if tg_op='INSERT' and new.metadata->>'planned_transaction_id' is not null then
  select * into planned from public.pf_transactions where id=(new.metadata->>'planned_transaction_id')::uuid and household_id=new.household_id;
  if found then
   if planned.card_statement_id is not null or planned.card_forecast then raise exception 'Pague a cobranca no painel de faturas, nao como despesa bancaria avulsa.'; end if;
   new.budget_id:=planned.budget_id;
  end if;
 end if;
 if new.recurrence_key is not null and new.metadata->>'origin'='recurring_template' and new.card_statement_id is null then
  select credit_card_account_id into card_id from public.pf_recurring_templates where id=new.recurrence_key and household_id=new.household_id;
  if card_id is not null then
   new.account_id:=null; new.card_forecast:=true;
   new.metadata:=new.metadata||jsonb_build_object('credit_card_account_id',card_id,'payment_method','credit_card','charge_confirmed',false);
  end if;
 end if;
 if new.account_id is not null then
  select account_scope into new.financial_scope from public.pf_accounts where id=new.account_id and household_id=new.household_id;
  if new.financial_scope is null then raise exception 'Conta de outro grupo.'; end if;
 end if;
 if new.budget_id is not null and not exists(select 1 from public.pf_budgets where id=new.budget_id and household_id=new.household_id) then raise exception 'Planejamento de outro grupo.'; end if;
 if new.card_statement_id is not null and not exists(select 1 from public.pf_card_statements where id=new.card_statement_id and household_id=new.household_id) then raise exception 'Fatura de outro grupo.'; end if;
 if new.status='paid' and (tg_op='INSERT' or old.status<>'paid') and not trusted then
  if new.account_id is null then raise exception 'Selecione a conta real. Um registro pago sem conta deixa o saldo incorreto.'; end if;
  if new.card_forecast or new.metadata->>'credit_card_account_id' is not null then raise exception 'Confirme a cobranca e pague pelo painel de faturas em Proximas obrigacoes.'; end if;
  if exists(select 1 from public.pf_accounts where id=new.account_id and type='credit_card') then raise exception 'Use Compra no cartao para registrar esta despesa.'; end if;
  if exists(select 1 from public.pf_card_statements where account_id=new.destination_account_id) then raise exception 'Pague este cartao pelo painel de faturas.'; end if;
 end if;
 return new;
end $$;
drop trigger if exists aa_pf_control_guard on public.pf_transactions;
create trigger aa_pf_control_guard before insert or update or delete on public.pf_transactions for each row execute function public.pf_control_transaction_guard();

create or replace function public.pf_reconcile_account_v1(p_account uuid,p_balance numeric,p_reason text,p_expected_balance numeric) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.pf_accounts%rowtype; result_id uuid;
begin
 select * into a from public.pf_accounts where id=p_account for update;
 if not found then raise exception 'Conta nao encontrada.'; end if;
 perform public.pf_control_write(a.household_id);
 if p_balance is null or p_balance::text in ('NaN','Infinity','-Infinity') or length(btrim(p_reason))<5 then raise exception 'Informe saldo valido e justificativa.'; end if;
 if a.type='credit_card' then raise exception 'Use a conciliacao da fatura para cartoes.'; end if;
 if a.balance is distinct from p_expected_balance then raise exception 'O saldo mudou. Recarregue antes de conciliar.'; end if;
 insert into public.pf_balance_reconciliations(household_id,account_id,previous_balance,confirmed_balance,reason,created_by)
 values(a.household_id,a.id,a.balance,round(p_balance,2),p_reason,auth.uid()) returning id into result_id;
 -- Freeze only the reconciled side of a historical transaction.
 -- A transfer's other bank is independent and must not be frozen here.
 perform set_config('pf.reconciliation_batch','on',true);
 update public.pf_transactions set metadata=metadata||jsonb_build_object('balance_snapshot_accounts',coalesce(metadata->'balance_snapshot_accounts','[]'::jsonb)||to_jsonb(a.id::text),'balance_reconciled_at',now())
 where household_id=a.household_id and status='paid' and (account_id=a.id or destination_account_id=a.id);
 update public.pf_accounts set balance=round(p_balance,2),reconciliation_required=false,balance_updated_at=now(),updated_at=now() where id=a.id;
 update public.pf_reconciliation_tasks set resolved_at=now(),resolved_by=auth.uid() where account_id=a.id and resolved_at is null;
 perform set_config('pf.reconciliation_batch','off',true);
 return result_id;
end $$;

create or replace function public.pf_create_personal_loan_v1(p_household uuid,p_borrower text,p_amount numeric,p_account uuid,p_given_on date,p_due_date date,p_historical boolean,p_notes text,p_request uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare loan uuid; old_result jsonb;
begin
 perform public.pf_control_write(p_household);
 select result into old_result from public.pf_control_operations where household_id=p_household and request_id=p_request;
 if found then return (old_result->>'id')::uuid; end if;
 if p_request is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or nullif(btrim(p_borrower),'') is null then raise exception 'Informe pessoa e valor valido.'; end if;
 if not coalesce(p_historical,false) and (p_account is null or p_given_on is null) then raise exception 'Para um emprestimo novo, informe conta e data.'; end if;
 if p_given_on>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data do emprestimo nao pode estar no futuro.'; end if;
 if p_account is not null and not exists(select 1 from public.pf_accounts where id=p_account and household_id=p_household and is_active and type not in ('credit_card','investment')) then raise exception 'Conta invalida.'; end if;
 insert into public.pf_personal_loans(household_id,borrower,principal,source_account_id,given_on,due_date,historical,notes,created_by)
 values(p_household,btrim(p_borrower),p_amount,p_account,p_given_on,p_due_date,p_historical,p_notes,auth.uid()) returning id into loan;
 insert into public.pf_transactions(household_id,account_id,created_by,type,status,description,merchant,amount,occurred_on,paid_at,metadata)
 values(p_household,p_account,auth.uid(),'loan_given','paid','Emprestimo concedido - '||btrim(p_borrower),p_borrower,p_amount,
 coalesce(p_given_on,(now() at time zone 'America/Sao_Paulo')::date),case when p_given_on is null then null else (p_given_on+time '12:00') at time zone 'America/Sao_Paulo' end,
 jsonb_build_object('origin','personal_loan','loan_id',loan,'skip_balance_update',coalesce(p_historical,false),'date_unknown',p_given_on is null));
 insert into public.pf_control_operations values(p_household,p_request,'create_loan',jsonb_build_object('id',loan),now());
 return loan;
end $$;

create or replace function public.pf_receive_personal_loan_v1(p_loan uuid,p_account uuid,p_amount numeric,p_date date,p_request uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.pf_personal_loans%rowtype; remaining numeric; tx uuid; old_result jsonb;
begin
 select * into l from public.pf_personal_loans where id=p_loan for update;
 if not found then raise exception 'Emprestimo nao encontrado.'; end if;
 perform public.pf_control_write(l.household_id);
 select result into old_result from public.pf_control_operations where household_id=l.household_id and request_id=p_request;
 if found then return (old_result->>'id')::uuid; end if;
 select l.principal-coalesce(sum(amount),0) into remaining from public.pf_loan_repayments where loan_id=l.id;
 if l.cancelled_at is not null or p_request is null or p_amount is null or p_amount<=0 or p_amount>remaining or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Valor deve ser positivo e nao superar o saldo a receber.'; end if;
 if p_date is null or p_date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe uma data real de recebimento.'; end if;
 if not exists(select 1 from public.pf_accounts where id=p_account and household_id=l.household_id and is_active and type not in ('credit_card','investment')) then raise exception 'Selecione a conta que recebeu.'; end if;
 insert into public.pf_transactions(household_id,account_id,created_by,type,status,description,merchant,amount,occurred_on,paid_at,metadata)
 values(l.household_id,p_account,auth.uid(),'loan_repayment','paid','Devolucao de emprestimo - '||l.borrower,l.borrower,p_amount,p_date,(p_date+time '12:00') at time zone 'America/Sao_Paulo',jsonb_build_object('origin','loan_repayment','loan_id',l.id)) returning id into tx;
 insert into public.pf_loan_repayments(household_id,loan_id,account_id,amount,received_on,transaction_id,request_id) values(l.household_id,l.id,p_account,p_amount,p_date,tx,p_request);
 insert into public.pf_control_operations values(l.household_id,p_request,'receive_loan',jsonb_build_object('id',tx),now());
 return tx;
end $$;

-- First reconciliation of a card bill: the reported total is authoritative.
-- Itemizing a purchase consumes unallocated_amount, never adds it a second time.
create or replace function public.pf_reconcile_card_v1(p_account uuid,p_due date,p_total numeric,p_available numeric,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.pf_accounts%rowtype; sid uuid; itemized numeric; paid numeric;
begin
 select * into a from public.pf_accounts where id=p_account for update;
 if not found or a.type<>'credit_card' then raise exception 'Cartao nao encontrado.'; end if;
 perform public.pf_control_write(a.household_id);
 if p_due is null or p_total is null or p_available is null or p_total<0 or p_available<0 or p_total::text in ('NaN','Infinity','-Infinity') or p_available::text in ('NaN','Infinity','-Infinity') or length(btrim(p_reason))<5 then raise exception 'Informe os valores reais, vencimento e justificativa.'; end if;
 insert into public.pf_card_statements(household_id,account_id,due_date) values(a.household_id,a.id,p_due) on conflict(account_id,due_date) do nothing;
 select id,paid_amount into sid,paid from public.pf_card_statements where account_id=a.id and due_date=p_due for update;
 select coalesce(sum(amount),0) into itemized from public.pf_transactions where card_statement_id=sid and status<>'cancelled';
 if p_total+paid<itemized then raise exception 'O total informado e menor que os itens desta fatura. Corrija os itens antes de conciliar.'; end if;
 update public.pf_card_statements set unallocated_amount=p_total+paid-itemized where id=sid;
 insert into public.pf_balance_reconciliations(household_id,account_id,previous_balance,confirmed_balance,reason,created_by,metadata)
 values(a.household_id,a.id,a.balance,p_total,p_reason,auth.uid(),jsonb_build_object('due_date',p_due,'available_credit',p_available));
 update public.pf_accounts set available_credit=p_available,reconciliation_required=false where id=a.id;
 perform public.pf_refresh_card_account(a.id);
 return sid;
end $$;

create or replace function public.pf_create_card_purchase_v2(
 p_household uuid,p_account uuid,p_description text,p_merchant text,p_amount numeric,p_count integer,p_first_due date,
 p_category uuid,p_budget uuid,p_purchased_on date,p_included boolean,p_monthly boolean,p_ends_on date,p_notes text,p_essential boolean,p_request uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.pf_accounts%rowtype; gid uuid:=gen_random_uuid(); sid uuid; tid uuid; due date; part numeric; remaining_cents bigint; i integer; old_result jsonb; sc text;
begin
 perform public.pf_control_write(p_household);
 select result into old_result from public.pf_control_operations where household_id=p_household and request_id=p_request;
 if found then return (old_result->>'id')::uuid; end if;
 select * into a from public.pf_accounts where id=p_account and household_id=p_household and type='credit_card' and is_active for update;
 if not found then raise exception 'Cartao invalido.'; end if;
 if p_request is null or nullif(btrim(p_description),'') is null or p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_count is null or p_count<1 or p_count>120 or p_first_due is null then raise exception 'Revise descricao, valor, quantidade e vencimento.'; end if;
 if round(p_amount*100)<p_count then raise exception 'Cada parcela deve ter ao menos um centavo.'; end if;
 if not exists(select 1 from public.pf_categories where id=p_category and household_id=p_household) then raise exception 'Categoria invalida.'; end if;
 if p_budget is not null and not exists(select 1 from public.pf_budgets where id=p_budget and household_id=p_household) then raise exception 'Planejamento invalido.'; end if;
 if p_monthly and (p_count<>1 or p_purchased_on is null) then raise exception 'Assinatura mensal exige uma cobranca (1x) e data de inicio.'; end if;
 if p_ends_on is not null and p_ends_on<p_purchased_on then raise exception 'Fim anterior ao inicio da assinatura.'; end if;
 if not p_included and p_purchased_on is null then raise exception 'Informe a data da compra nova.'; end if;
 if p_purchased_on>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Compra futura deve ser uma previsao recorrente.'; end if;
 if a.balance>0 and not exists(select 1 from public.pf_card_statements where account_id=a.id) then raise exception 'Concilie a fatura ja cadastrada antes de detalhar compras.'; end if;
 if not p_included and a.available_credit is not null and p_amount>a.available_credit then raise exception 'Compra supera o limite disponivel registrado. Confira o limite real antes.'; end if;
 if p_monthly then
  insert into public.pf_recurring_templates(household_id,created_by,category_id,type,description,merchant,amount,day_of_month,starts_on,ends_on,auto_generate,is_active,is_variable,is_essential,credit_card_account_id,notes)
  values(p_household,auth.uid(),p_category,'expense',p_description,p_merchant,p_amount,extract(day from p_purchased_on)::int,p_purchased_on,p_ends_on,true,true,false,p_essential,p_account,p_notes) returning id into tid;
 end if;
 remaining_cents:=round(p_amount*100)::bigint;
 for i in 1..p_count loop
  due:=public.pf_recurring_due_date(extract(day from p_first_due)::int,(date_trunc('month',p_first_due)+make_interval(months=>i-1))::date);
  part:=(remaining_cents/p_count + case when i<=remaining_cents%p_count then 1 else 0 end)::numeric/100;
  insert into public.pf_card_statements(household_id,account_id,due_date) values(p_household,p_account,due) on conflict(account_id,due_date) do nothing;
  select id into sid from public.pf_card_statements where account_id=p_account and due_date=due for update;
  if exists(select 1 from public.pf_card_statements where id=sid and paid_amount>0) then raise exception 'Esta fatura ja foi paga. Selecione o vencimento correto da nova cobranca.'; end if;
  if p_included then
   update public.pf_card_statements set unallocated_amount=unallocated_amount-part where id=sid and unallocated_amount>=part;
   if not found then raise exception 'Nao ha saldo sem detalhamento suficiente na fatura de %. Concilie a fatura antes de marcar como ja incluida.',due; end if;
  end if;
  insert into public.pf_transactions(household_id,created_by,type,status,description,merchant,amount,original_amount,occurred_on,due_date,category_id,budget_id,installment_group_id,installment_number,installment_total,recurrence_key,card_statement_id,card_included_in_snapshot,financial_scope,notes,is_essential,metadata)
  values(p_household,auth.uid(),'expense','planned',p_description,p_merchant,part,part,coalesce(p_purchased_on,(now() at time zone 'America/Sao_Paulo')::date),due,p_category,p_budget,gid,i,p_count,tid,sid,p_included,a.account_scope,p_notes,p_essential,
   jsonb_build_object('origin','installment_purchase','payment_method','credit_card','credit_card_account_id',p_account,'purchase_total_amount',p_amount,'date_unknown',p_purchased_on is null,'charge_confirmed',true,'recurrence_charge_month',to_char(p_purchased_on,'YYYY-MM')));
 end loop;
 if not p_included then update public.pf_accounts set available_credit=available_credit-p_amount where id=p_account; end if;
 perform public.pf_refresh_card_account(p_account);
 insert into public.pf_control_operations values(p_household,p_request,'card_purchase',jsonb_build_object('id',gid),now());
 return gid;
end $$;

create or replace function public.pf_confirm_card_forecast_v1(p_transaction uuid,p_due date,p_charged_on date,p_included boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.pf_transactions%rowtype; a public.pf_accounts%rowtype; sid uuid;
begin
 select * into t from public.pf_transactions where id=p_transaction for update;
 if not found then raise exception 'Previsao nao encontrada.'; end if;
 perform public.pf_control_write(t.household_id);
 if not t.card_forecast or t.status not in ('planned','overdue') then raise exception 'Esta cobranca ja foi confirmada ou cancelada.'; end if;
 if p_due is null or p_charged_on is null or p_charged_on>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe data real e vencimento da fatura.'; end if;
 select * into a from public.pf_accounts where id=(t.metadata->>'credit_card_account_id')::uuid and household_id=t.household_id and type='credit_card' and is_active for update;
 if not found then raise exception 'Cartao invalido.'; end if;
 if not p_included and a.available_credit is not null and t.amount>a.available_credit then raise exception 'Limite disponivel insuficiente; confira o banco.'; end if;
 insert into public.pf_card_statements(household_id,account_id,due_date) values(t.household_id,a.id,p_due) on conflict(account_id,due_date) do nothing;
 select id into sid from public.pf_card_statements where account_id=a.id and due_date=p_due for update;
 if exists(select 1 from public.pf_card_statements where id=sid and paid_amount>0) then raise exception 'Esta fatura ja foi paga. Confira o vencimento.'; end if;
 if p_included then
  update public.pf_card_statements set unallocated_amount=unallocated_amount-t.amount where id=sid and unallocated_amount>=t.amount;
  if not found then raise exception 'Saldo sem detalhamento insuficiente. Concilie esta fatura antes.'; end if;
 else update public.pf_accounts set available_credit=available_credit-t.amount where id=a.id;
 end if;
 update public.pf_transactions set card_forecast=false,card_statement_id=sid,card_included_in_snapshot=p_included,occurred_on=p_charged_on,due_date=p_due,
 installment_group_id=coalesce(installment_group_id,gen_random_uuid()),installment_number=1,installment_total=1,financial_scope=a.account_scope,
 metadata=metadata||jsonb_build_object('charge_confirmed',true,'recurrence_charge_month',coalesce(metadata->>'recurrence_charge_month',metadata->>'generated_for',to_char(t.occurred_on,'YYYY-MM'))) where id=t.id;
 perform public.pf_refresh_card_account(a.id);
end $$;

create or replace function public.pf_pay_card_statement_v1(p_statement uuid,p_bank uuid,p_date date,p_request uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.pf_card_statements%rowtype; remaining numeric; tx uuid; old_result jsonb;
begin
 select * into s from public.pf_card_statements where id=p_statement for update;
 if not found then raise exception 'Fatura nao encontrada.'; end if;
 perform public.pf_control_write(s.household_id);
 select result into old_result from public.pf_control_operations where household_id=s.household_id and request_id=p_request;
 if found then return (old_result->>'id')::uuid; end if;
 select remaining_amount into remaining from public.pf_card_statement_positions where id=s.id;
 if p_request is null or remaining<=0 then raise exception 'Fatura ja quitada.'; end if;
 if p_date is null or p_date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Informe a data real do pagamento.'; end if;
 if not exists(select 1 from public.pf_accounts where id=p_bank and household_id=s.household_id and is_active and type in ('checking','savings','cash','wallet')) then raise exception 'Selecione a conta bancaria pagadora.'; end if;
 if s.unallocated_amount>0 then
  -- The unitemized part is a known credit-card obligation, not invented merchant data.
  insert into public.pf_transactions(household_id,created_by,type,status,description,amount,occurred_on,due_date,card_statement_id,card_included_in_snapshot,metadata)
  values(s.household_id,auth.uid(),'expense','planned','Parcela da fatura sem detalhamento',s.unallocated_amount,p_date,s.due_date,s.id,true,jsonb_build_object('credit_card_account_id',s.account_id,'origin','statement_unallocated'));
  update public.pf_card_statements set unallocated_amount=0 where id=s.id;
 end if;
 insert into public.pf_transactions(household_id,account_id,destination_account_id,created_by,type,status,description,amount,occurred_on,paid_at,metadata)
 values(s.household_id,p_bank,s.account_id,auth.uid(),'transfer','paid','Pagamento de fatura - '||s.due_date,remaining,p_date,(p_date+time '12:00') at time zone 'America/Sao_Paulo',jsonb_build_object('origin','card_statement_payment','statement_id',s.id)) returning id into tx;
 update public.pf_transactions set status='paid',paid_at=(p_date+time '12:00') at time zone 'America/Sao_Paulo',metadata=metadata||jsonb_build_object('skip_balance_update',true,'paid_by_statement',tx),updated_at=now()
 where card_statement_id=s.id and status in ('planned','overdue');
 update public.pf_card_statements set paid_amount=paid_amount+remaining where id=s.id;
 perform public.pf_refresh_card_account(s.account_id);
 insert into public.pf_control_operations values(s.household_id,p_request,'pay_card',jsonb_build_object('id',tx),now());
 return tx;
end $$;

-- Only ordinary obligations here; owned-card items are grouped by bill in the UI.
create or replace view public.pf_obligations_v2 with(security_invoker=true) as
select v.* from public.pf_upcoming_obligations v left join public.pf_transactions t on v.source_type='transaction' and t.id=v.source_id
where coalesce(t.metadata->>'credit_card_account_id','')='' and t.card_statement_id is null and not coalesce(t.card_forecast,false);
grant select on public.pf_obligations_v2 to authenticated;

create or replace function public.pf_apply_transaction_effect(
    target_household_id uuid,
    source_account_id uuid,
    target_destination_account_id uuid,
    transaction_type text,
    transaction_status text,
    transaction_amount numeric,
    transaction_source text,
    transaction_metadata jsonb,
    multiplier numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    skip_balance_update boolean;
begin
    if coalesce(current_setting('pf.reconciliation_batch', true),'') = 'on' then return; end if;
    skip_balance_update :=
        coalesce(
            transaction_metadata ->> 'skip_balance_update',
            'false'
        ) = 'true';

    if transaction_status <> 'paid' then
        return;
    end if;

    -- Transações do Open Finance não alteram o saldo porque
    -- o saldo real será sincronizado diretamente da instituição.
    if transaction_source in ('open_finance', 'import')
       or skip_balance_update then
        return;
    end if;

    if coalesce(transaction_metadata->'balance_snapshot_accounts','[]'::jsonb) ? source_account_id::text then source_account_id:=null; end if;
    if coalesce(transaction_metadata->'balance_snapshot_accounts','[]'::jsonb) ? target_destination_account_id::text then target_destination_account_id:=null; end if;

    case transaction_type
        when 'loan_given' then
            perform public.pf_adjust_account_balance(target_household_id, source_account_id, -transaction_amount * multiplier);
        when 'loan_repayment' then
            perform public.pf_adjust_account_balance(target_household_id, source_account_id, transaction_amount * multiplier);
        when 'income' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                transaction_amount * multiplier
            );

        when 'debt_received' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                transaction_amount * multiplier
            );

        when 'expense' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

        when 'debt_payment' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

        when 'transfer' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

            perform public.pf_adjust_account_balance(
                target_household_id,
                target_destination_account_id,
                transaction_amount * multiplier
            );

        when 'investment_contribution' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

            perform public.pf_adjust_account_balance(
                target_household_id,
                target_destination_account_id,
                transaction_amount * multiplier
            );

        when 'investment_withdrawal' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

            perform public.pf_adjust_account_balance(
                target_household_id,
                target_destination_account_id,
                transaction_amount * multiplier
            );

        when 'adjustment' then
            if coalesce(
                transaction_metadata ->> 'direction',
                'increase'
            ) = 'decrease' then
                perform public.pf_adjust_account_balance(
                    target_household_id,
                    source_account_id,
                    -transaction_amount * multiplier
                );
            else
                perform public.pf_adjust_account_balance(
                    target_household_id,
                    source_account_id,
                    transaction_amount * multiplier
                );
            end if;

        else
            return;
    end case;
end;
$$;


-- The charge month is independent from the statement due month.
create or replace function public.pf_card_due_for_charge(p_account uuid,p_charge date) returns date
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.pf_accounts%rowtype; d date; m date;
begin
 select * into a from public.pf_accounts where id=p_account;
 m:=date_trunc('month',p_charge)::date;
 if extract(day from p_charge)>coalesce(a.closing_day,31) then m:=(m+interval '1 month')::date; end if;
 d:=public.pf_recurring_due_date(coalesce(a.due_day,10),m);
 if d<p_charge then d:=public.pf_recurring_due_date(coalesce(a.due_day,10),(m+interval '1 month')::date); end if;
 return d;
end $$;

create or replace function public.pf_generate_recurring_transactions(target_month date) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.pf_recurring_templates%rowtype; charge date; due date; n integer:=0; m date:=date_trunc('month',target_month)::date;
begin
 if auth.uid() is null then raise exception 'Sessao obrigatoria.'; end if;
 if m is null then raise exception 'Mes obrigatorio.'; end if;
 for r in select * from public.pf_recurring_templates where is_active and auto_generate and not is_variable and amount>0 and public.pf_can_write(household_id) order by household_id,id loop
  perform public.pf_control_write(r.household_id);
  charge:=public.pf_recurring_due_date(r.day_of_month,m);
  if charge<r.starts_on or (r.ends_on is not null and charge>r.ends_on) then continue; end if;
  -- A cancelled prediction deliberately suppresses regeneration of that month.
  if exists(select 1 from public.pf_transactions t where t.household_id=r.household_id and t.recurrence_key=r.id
    and coalesce(t.metadata->>'recurrence_charge_month',t.metadata->>'generated_for',to_char(coalesce(t.due_date,t.occurred_on),'YYYY-MM'))=to_char(m,'YYYY-MM')) then continue; end if;
  due:=case when r.credit_card_account_id is null then charge else public.pf_card_due_for_charge(r.credit_card_account_id,charge) end;
  insert into public.pf_transactions(household_id,created_by,account_id,category_id,type,status,description,merchant,amount,occurred_on,due_date,recurrence_key,metadata)
  values(r.household_id,auth.uid(),case when r.credit_card_account_id is null then r.account_id else null end,r.category_id,r.type,'planned',r.description,r.merchant,r.amount,charge,due,r.id,
    jsonb_build_object('origin','recurring_template','template_id',r.id,'generated_for',to_char(m,'YYYY-MM'),'recurrence_charge_month',to_char(m,'YYYY-MM')))
  on conflict do nothing;
  if found then n:=n+1; end if;
 end loop;
 return n;
end $$;

create table if not exists public.pf_installment_edits (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.pf_households(id),
 group_id uuid not null,previous_rows jsonb not null,requested_changes jsonb not null,
 created_by uuid references auth.users(id),created_at timestamptz not null default now()
);
alter table public.pf_installment_edits enable row level security;
drop policy if exists control_read on public.pf_installment_edits;
create policy control_read on public.pf_installment_edits for select to authenticated using(public.pf_is_member(household_id));
revoke all on public.pf_installment_edits from public,anon,authenticated;
grant select on public.pf_installment_edits to authenticated;
grant all on public.pf_installment_edits to service_role;

create or replace function public.pf_manage_installments_v1(p_household uuid,p_group uuid,p_changes jsonb,p_cancel_all boolean,p_description text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.pf_transactions%rowtype; first_row public.pf_transactions%rowtype; c jsonb; old_rows jsonb; amt numeric; d date; cancel_row boolean; cid uuid; sid uuid; old_sid uuid; delta numeric; idx integer; total integer;
begin
 perform public.pf_control_write(p_household);
 perform 1 from public.pf_transactions where household_id=p_household and installment_group_id=p_group for update;
 select * into first_row from public.pf_transactions where household_id=p_household and installment_group_id=p_group order by installment_number limit 1;
 if not found then raise exception 'Parcelamento nao encontrado.'; end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>120 then raise exception 'Parcelas invalidas.'; end if;
 select jsonb_agg(to_jsonb(t)) into old_rows from public.pf_transactions t where household_id=p_household and installment_group_id=p_group;
 insert into public.pf_installment_edits(household_id,group_id,previous_rows,requested_changes,created_by) values(p_household,p_group,old_rows,jsonb_build_object('rows',p_changes,'cancel_all',p_cancel_all,'description',p_description),auth.uid());
 if p_cancel_all then
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'cancel',true)),'[]') into p_changes from public.pf_transactions t
  where household_id=p_household and installment_group_id=p_group and status in ('planned','overdue')
  and not exists(select 1 from public.pf_transaction_settlements z where z.planned_transaction_id=t.id);
 end if;
 for c in select value from jsonb_array_elements(p_changes) loop
  if nullif(c->>'id','') is null then
   if p_cancel_all then continue; end if;
   r:=first_row; r.id:=null; r.amount:=0; r.card_statement_id:=null; r.card_included_in_snapshot:=false;
   if first_row.card_included_in_snapshot then raise exception 'Para acrescentar compras a uma fatura conciliada, use Nova compra no cartao.'; end if;
  else
   select * into r from public.pf_transactions where id=(c->>'id')::uuid and household_id=p_household and installment_group_id=p_group;
   if not found then raise exception 'Parcela nao pertence a este grupo.'; end if;
   if r.status not in ('planned','overdue') or exists(select 1 from public.pf_transaction_settlements where planned_transaction_id=r.id) then raise exception 'Pagamentos e parcelas liquidadas sao preservados. Edite apenas as pendentes.'; end if;
  end if;
  cancel_row:=coalesce((c->>'cancel')::boolean,false);
  amt:=case when cancel_row then 0 else round((c->>'amount')::numeric,2) end;
  d:=case when cancel_row then r.due_date else (c->>'due_date')::date end;
  if not cancel_row and (amt is null or amt<=0 or amt::text in ('NaN','Infinity','-Infinity') or d is null) then raise exception 'Informe valor positivo e vencimento.'; end if;
  cid:=nullif(r.metadata->>'credit_card_account_id','')::uuid; sid:=r.card_statement_id; old_sid:=sid;
  if sid is not null and exists(select 1 from public.pf_card_statements where id=sid and paid_amount>0) then raise exception 'Fatura ja possui pagamento. Nao altere sua composicao por este formulario.'; end if;
  if r.card_included_in_snapshot then
   if d is distinct from r.due_date then raise exception 'Compra ja conciliada: corrija a fatura antes de mudar o vencimento.'; end if;
   if (select unallocated_amount+r.amount-amt from public.pf_card_statements where id=sid)<0 then raise exception 'O ajuste excede o saldo ainda nao detalhado da fatura.'; end if;
   update public.pf_card_statements set unallocated_amount=unallocated_amount+r.amount-amt where id=sid;
  elsif cid is not null then
   delta:=amt-r.amount;
   perform 1 from public.pf_accounts where id=cid for update;
   if delta>(select available_credit from public.pf_accounts where id=cid) then raise exception 'Limite disponivel insuficiente.'; end if;
   update public.pf_accounts set available_credit=available_credit-delta where id=cid and household_id=p_household;
   if not cancel_row and (r.card_statement_id is not null or first_row.card_statement_id is not null) then
    insert into public.pf_card_statements(household_id,account_id,due_date) values(p_household,cid,d) on conflict(account_id,due_date) do nothing;
    select id into sid from public.pf_card_statements where account_id=cid and due_date=d;
    if exists(select 1 from public.pf_card_statements where id=sid and paid_amount>0) then raise exception 'Nao mova uma parcela para uma fatura ja paga.'; end if;
   end if;
  end if;
  if r.id is null then
   select coalesce(max(installment_number),0)+1 into idx from public.pf_transactions where household_id=p_household and installment_group_id=p_group;
   insert into public.pf_transactions(household_id,created_by,type,status,description,merchant,category_id,budget_id,amount,occurred_on,due_date,installment_group_id,installment_number,installment_total,card_statement_id,metadata)
   values(p_household,auth.uid(),'expense','planned',coalesce(nullif(btrim(p_description),''),first_row.description),first_row.merchant,first_row.category_id,first_row.budget_id,amt,first_row.occurred_on,d,p_group,idx,idx,sid,(first_row.metadata-array['skip_balance_update','balance_snapshot_accounts','balance_reconciled_at','paid_by_statement','reconciliation_batch'])||jsonb_build_object('edited_installment',true));
  else
   update public.pf_transactions set status=case when cancel_row then 'cancelled' else status end,amount=case when cancel_row then amount else amt end,due_date=d,card_statement_id=sid,
    description=coalesce(nullif(btrim(p_description),''),description),updated_at=now(),metadata=metadata||jsonb_build_object('installment_corrected_at',now(),'cancelled_as_incorrect',cancel_row) where id=r.id;
  end if;
  if cid is not null and (sid is not null or old_sid is not null) then perform public.pf_refresh_card_account(cid); end if;
 end loop;
 select count(*) into total from public.pf_transactions where household_id=p_household and installment_group_id=p_group and (status<>'cancelled' or exists(select 1 from public.pf_transaction_settlements z where z.planned_transaction_id=pf_transactions.id));
 if total>120 then raise exception 'Maximo de 120 parcelas.'; end if;
 -- Never rewrite settled records, including their original installment count.
 update public.pf_transactions set installment_total=greatest(total,installment_number) where household_id=p_household and installment_group_id=p_group and status in ('planned','overdue');
end $$;

-- Validate new/edited template ownership, including its optional card.
create or replace function public.pf_control_template_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.credit_card_account_id is not null then
  if new.type<>'expense' or not exists(select 1 from public.pf_accounts where id=new.credit_card_account_id and household_id=new.household_id and type='credit_card' and is_active) then raise exception 'Cartao invalido para esta assinatura.'; end if;
  new.account_id:=null;
 end if;
 return new;
end $$;
drop trigger if exists aa_pf_control_template_guard on public.pf_recurring_templates;
create trigger aa_pf_control_template_guard before insert or update on public.pf_recurring_templates for each row execute function public.pf_control_template_guard();


-- The old API now delegates to the safe editor. Paid installments never move.
create or replace function public.pf_update_installment_schedule_v1(target_household_id uuid,target_installment_group_id uuid,new_first_due_date date) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare changes jsonb;
begin
 if new_first_due_date is null then raise exception 'Informe o novo vencimento.'; end if;
 perform public.pf_control_write(target_household_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'amount',t.amount,'due_date',
 public.pf_recurring_due_date(extract(day from new_first_due_date)::int,(date_trunc('month',new_first_due_date)+make_interval(months=>coalesce(t.installment_number,1)-1))::date))),'[]') into changes
 from public.pf_transactions t where t.household_id=target_household_id and t.installment_group_id=target_installment_group_id and t.status in ('planned','overdue')
 and not exists(select 1 from public.pf_transaction_settlements z where z.planned_transaction_id=t.id);
 perform public.pf_manage_installments_v1(target_household_id,target_installment_group_id,changes,false,null);
 return jsonb_array_length(changes);
end $$;
revoke all on function public.pf_update_installment_schedule_v1(uuid,uuid,date) from public,anon;
grant execute on function public.pf_update_installment_schedule_v1(uuid,uuid,date) to authenticated;

-- Editing a recurring rule synchronizes only future, uncharged predictions.
-- Paid rows, settled planned rows, and confirmed card charges are immutable here.
create or replace function public.pf_sync_recurring_predictions() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.pf_transactions%rowtype; charge date; due date; month_key text; previous_trust text;
begin
 if coalesce(current_setting('pf.reconciliation_batch',true),'')='on' then return new; end if;
 if (to_jsonb(new)-'updated_at') is not distinct from (to_jsonb(old)-'updated_at') then return new; end if;
 if auth.uid() is not null and not public.pf_can_write(new.household_id) then raise exception 'Sem permissao.'; end if;
 previous_trust:=coalesce(current_setting('pf.trusted_finance',true),'');
 perform set_config('pf.trusted_finance','on',true);
 perform pg_advisory_xact_lock(hashtextextended(new.household_id::text,38));
 -- Store the charge month before temporarily clearing dates (unique recurrence index).
 update public.pf_transactions t set metadata=t.metadata||jsonb_build_object('recurrence_charge_month',coalesce(t.metadata->>'recurrence_charge_month',t.metadata->>'generated_for',to_char(coalesce(t.due_date,t.occurred_on),'YYYY-MM'))),due_date=null
 where t.recurrence_key=new.id and t.household_id=new.household_id and t.status in ('planned','overdue') and t.card_statement_id is null
 and coalesce((t.metadata->>'charge_confirmed')::boolean,false)=false
 and not exists(select 1 from public.pf_transaction_settlements z where z.planned_transaction_id=t.id);
 for r in select * from public.pf_transactions t where t.recurrence_key=new.id and t.household_id=new.household_id and t.status in ('planned','overdue') and t.card_statement_id is null and t.due_date is null
 and coalesce((t.metadata->>'charge_confirmed')::boolean,false)=false and not exists(select 1 from public.pf_transaction_settlements z where z.planned_transaction_id=t.id) loop
  month_key:=r.metadata->>'recurrence_charge_month';
  charge:=public.pf_recurring_due_date(new.day_of_month,(month_key||'-01')::date);
  due:=case when new.credit_card_account_id is null then charge else public.pf_card_due_for_charge(new.credit_card_account_id,charge) end;
  if not new.is_active or charge<new.starts_on or (new.ends_on is not null and charge>new.ends_on) then
   update public.pf_transactions set status='cancelled',due_date=due,metadata=metadata||jsonb_build_object('recurrence_disabled',true) where id=r.id;
  else
   update public.pf_transactions set amount=case when new.is_variable then amount else new.amount end,description=new.description,merchant=new.merchant,
   account_id=new.account_id,category_id=new.category_id,occurred_on=charge,due_date=due,card_forecast=(new.credit_card_account_id is not null),
   metadata=(metadata-array['credit_card_account_id','payment_method','charge_confirmed'])||jsonb_build_object('origin','recurring_template'),updated_at=now() where id=r.id;
  end if;
 end loop;
 perform set_config('pf.trusted_finance',previous_trust,true);
 return new;
end $$;
drop trigger if exists zz_pf_sync_recurring_predictions on public.pf_recurring_templates;
create trigger zz_pf_sync_recurring_predictions after update on public.pf_recurring_templates for each row execute function public.pf_sync_recurring_predictions();
revoke all on function public.pf_sync_recurring_predictions() from public,anon,authenticated;

-- Do not expose internal SECURITY DEFINER helpers as public REST RPCs.
do $$ declare f record; begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array[
 'pf_control_write','pf_refresh_card_account','pf_control_transaction_guard','pf_control_template_guard','pf_apply_transaction_effect','pf_adjust_account_balance','pf_card_due_for_charge',
 'pf_reconcile_account_v1','pf_create_personal_loan_v1','pf_receive_personal_loan_v1','pf_reconcile_card_v1','pf_create_card_purchase_v2','pf_confirm_card_forecast_v1','pf_pay_card_statement_v1','pf_manage_installments_v1','pf_generate_recurring_transactions']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname=any(array['pf_reconcile_account_v1','pf_create_personal_loan_v1','pf_receive_personal_loan_v1','pf_reconcile_card_v1','pf_create_card_purchase_v2','pf_confirm_card_forecast_v1','pf_pay_card_statement_v1','pf_manage_installments_v1','pf_generate_recurring_transactions']) then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
