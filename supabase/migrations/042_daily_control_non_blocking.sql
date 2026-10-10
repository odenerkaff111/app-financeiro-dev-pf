-- 042: Controle diario como lembrete, sem trava de navegacao.
-- Tambem reconhece atividade criada por SQL/admin quando for possivel atribui-la ao usuario.
begin;

create or replace function public.pf_daily_capture_activity()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_household uuid;
  v_user uuid;
  v_payload jsonb;
begin
  v_payload:=to_jsonb(new);
  v_household:=nullif(v_payload->>'household_id','')::uuid;
  if v_household is null then return new; end if;

  -- Em operacoes feitas pelo app, auth.uid() continua sendo a fonte principal.
  -- Em SQLs administrativos, reaproveitamos created_by/responsible_user_id quando presentes.
  v_user:=auth.uid();
  if v_user is null then v_user:=nullif(v_payload->>'created_by','')::uuid; end if;
  if v_user is null then v_user:=nullif(v_payload->>'responsible_user_id','')::uuid; end if;
  if v_user is null then v_user:=nullif(v_payload->>'owner_user_id','')::uuid; end if;

  -- Ultimo fallback para SQL administrativo sem ator explicito: owner/member do grupo.
  if v_user is null or not exists(
    select 1 from public.pf_household_members m
    where m.household_id=v_household and m.user_id=v_user and m.role in ('owner','member')
  ) then
    select m.user_id into v_user
    from public.pf_household_members m
    where m.household_id=v_household and m.role in ('owner','member')
    order by case when m.role='owner' then 0 else 1 end,m.created_at
    limit 1;
  end if;
  if v_user is null then return new; end if;

  if tg_table_name='pf_transactions' then
    if new.status='cancelled' then return new; end if;
    if new.source in ('import','open_finance') then return new; end if;
    if tg_op='INSERT'
      and new.metadata->>'origin'='recurring_template'
      and new.status<>'paid'
      and coalesce((new.metadata->>'charge_confirmed')::boolean,false)=false
    then return new; end if;
    if tg_op='UPDATE'
      and (to_jsonb(new)-array['updated_at','notes']) is not distinct from (to_jsonb(old)-array['updated_at','notes'])
    then return new; end if;
  elsif tg_table_name='pf_accounts' and tg_op='UPDATE' then
    if new.balance is not distinct from old.balance
      and new.available_credit is not distinct from old.available_credit
    then return new; end if;
  end if;

  insert into public.pf_daily_activity(household_id,user_id,resource_id,kind)
  values(v_household,v_user,new.id,tg_table_name);
  return new;
end $$;

drop trigger if exists zz_pf_daily_activity on public.pf_transactions;
create trigger zz_pf_daily_activity
  after insert or update on public.pf_transactions
  for each row execute function public.pf_daily_capture_activity();

drop trigger if exists zz_pf_daily_balance_activity on public.pf_balance_reconciliations;
create trigger zz_pf_daily_balance_activity
  after insert on public.pf_balance_reconciliations
  for each row execute function public.pf_daily_capture_activity();

drop trigger if exists zz_pf_daily_account_activity on public.pf_accounts;
create trigger zz_pf_daily_account_activity
  after update of balance,available_credit on public.pf_accounts
  for each row execute function public.pf_daily_capture_activity();

