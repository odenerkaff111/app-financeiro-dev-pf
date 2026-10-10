-- Corrige ambiguidades PL/pgSQL no fluxo automatico de Web Push descobertas
-- no teste real do Cron. Nao altera dados financeiros, assinaturas, chaves VAPID
-- nem o agendamento existente.
begin;

create or replace function public.pf_push_dispatch_needed_v1()
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_settings public.pf_reminder_settings%rowtype;
  v_local_now timestamp;
  v_slot text;
  v_due_at timestamptz;
begin
  for v_settings in
    select st.*
    from public.pf_reminder_settings st
    join public.pf_household_members m
      on m.household_id=st.household_id and m.user_id=st.user_id
    where st.push_enabled
      and st.push_consented_at is not null
      and m.role in ('owner','member')
  loop
    v_local_now := now() at time zone v_settings.timezone;

    select max(x)
      into v_slot
    from unnest(v_settings.times) x
    where x <= to_char(v_local_now,'HH24:MI');

    if v_slot is null then
      continue;
    end if;

    v_due_at := (v_local_now::date + v_slot::time) at time zone v_settings.timezone;

    if now() < v_due_at or now() - v_due_at > interval '5 minutes' then
      continue;
    end if;

    if exists(
      select 1
      from public.pf_daily_checks c
      where c.household_id=v_settings.household_id
        and c.user_id=v_settings.user_id
        and c.day=v_local_now::date
        and c.confirmed_at>=v_due_at
        and c.needs_entry_since is null
    ) then
      continue;
    end if;

    if exists(
      select 1
      from public.pf_push_subscriptions p
      where p.household_id=v_settings.household_id
        and p.user_id=v_settings.user_id
        and p.is_active
        and (
          p.expiration_time is null
          or p.expiration_time>(extract(epoch from now())*1000)::bigint
        )
        and not exists(
          select 1
          from public.pf_push_outbox o
          where o.subscription_id=p.id
            and o.day=v_local_now::date
            and o.slot=v_slot
        )
    ) then
      return true;
    end if;
  end loop;

  return false;
end $$;

create or replace function public.pf_claim_push_reminders_v1()
returns setof public.pf_push_outbox
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_settings public.pf_reminder_settings%rowtype;
  v_subscription public.pf_push_subscriptions%rowtype;
  v_local_now timestamp;
  v_slot text;
  v_due_at timestamptz;
  v_row public.pf_push_outbox%rowtype;
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('pf_push_dispatch',40));

  update public.pf_push_outbox
  set status='unknown',
      error_code='WORKER_INTERRUPTED',
      finished_at=now()
  where status='sending'
    and created_at < now() - interval '5 minutes';

  for v_settings in
    select st.*
    from public.pf_reminder_settings st
    join public.pf_household_members m
      on m.household_id=st.household_id and m.user_id=st.user_id
    where st.push_enabled
      and st.push_consented_at is not null
      and m.role in ('owner','member')
    order by st.household_id,st.user_id
  loop
    v_local_now := now() at time zone v_settings.timezone;

    select max(x)
      into v_slot
    from unnest(v_settings.times) x
    where x <= to_char(v_local_now,'HH24:MI');

    if v_slot is null then
      continue;
    end if;

    v_due_at := (v_local_now::date + v_slot::time) at time zone v_settings.timezone;

    if now() < v_due_at or now() - v_due_at > interval '5 minutes' then
      continue;
    end if;

    if exists(
      select 1
      from public.pf_daily_checks c
      where c.household_id=v_settings.household_id
        and c.user_id=v_settings.user_id
        and c.day=v_local_now::date
        and c.confirmed_at>=v_due_at
        and c.needs_entry_since is null
    ) then
      continue;
    end if;

    for v_subscription in
      select p.*
      from public.pf_push_subscriptions p
      where p.household_id=v_settings.household_id
        and p.user_id=v_settings.user_id
        and p.is_active
        and (
          p.expiration_time is null
          or p.expiration_time>(extract(epoch from now())*1000)::bigint
        )
      order by p.last_seen_at desc
    loop
      insert into public.pf_push_outbox(
        household_id,user_id,subscription_id,day,slot
      )
      values(
        v_settings.household_id,
        v_settings.user_id,
        v_subscription.id,
        v_local_now::date,
        v_slot
      )
      on conflict(subscription_id,day,slot) do nothing
      returning * into v_row;

      if found then
        return next v_row;
        v_count := v_count + 1;
      end if;

      if v_count >= 20 then
        exit;
      end if;
    end loop;

    if v_count >= 20 then
      exit;
    end if;
  end loop;

  return;
end $$;

revoke all on function public.pf_push_dispatch_needed_v1()
  from public,anon,authenticated;
grant execute on function public.pf_push_dispatch_needed_v1()
  to service_role;

revoke all on function public.pf_claim_push_reminders_v1()
  from public,anon,authenticated;
grant execute on function public.pf_claim_push_reminders_v1()
  to service_role;

notify pgrst,'reload schema';
commit;
