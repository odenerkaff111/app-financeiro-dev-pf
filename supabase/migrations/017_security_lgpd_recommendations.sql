begin;

-- =========================================================
-- SEGURANÇA, LGPD E RECOMENDAÇÕES FINANCEIRAS
-- =========================================================

-- ---------------------------------------------------------
-- 1. EVENTOS DE SEGURANÇA E OPERAÇÃO
-- ---------------------------------------------------------

create table if not exists public.pf_security_events (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,
    actor_user_id uuid
        references auth.users(id)
        on delete set null,
    event_type text not null,
    severity text not null default 'info'
        check (severity in ('info', 'warning', 'critical')),
    success boolean not null default true,
    resource_type text,
    resource_id text,
    request_id text,
    ip_hash text,
    user_agent_hash text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists
pf_security_events_household_created_idx
on public.pf_security_events (
    household_id,
    created_at desc
);

create index if not exists
pf_security_events_type_created_idx
on public.pf_security_events (
    event_type,
    created_at desc
);

create or replace function public.pf_log_security_event(
    target_household_id uuid,
    target_event_type text,
    target_severity text default 'info',
    target_success boolean default true,
    target_resource_type text default null,
    target_resource_id text default null,
    target_request_id text default null,
    target_ip_hash text default null,
    target_user_agent_hash text default null,
    target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    created_event_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if not public.pf_is_member(target_household_id) then
        raise exception 'Você não possui acesso ao grupo familiar.';
    end if;

    if nullif(trim(target_event_type), '') is null then
        raise exception 'Tipo de evento não informado.';
    end if;

    if target_severity not in ('info', 'warning', 'critical') then
        raise exception 'Severidade inválida.';
    end if;

    if octet_length(coalesce(target_metadata, '{}'::jsonb)::text) > 12000 then
        raise exception 'Metadados do evento excedem o limite permitido.';
    end if;

    insert into public.pf_security_events (
        household_id,
        actor_user_id,
        event_type,
        severity,
        success,
        resource_type,
        resource_id,
        request_id,
        ip_hash,
        user_agent_hash,
        metadata
    )
    values (
        target_household_id,
        current_user_id,
        trim(target_event_type),
        target_severity,
        coalesce(target_success, true),
        nullif(trim(target_resource_type), ''),
        nullif(trim(target_resource_id), ''),
        nullif(trim(target_request_id), ''),
        nullif(trim(target_ip_hash), ''),
        nullif(trim(target_user_agent_hash), ''),
        coalesce(target_metadata, '{}'::jsonb)
    )
    returning id into created_event_id;

    return created_event_id;
end;
$$;

-- ---------------------------------------------------------
-- 2. RECOMENDAÇÕES PERSISTIDAS
-- ---------------------------------------------------------

create table if not exists public.pf_financial_recommendations (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,
    generated_by uuid
        references auth.users(id)
        on delete set null,
    priority text not null default 'medium'
        check (priority in ('low', 'medium', 'high', 'critical')),
    title text not null,
    recommendation text not null,
    rationale text,
    source text not null default 'deterministic'
        check (source in ('deterministic', 'ai')),
    model text,
    basis jsonb not null default '{}'::jsonb,
    status text not null default 'active'
        check (status in ('active', 'dismissed', 'superseded')),
    expires_at timestamptz not null default (now() + interval '6 hours'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists
pf_financial_recommendations_household_active_idx
on public.pf_financial_recommendations (
    household_id,
    status,
    expires_at desc
);

create or replace view public.pf_active_financial_recommendations
with (security_invoker = true)
as
select
    recommendation.id,
    recommendation.household_id,
    recommendation.priority,
    recommendation.title,
    recommendation.recommendation,
    recommendation.rationale,
    recommendation.source,
    recommendation.model,
    recommendation.basis,
    recommendation.expires_at,
    recommendation.created_at
from public.pf_financial_recommendations recommendation
where recommendation.status = 'active'
  and recommendation.expires_at > now();

-- ---------------------------------------------------------
-- 3. SOLICITAÇÕES DE PRIVACIDADE E RETENÇÃO
-- ---------------------------------------------------------

create table if not exists public.pf_privacy_requests (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,
    requested_by uuid not null default auth.uid()
        references auth.users(id)
        on delete restrict,
    request_type text not null
        check (
            request_type in (
                'access',
                'export',
                'correction',
                'deletion',
                'restriction'
            )
        ),
    status text not null default 'open'
        check (status in ('open', 'in_progress', 'completed', 'rejected')),
    notes text,
    response_notes text,
    responded_by uuid
        references auth.users(id)
        on delete set null,
    responded_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.pf_data_retention_settings (
    household_id uuid primary key
        references public.pf_households(id)
        on delete cascade,
    audit_retention_days integer not null default 365
        check (audit_retention_days between 90 and 3650),
    security_event_retention_days integer not null default 180
        check (security_event_retention_days between 30 and 1825),
    recommendation_retention_days integer not null default 90
        check (recommendation_retention_days between 7 and 730),
    created_by uuid default auth.uid()
        references auth.users(id)
        on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.pf_data_retention_settings (
    household_id,
    created_by
)
select
    household.id,
    household.created_by
from public.pf_households household
on conflict (household_id) do nothing;


create or replace function public.pf_create_default_retention_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.pf_data_retention_settings (
        household_id,
        created_by
    )
    values (
        new.id,
        new.created_by
    )
    on conflict (household_id) do nothing;

    return new;
end;
$$;

drop trigger if exists pf_create_default_retention_settings_trigger
on public.pf_households;

create trigger pf_create_default_retention_settings_trigger
after insert
on public.pf_households
for each row
execute function public.pf_create_default_retention_settings();

create or replace function public.pf_create_privacy_request(
    target_household_id uuid,
    target_request_type text,
    target_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    created_request_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if not public.pf_is_member(target_household_id) then
        raise exception 'Você não possui acesso ao grupo familiar.';
    end if;

    if target_request_type not in (
        'access',
        'export',
        'correction',
        'deletion',
        'restriction'
    ) then
        raise exception 'Tipo de solicitação inválido.';
    end if;

    insert into public.pf_privacy_requests (
        household_id,
        requested_by,
        request_type,
        notes
    )
    values (
        target_household_id,
        current_user_id,
        target_request_type,
        nullif(trim(target_notes), '')
    )
    returning id into created_request_id;

    return created_request_id;
end;
$$;

create or replace function public.pf_purge_expired_compliance_data(
    target_household_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    settings public.pf_data_retention_settings%rowtype;
    deleted_audit integer := 0;
    deleted_security integer := 0;
    deleted_recommendations integer := 0;
begin
    if not public.pf_is_owner(target_household_id) then
        raise exception 'Somente o proprietário pode executar a limpeza de retenção.';
    end if;

    select *
    into settings
    from public.pf_data_retention_settings retention
    where retention.household_id = target_household_id;

    if not found then
        raise exception 'Configuração de retenção não encontrada.';
    end if;

    delete from public.pf_audit_log audit
    where audit.household_id = target_household_id
      and audit.created_at < now() - make_interval(days => settings.audit_retention_days);
    get diagnostics deleted_audit = row_count;

    delete from public.pf_security_events event
    where event.household_id = target_household_id
      and event.created_at < now() - make_interval(days => settings.security_event_retention_days);
    get diagnostics deleted_security = row_count;

    delete from public.pf_financial_recommendations recommendation
    where recommendation.household_id = target_household_id
      and recommendation.created_at < now() - make_interval(days => settings.recommendation_retention_days);
    get diagnostics deleted_recommendations = row_count;

    return jsonb_build_object(
        'audit_logs_deleted', deleted_audit,
        'security_events_deleted', deleted_security,
        'recommendations_deleted', deleted_recommendations
    );
end;
$$;

-- ---------------------------------------------------------
-- 4. RLS E PERMISSÕES
-- ---------------------------------------------------------

alter table public.pf_security_events enable row level security;
alter table public.pf_financial_recommendations enable row level security;
alter table public.pf_privacy_requests enable row level security;
alter table public.pf_data_retention_settings enable row level security;

revoke all on public.pf_security_events from anon;
revoke all on public.pf_financial_recommendations from anon;
revoke all on public.pf_privacy_requests from anon;
revoke all on public.pf_data_retention_settings from anon;

drop policy if exists pf_security_events_owner_read on public.pf_security_events;
create policy pf_security_events_owner_read
on public.pf_security_events
for select
to authenticated
using ((select public.pf_is_owner(household_id)));

drop policy if exists pf_recommendations_member_read on public.pf_financial_recommendations;
create policy pf_recommendations_member_read
on public.pf_financial_recommendations
for select
to authenticated
using ((select public.pf_is_member(household_id)));

drop policy if exists pf_recommendations_writer_insert on public.pf_financial_recommendations;
create policy pf_recommendations_writer_insert
on public.pf_financial_recommendations
for insert
to authenticated
with check ((select public.pf_is_member(household_id)));

drop policy if exists pf_recommendations_writer_update on public.pf_financial_recommendations;
create policy pf_recommendations_writer_update
on public.pf_financial_recommendations
for update
to authenticated
using ((select public.pf_is_member(household_id)))
with check ((select public.pf_is_member(household_id)));

drop policy if exists pf_privacy_request_member_insert on public.pf_privacy_requests;
create policy pf_privacy_request_member_insert
on public.pf_privacy_requests
for insert
to authenticated
with check (
    requested_by = auth.uid()
    and (select public.pf_is_member(household_id))
);

drop policy if exists pf_privacy_request_member_read on public.pf_privacy_requests;
create policy pf_privacy_request_member_read
on public.pf_privacy_requests
for select
to authenticated
using (
    requested_by = auth.uid()
    or (select public.pf_is_owner(household_id))
);

drop policy if exists pf_privacy_request_owner_update on public.pf_privacy_requests;
create policy pf_privacy_request_owner_update
on public.pf_privacy_requests
for update
to authenticated
using ((select public.pf_is_owner(household_id)))
with check ((select public.pf_is_owner(household_id)));

drop policy if exists pf_retention_owner_read on public.pf_data_retention_settings;
create policy pf_retention_owner_read
on public.pf_data_retention_settings
for select
to authenticated
using ((select public.pf_is_owner(household_id)));

drop policy if exists pf_retention_owner_update on public.pf_data_retention_settings;
create policy pf_retention_owner_update
on public.pf_data_retention_settings
for update
to authenticated
using ((select public.pf_is_owner(household_id)))
with check ((select public.pf_is_owner(household_id)));

grant select on public.pf_security_events to authenticated;
grant select, insert, update on public.pf_financial_recommendations to authenticated;
grant select, insert, update on public.pf_privacy_requests to authenticated;
grant select, update on public.pf_data_retention_settings to authenticated;
grant select on public.pf_active_financial_recommendations to authenticated;

revoke all
on function public.pf_log_security_event(
    uuid,
    text,
    text,
    boolean,
    text,
    text,
    text,
    text,
    text,
    jsonb
)
from public, anon;

grant execute
on function public.pf_log_security_event(
    uuid,
    text,
    text,
    boolean,
    text,
    text,
    text,
    text,
    text,
    jsonb
)
to authenticated;

revoke all
on function public.pf_create_privacy_request(uuid, text, text)
from public, anon;

grant execute
on function public.pf_create_privacy_request(uuid, text, text)
to authenticated;

revoke all
on function public.pf_purge_expired_compliance_data(uuid)
from public, anon;

grant execute
on function public.pf_purge_expired_compliance_data(uuid)
to authenticated;

-- Auditoria de mudanças de compliance.
do $$
begin
    if to_regprocedure('public.pf_capture_audit()') is not null then
        drop trigger if exists pf_audit_changes_trigger
        on public.pf_privacy_requests;
        create trigger pf_audit_changes_trigger
        after insert or update or delete
        on public.pf_privacy_requests
        for each row
        execute function public.pf_capture_audit();

        drop trigger if exists pf_audit_changes_trigger
        on public.pf_data_retention_settings;
        create trigger pf_audit_changes_trigger
        after insert or update or delete
        on public.pf_data_retention_settings
        for each row
        execute function public.pf_capture_audit();
    end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