create or replace function public.pf_daily_state_v1(p_household uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  s public.pf_reminder_settings%rowtype;
  c public.pf_daily_checks%rowtype;
  localnow timestamp;
  cutoff timestamptz;
  activity_since timestamptz;
  slot text;
  valid boolean;
  evidence boolean;
begin
  if auth.uid() is null or not public.pf_is_member(p_household) then raise exception 'Sem acesso ao grupo.'; end if;
  if not public.pf_can_write(p_household) then return jsonb_build_object('blocked',false,'viewer',true); end if;

  insert into public.pf_reminder_settings(household_id,user_id)
  values(p_household,auth.uid())
  on conflict do nothing;

  select * into s
  from public.pf_reminder_settings
  where household_id=p_household and user_id=auth.uid();

  localnow:=now() at time zone s.timezone;

  insert into public.pf_daily_checks(household_id,user_id,day)
  values(p_household,auth.uid(),localnow::date)
  on conflict do nothing;

  select * into c
  from public.pf_daily_checks
  where household_id=p_household and user_id=auth.uid() and day=localnow::date;

  select max(x) into slot
  from unnest(s.times) x
  where x<=to_char(localnow,'HH24:MI');

  cutoff:=case
    when slot is null then localnow::date::timestamp at time zone s.timezone
    else (localnow::date+slot::time) at time zone s.timezone
  end;
  activity_since:=coalesce(c.needs_entry_since,localnow::date::timestamp at time zone s.timezone);
  valid:=c.confirmed_at is not null and c.confirmed_at>=cutoff and c.needs_entry_since is null;

  -- A tabela de atividade cobre o uso normal do app e, a partir desta migration,
  -- tambem SQLs administrativos. As consultas diretas abaixo fazem fallback para
  -- cargas SQL executadas antes desta migration, desde que created_by identifique o usuario.
  select
    exists(
      select 1
      from public.pf_daily_activity a
      where a.household_id=p_household
        and a.user_id=auth.uid()
        and a.created_at>=activity_since
        and (
          (a.kind='pf_transactions' and exists(
            select 1 from public.pf_transactions t
            where t.id=a.resource_id and t.household_id=p_household and t.status<>'cancelled'
          ))
          or
          (a.kind='pf_balance_reconciliations' and exists(
            select 1 from public.pf_balance_reconciliations b
            where b.id=a.resource_id and b.household_id=p_household
          ))
          or
          (a.kind='pf_accounts' and exists(
            select 1 from public.pf_accounts ac
            where ac.id=a.resource_id and ac.household_id=p_household
          ))
        )
    )
    or exists(
      select 1
      from public.pf_transactions t
      where t.household_id=p_household
        and coalesce(t.created_by,t.responsible_user_id)=auth.uid()
        and t.status<>'cancelled'
        and t.source not in ('import','open_finance')
        and greatest(t.created_at,t.updated_at)>=activity_since
    )
    or exists(
      select 1
      from public.pf_balance_reconciliations b
      where b.household_id=p_household
        and b.created_by=auth.uid()
        and b.created_at>=activity_since
    )
  into evidence;

  return jsonb_build_object(
    'blocked',not valid,
    'day',localnow::date,
    'slot',slot,
    'needs_entry',c.needs_entry_since is not null,
    'has_activity',evidence,
    'confirmed_at',c.confirmed_at,
    'settings',to_jsonb(s)
  );
end $$;

create or replace function public.pf_daily_answer_v1(p_household uuid,p_answer text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  state jsonb;
  d date;
begin
  perform public.pf_control_write(p_household);
  state:=public.pf_daily_state_v1(p_household);
  d:=(state->>'day')::date;

  if p_answer='no' then
    -- "Vou atualizar" vira somente um lembrete persistido. Nao existe trava de acesso.
    update public.pf_daily_checks
    set needs_entry_since=coalesce(needs_entry_since,clock_timestamp()),
        confirmed_at=null,
        confirmation=null,
        updated_at=now()
    where household_id=p_household and user_id=auth.uid() and day=d;

  elsif p_answer='registered' then
    -- Decisao do usuario prevalece. Atividade detectada ajuda a informar a UI,
    -- mas nao e requisito para confirmar e seguir usando o app.
    update public.pf_daily_checks
    set confirmed_at=clock_timestamp(),
        confirmation='registered',
        needs_entry_since=null,
        updated_at=now()
    where household_id=p_household and user_id=auth.uid() and day=d;

  elsif p_answer='no_movements' then
    -- Tambem pode encerrar uma pendencia aberta anteriormente.
    update public.pf_daily_checks
    set confirmed_at=clock_timestamp(),
        confirmation='no_movements',
        needs_entry_since=null,
        updated_at=now()
    where household_id=p_household and user_id=auth.uid() and day=d;

  else
    raise exception 'Resposta invalida.';
  end if;

  return public.pf_daily_state_v1(p_household);
end $$;

revoke all on function public.pf_daily_capture_activity() from public,anon,authenticated;
revoke all on function public.pf_daily_state_v1(uuid) from public,anon,authenticated;
revoke all on function public.pf_daily_answer_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.pf_daily_state_v1(uuid) to authenticated;
grant execute on function public.pf_daily_answer_v1(uuid,text) to authenticated;
grant execute on function public.pf_daily_capture_activity() to service_role;

notify pgrst,'reload schema';
commit;

select 'DAILY_CONTROL_NON_BLOCKING_OK' as resultado;
