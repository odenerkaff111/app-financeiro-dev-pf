-- PWA + Web Push. Reutiliza a agenda e a confirmacao diaria de 039.
-- Nao altera dados financeiros.
begin;

alter table public.pf_reminder_settings
  add column if not exists push_enabled boolean not null default false,
  add column if not exists push_consented_at timestamptz;

create table if not exists public.pf_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.pf_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check(length(endpoint) between 20 and 4096),
  endpoint_hash text not null unique check(endpoint_hash ~ '^[0-9a-f]{64}$'),
  p256dh text not null check(length(p256dh) between 40 and 256),
  auth text not null check(length(auth) between 16 and 128),
  expiration_time bigint,
  device_label text check(device_label is null or length(device_label) <= 80),
  user_agent_hash text check(user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index if not exists pf_push_subscriptions_user_active_idx
  on public.pf_push_subscriptions(household_id,user_id,is_active,last_seen_at desc);

create table if not exists public.pf_push_outbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.pf_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.pf_push_subscriptions(id) on delete cascade,
  day date not null,
  slot text not null,
  status text not null default 'sending' check(status in ('sending','sent','failed','unknown','skipped')),
  provider_id text,
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(subscription_id,day,slot)
);
create index if not exists pf_push_outbox_user_idx
  on public.pf_push_outbox(household_id,user_id,created_at desc);

create table if not exists public.pf_push_actions (
  household_id uuid not null references public.pf_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  last_at timestamptz not null,
  primary key(household_id,user_id,action)
);

alter table public.pf_push_subscriptions enable row level security;
alter table public.pf_push_outbox enable row level security;
alter table public.pf_push_actions enable row level security;

drop policy if exists push_outbox_self_read on public.pf_push_outbox;
create policy push_outbox_self_read on public.pf_push_outbox
  for select to authenticated
  using(user_id=auth.uid() and public.pf_is_member(household_id));

revoke all on public.pf_push_subscriptions from public,anon,authenticated;
revoke all on public.pf_push_actions from public,anon,authenticated;
revoke all on public.pf_push_outbox from public,anon,authenticated;
grant select on public.pf_push_outbox to authenticated;
grant all on public.pf_push_subscriptions,public.pf_push_outbox,public.pf_push_actions to service_role;

-- O Cron consulta isto localmente antes de fazer uma chamada HTTPS, evitando
-- invocar a Vercel a cada minuto quando nenhum horario esta pendente.
create or replace function public.pf_push_dispatch_needed_v1()
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  s public.pf_reminder_settings%rowtype;
  localnow timestamp;
  slot text;
  due timestamptz;
begin
  for s in
    select st.*
    from public.pf_reminder_settings st
    join public.pf_household_members m
      on m.household_id=st.household_id and m.user_id=st.user_id
    where st.push_enabled
      and st.push_consented_at is not null
      and m.role in ('owner','member')
  loop
    localnow:=now() at time zone s.timezone;
    select max(x) into slot from unnest(s.times) x where x<=to_char(localnow,'HH24:MI');
    if slot is null then continue; end if;
    due:=(localnow::date+slot::time) at time zone s.timezone;
    if now()<due or now()-due>interval '5 minutes' then continue; end if;
    if exists(
      select 1
      from public.pf_daily_checks c
      where c.household_id=s.household_id and c.user_id=s.user_id
        and c.day=localnow::date and c.confirmed_at>=due and c.needs_entry_since is null
    ) then continue; end if;
    if exists(
      select 1
      from public.pf_push_subscriptions p
      where p.household_id=s.household_id and p.user_id=s.user_id and p.is_active
        and (p.expiration_time is null or p.expiration_time>(extract(epoch from now())*1000)::bigint)
        and not exists(
          select 1 from public.pf_push_outbox o
          where o.subscription_id=p.id and o.day=localnow::date and o.slot=slot
        )
    ) then return true; end if;
  end loop;
  return false;
end $$;

