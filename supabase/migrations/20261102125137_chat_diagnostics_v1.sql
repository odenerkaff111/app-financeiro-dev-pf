begin;
create table if not exists public.pf_ai_diagnostics(
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.pf_households(id) on delete cascade,
 created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
 request_id uuid not null,
 conversation_id uuid references public.pf_ai_conversations(id) on delete set null,
 stage text not null check(stage ~ '^[a-z_]{1,40}$'),
 level text not null check(level in ('info','warn','error')),
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<4000),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists pf_ai_diagnostics_owned on public.pf_ai_diagnostics(household_id,created_by,created_at desc);
create index if not exists pf_ai_diagnostics_request on public.pf_ai_diagnostics(request_id,created_at);
alter table public.pf_ai_diagnostics enable row level security;
revoke all on public.pf_ai_diagnostics from anon,authenticated;
grant select,insert on public.pf_ai_diagnostics to authenticated;
drop policy if exists diagnostics_read_owned on public.pf_ai_diagnostics;
create policy diagnostics_read_owned on public.pf_ai_diagnostics for select to authenticated using(created_by=(select auth.uid()) and public.pf_is_member(household_id));
drop policy if exists diagnostics_insert_owned on public.pf_ai_diagnostics;
create policy diagnostics_insert_owned on public.pf_ai_diagnostics for insert to authenticated with check(created_by=(select auth.uid()) and public.pf_is_member(household_id) and (conversation_id is null or exists(select 1 from public.pf_ai_conversations c where c.id=conversation_id and c.household_id=pf_ai_diagnostics.household_id and c.created_by=(select auth.uid()))));
comment on table public.pf_ai_diagnostics is 'Technical diagnostic events; never store prompts, API keys or financial document contents.';
commit;
