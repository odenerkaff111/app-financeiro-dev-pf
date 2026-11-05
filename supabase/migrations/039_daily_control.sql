-- Controle diario persistido no servidor. Nao depende de localStorage.
begin;
create table if not exists public.pf_reminder_settings(
 household_id uuid not null references public.pf_households(id),user_id uuid not null references auth.users(id),
 timezone text not null default 'America/Sao_Paulo',times text[] not null default array['08:00','12:00','18:00','22:00'],
 whatsapp_enabled boolean not null default false,phone text,consented_at timestamptz,
 updated_at timestamptz not null default now(),primary key(household_id,user_id)
);
create table if not exists public.pf_daily_checks(
 household_id uuid not null references public.pf_households(id),user_id uuid not null references auth.users(id),day date not null,
 confirmed_at timestamptz,confirmation text check(confirmation in ('registered','no_movements')),
 needs_entry_since timestamptz,updated_at timestamptz not null default now(),primary key(household_id,user_id,day)
);
create table if not exists public.pf_daily_activity(
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.pf_households(id),user_id uuid not null references auth.users(id),
 resource_id uuid,kind text not null,created_at timestamptz not null default clock_timestamp()
);
create index if not exists pf_daily_activity_lookup on public.pf_daily_activity(household_id,user_id,created_at desc);
create table if not exists public.pf_reminder_outbox(
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.pf_households(id),user_id uuid not null references auth.users(id),
 day date not null,slot text not null,phone text not null,
 status text not null default 'sending' check(status in ('sending','sent','failed','unknown','skipped')),
 provider_id text,error_code text,created_at timestamptz not null default now(),finished_at timestamptz,
 unique(household_id,user_id,day,slot)
);
create table if not exists public.pf_whatsapp_actions(
 household_id uuid not null references public.pf_households(id),user_id uuid not null references auth.users(id),action text not null,
 last_at timestamptz not null,primary key(household_id,user_id,action)
);
do $$ declare n text; begin
 foreach n in array array['pf_reminder_settings','pf_daily_checks','pf_daily_activity','pf_reminder_outbox','pf_whatsapp_actions'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('drop policy if exists reminder_self_read on public.%I',n);
  execute format('create policy reminder_self_read on public.%I for select to authenticated using(user_id=auth.uid() and public.pf_is_member(household_id))',n);
  execute format('revoke all on public.%I from public,anon,authenticated',n);
  execute format('grant select on public.%I to authenticated',n);
  execute format('grant all on public.%I to service_role',n);
 end loop;
end $$;

create or replace function public.pf_daily_capture_activity() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or coalesce(current_setting('pf.reconciliation_batch',true),'')='on' then return new; end if;
 if tg_table_name='pf_transactions' then
  if new.source in ('import','open_finance') or new.status='cancelled' then return new; end if;
  if tg_op='INSERT' and new.metadata->>'origin'='recurring_template' and new.status<>'paid' and coalesce((new.metadata->>'charge_confirmed')::boolean,false)=false then return new; end if;
  if tg_op='UPDATE' and (to_jsonb(new)-array['updated_at','notes']) is not distinct from (to_jsonb(old)-array['updated_at','notes']) then return new; end if;
 end if;
 insert into public.pf_daily_activity(household_id,user_id,resource_id,kind) values(new.household_id,auth.uid(),new.id,tg_table_name);
 return new;
end $$;
drop trigger if exists zz_pf_daily_activity on public.pf_transactions;
create trigger zz_pf_daily_activity after insert or update on public.pf_transactions for each row execute function public.pf_daily_capture_activity();
drop trigger if exists zz_pf_daily_balance_activity on public.pf_balance_reconciliations;
create trigger zz_pf_daily_balance_activity after insert on public.pf_balance_reconciliations for each row execute function public.pf_daily_capture_activity();

create or replace function public.pf_daily_state_v1(p_household uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.pf_reminder_settings%rowtype;c public.pf_daily_checks%rowtype; localnow timestamp; cutoff timestamptz; slot text; valid boolean; evidence boolean;
begin
 if auth.uid() is null or not public.pf_is_member(p_household) then raise exception 'Sem acesso ao grupo.'; end if;
 if not public.pf_can_write(p_household) then return jsonb_build_object('blocked',false,'viewer',true); end if;
 insert into public.pf_reminder_settings(household_id,user_id) values(p_household,auth.uid()) on conflict do nothing;
 select * into s from public.pf_reminder_settings where household_id=p_household and user_id=auth.uid();
 localnow:=now() at time zone s.timezone;
 insert into public.pf_daily_checks(household_id,user_id,day) values(p_household,auth.uid(),localnow::date) on conflict do nothing;
 select * into c from public.pf_daily_checks where household_id=p_household and user_id=auth.uid() and day=localnow::date;
 select max(x) into slot from unnest(s.times) x where x<=to_char(localnow,'HH24:MI');
 cutoff:=case when slot is null then localnow::date::timestamp at time zone s.timezone else (localnow::date+slot::time) at time zone s.timezone end;
 valid:=c.confirmed_at is not null and c.confirmed_at>=cutoff and c.needs_entry_since is null;
 select exists(select 1 from public.pf_daily_activity a where a.household_id=p_household and a.user_id=auth.uid()
 and a.created_at>=coalesce(c.needs_entry_since,localnow::date::timestamp at time zone s.timezone)
 and ((a.kind='pf_transactions' and exists(select 1 from public.pf_transactions t where t.id=a.resource_id and t.household_id=p_household and t.status<>'cancelled'))
 or (a.kind='pf_balance_reconciliations' and exists(select 1 from public.pf_balance_reconciliations b where b.id=a.resource_id and b.household_id=p_household)))) into evidence;
 return jsonb_build_object('blocked',not valid,'day',localnow::date,'slot',slot,'needs_entry',c.needs_entry_since is not null,'has_activity',evidence,'confirmed_at',c.confirmed_at,'settings',to_jsonb(s));
end $$;

create or replace function public.pf_daily_answer_v1(p_household uuid,p_answer text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare state jsonb;d date;c public.pf_daily_checks%rowtype;
begin
 perform public.pf_control_write(p_household);
 state:=public.pf_daily_state_v1(p_household); d:=(state->>'day')::date;
 select * into c from public.pf_daily_checks where household_id=p_household and user_id=auth.uid() and day=d for update;
 if p_answer='no' then
  -- Reloading, navigating or pressing No again must not move the evidence cutoff.
  update public.pf_daily_checks set needs_entry_since=coalesce(needs_entry_since,clock_timestamp()),confirmed_at=null,confirmation=null,updated_at=now()
  where household_id=p_household and user_id=auth.uid() and day=d;
 elsif p_answer='registered' then
  if not (state->>'has_activity')::boolean then raise exception 'Nenhum lancamento ou conferencia de saldo foi salvo. Registre ou confira os saldos antes de confirmar.'; end if;
  update public.pf_daily_checks set confirmed_at=clock_timestamp(),confirmation='registered',needs_entry_since=null,updated_at=now() where household_id=p_household and user_id=auth.uid() and day=d;
 elsif p_answer='no_movements' then
  if c.needs_entry_since is not null then raise exception 'Voce informou que faltam registros. Salve os registros ou confira os saldos na Conciliacao antes de concluir.'; end if;
  update public.pf_daily_checks set confirmed_at=clock_timestamp(),confirmation='no_movements',updated_at=now() where household_id=p_household and user_id=auth.uid() and day=d;
 else raise exception 'Resposta invalida.'; end if;
 return public.pf_daily_state_v1(p_household);
end $$;

create or replace function public.pf_save_reminder_settings_v1(p_household uuid,p_times text[],p_timezone text,p_whatsapp boolean,p_phone text,p_consent boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare normalized text[];
begin
 perform public.pf_control_write(p_household);
 if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Fuso horario invalido.'; end if;
 if p_times is null or array_length(p_times,1) is null or array_length(p_times,1)>30 then raise exception 'Escolha de 1 a 30 horarios.'; end if;
 if exists(select 1 from unnest(p_times) x where x is null or x !~ '^(0[89]|1[0-9]|2[01]):[0-5][0-9]$' and x<>'22:00') then raise exception 'Os horarios devem estar entre 08:00 e 22:00, no formato HH:MM.'; end if;
 select array_agg(distinct x order by x) into normalized from unnest(p_times) x;
 if coalesce(p_whatsapp,false) and (not coalesce(p_consent,false) or p_phone is null or p_phone !~ '^[1-9][0-9]{9,14}$') then raise exception 'Informe telefone com pais/DDD e autorize o lembrete.'; end if;
 insert into public.pf_reminder_settings(household_id,user_id,timezone,times,whatsapp_enabled,phone,consented_at)
 values(p_household,auth.uid(),p_timezone,normalized,coalesce(p_whatsapp,false),nullif(p_phone,''),case when p_consent then now() end)
 on conflict(household_id,user_id) do update set timezone=excluded.timezone,times=excluded.times,whatsapp_enabled=excluded.whatsapp_enabled,phone=excluded.phone,consented_at=excluded.consented_at,updated_at=now();
end $$;

-- Only the server worker can claim deliveries. A unique key prevents duplicate sends.
-- Sending with an unknown result is not automatically retried: that could double-send.
create or replace function public.pf_claim_reminders_v1() returns setof public.pf_reminder_outbox language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.pf_reminder_settings%rowtype;localnow timestamp;slot text;due timestamptz;r public.pf_reminder_outbox%rowtype;n integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('pf_reminder_dispatch',39));
 update public.pf_reminder_outbox set status='unknown',error_code='WORKER_INTERRUPTED',finished_at=now() where status='sending' and created_at<now()-interval '5 minutes';
 for s in select st.* from public.pf_reminder_settings st join public.pf_household_members m on m.household_id=st.household_id and m.user_id=st.user_id
 where st.whatsapp_enabled and st.consented_at is not null and st.phone is not null and m.role in ('owner','member') order by st.household_id,st.user_id loop
  localnow:=now() at time zone s.timezone;
  select max(x) into slot from unnest(s.times) x where x<=to_char(localnow,'HH24:MI');
  if slot is null then continue; end if;
  due:=(localnow::date+slot::time) at time zone s.timezone;
  -- Five-minute delivery window. No overnight burst if a worker was offline.
  if now()-due>interval '5 minutes' then continue; end if;
  if exists(select 1 from public.pf_daily_checks where household_id=s.household_id and user_id=s.user_id and day=localnow::date and confirmed_at>=due and needs_entry_since is null) then continue; end if;
  insert into public.pf_reminder_outbox(household_id,user_id,day,slot,phone) values(s.household_id,s.user_id,localnow::date,slot,s.phone)
  on conflict(household_id,user_id,day,slot) do nothing returning * into r;
  if found then return next r;n:=n+1; end if;
  if n>=5 then exit; end if;
 end loop;
 return;
end $$;

create or replace function public.pf_claim_whatsapp_action_v1(p_household uuid,p_user uuid,p_action text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_action not in ('connect','test','logout') then return false; end if;
 insert into public.pf_whatsapp_actions(household_id,user_id,action,last_at) values(p_household,p_user,p_action,now())
 on conflict(household_id,user_id,action) do update set last_at=now() where pf_whatsapp_actions.last_at<now()-interval '60 seconds';
 return found;
end $$;
do $$ declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname=any(array['pf_daily_capture_activity','pf_daily_state_v1','pf_daily_answer_v1','pf_save_reminder_settings_v1','pf_claim_reminders_v1','pf_claim_whatsapp_action_v1']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname=any(array['pf_daily_state_v1','pf_daily_answer_v1','pf_save_reminder_settings_v1']) then execute format('grant execute on function %s to authenticated',f.signature); end if;
  if f.proname=any(array['pf_claim_reminders_v1','pf_claim_whatsapp_action_v1']) then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