-- O servidor chama esta funcao; uma chave unica por dispositivo/dia/horario impede duplicidade.
create or replace function public.pf_claim_push_reminders_v1()
returns setof public.pf_push_outbox
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  s public.pf_reminder_settings%rowtype;
  sub public.pf_push_subscriptions%rowtype;
  localnow timestamp;
  slot text;
  due timestamptz;
  r public.pf_push_outbox%rowtype;
  n integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('pf_push_dispatch',40));

  update public.pf_push_outbox
  set status='unknown',error_code='WORKER_INTERRUPTED',finished_at=now()
  where status='sending' and created_at<now()-interval '5 minutes';

  for s in
    select st.*
    from public.pf_reminder_settings st
    join public.pf_household_members m
      on m.household_id=st.household_id and m.user_id=st.user_id
    where st.push_enabled
      and st.push_consented_at is not null
      and m.role in ('owner','member')
    order by st.household_id,st.user_id
  loop
    localnow:=now() at time zone s.timezone;
    select max(x) into slot from unnest(s.times) x where x<=to_char(localnow,'HH24:MI');
    if slot is null then continue; end if;
    due:=(localnow::date+slot::time) at time zone s.timezone;

    -- Sem rajada de lembretes atrasados caso o agendador fique fora do ar.
    if now()-due>interval '5 minutes' then continue; end if;

    if exists(
      select 1 from public.pf_daily_checks c
      where c.household_id=s.household_id
        and c.user_id=s.user_id
        and c.day=localnow::date
        and c.confirmed_at>=due
        and c.needs_entry_since is null
    ) then continue; end if;

    for sub in
      select p.* from public.pf_push_subscriptions p
      where p.household_id=s.household_id
        and p.user_id=s.user_id
        and p.is_active
        and (p.expiration_time is null or p.expiration_time>(extract(epoch from now())*1000)::bigint)
      order by p.last_seen_at desc
    loop
      insert into public.pf_push_outbox(household_id,user_id,subscription_id,day,slot)
      values(s.household_id,s.user_id,sub.id,localnow::date,slot)
      on conflict(subscription_id,day,slot) do nothing
      returning * into r;
      if found then
        return next r;
        n:=n+1;
      end if;
      if n>=20 then exit; end if;
    end loop;
    if n>=20 then exit; end if;
  end loop;
  return;
end $$;

-- Revalida imediatamente antes do envio para respeitar uma confirmacao/desativacao feita apos o claim.
create or replace function public.pf_push_job_is_due_v1(p_job uuid)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.pf_push_outbox%rowtype;
  s public.pf_reminder_settings%rowtype;
  due timestamptz;
begin
  select * into o from public.pf_push_outbox where id=p_job and status='sending';
  if not found then return false; end if;
  select * into s from public.pf_reminder_settings where household_id=o.household_id and user_id=o.user_id;
  if not found or not s.push_enabled or s.push_consented_at is null then return false; end if;
  if not exists(
    select 1 from public.pf_push_subscriptions p
    where p.id=o.subscription_id and p.is_active
      and (p.expiration_time is null or p.expiration_time>(extract(epoch from now())*1000)::bigint)
  ) then return false; end if;
  if not exists(select 1 from public.pf_household_members m where m.household_id=o.household_id and m.user_id=o.user_id and m.role in ('owner','member')) then return false; end if;
  due:=(o.day+o.slot::time) at time zone s.timezone;
  if now()<due or now()-due>interval '5 minutes' then return false; end if;
  if exists(
    select 1 from public.pf_daily_checks c
    where c.household_id=o.household_id and c.user_id=o.user_id and c.day=o.day
      and c.confirmed_at>=due and c.needs_entry_since is null
  ) then return false; end if;
  return true;
end $$;

create or replace function public.pf_claim_push_action_v1(p_household uuid,p_user uuid,p_action text)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if p_action not in ('test') then return false; end if;
  if not exists(select 1 from public.pf_household_members m where m.household_id=p_household and m.user_id=p_user and m.role in ('owner','member')) then return false; end if;
  insert into public.pf_push_actions(household_id,user_id,action,last_at)
  values(p_household,p_user,p_action,now())
  on conflict(household_id,user_id,action) do update
    set last_at=now()
    where public.pf_push_actions.last_at<now()-interval '30 seconds';
  return found;
end $$;

do $$
declare f record;
begin
  for f in
    select oid::regprocedure signature,proname
    from pg_proc
    where pronamespace='public'::regnamespace
      and proname=any(array['pf_push_dispatch_needed_v1','pf_claim_push_reminders_v1','pf_push_job_is_due_v1','pf_claim_push_action_v1'])
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

notify pgrst,'reload schema';
commit;
