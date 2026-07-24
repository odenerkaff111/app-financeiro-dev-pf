begin;

create table if not exists public.pf_ai_settings (
    id uuid primary key default gen_random_uuid(),

    household_id uuid not null unique
        references public.pf_households(id)
        on delete cascade,

    created_by uuid not null default auth.uid()
        references auth.users(id)
        on delete cascade,

    provider text not null default 'openrouter'
        check (
            provider in (
                'openrouter'
            )
        ),

    model text not null default 'openrouter/free',

    monthly_budget_usd numeric(12, 4)
        not null default 0
        check (
            monthly_budget_usd >= 0
        ),

    is_enabled boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.pf_ai_usage (
    id uuid primary key default gen_random_uuid(),

    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,

    created_by uuid not null default auth.uid()
        references auth.users(id)
        on delete cascade,

    provider text not null default 'openrouter',
    provider_name text,

    model text not null,
    request_kind text not null default 'chat',

    status text not null default 'success'
        check (
            status in (
                'success',
                'failed'
            )
        ),

    generation_id text,

    prompt_tokens bigint not null default 0
        check (
            prompt_tokens >= 0
        ),

    completion_tokens bigint not null default 0
        check (
            completion_tokens >= 0
        ),

    total_tokens bigint not null default 0
        check (
            total_tokens >= 0
        ),

    reasoning_tokens bigint not null default 0
        check (
            reasoning_tokens >= 0
        ),

    cached_tokens bigint not null default 0
        check (
            cached_tokens >= 0
        ),

    cost_usd numeric(18, 10) not null default 0
        check (
            cost_usd >= 0
        ),

    error_message text,

    created_at timestamptz not null default now()
);

create index if not exists
pf_ai_usage_household_created_idx
on public.pf_ai_usage (
    household_id,
    created_at desc
);

insert into public.pf_ai_settings (
    household_id,
    created_by,
    provider,
    model,
    monthly_budget_usd,
    is_enabled
)
select
    household.id,
    household.created_by,
    'openrouter',
    'openrouter/free',
    0,
    true
from public.pf_households household
on conflict (household_id)
do nothing;

alter table public.pf_ai_settings
enable row level security;

alter table public.pf_ai_usage
enable row level security;

drop policy if exists
"pf_ai_settings_select"
on public.pf_ai_settings;

create policy
"pf_ai_settings_select"
on public.pf_ai_settings
for select
to authenticated
using (
    public.pf_is_member(
        household_id
    )
);

drop policy if exists
"pf_ai_settings_insert"
on public.pf_ai_settings;

create policy
"pf_ai_settings_insert"
on public.pf_ai_settings
for insert
to authenticated
with check (
    public.pf_is_member(
        household_id
    )
    and created_by = auth.uid()
);

drop policy if exists
"pf_ai_settings_update"
on public.pf_ai_settings;

create policy
"pf_ai_settings_update"
on public.pf_ai_settings
for update
to authenticated
using (
    public.pf_is_member(
        household_id
    )
)
with check (
    public.pf_is_member(
        household_id
    )
);

drop policy if exists
"pf_ai_usage_select"
on public.pf_ai_usage;

create policy
"pf_ai_usage_select"
on public.pf_ai_usage
for select
to authenticated
using (
    public.pf_is_member(
        household_id
    )
);

drop policy if exists
"pf_ai_usage_insert"
on public.pf_ai_usage;

create policy
"pf_ai_usage_insert"
on public.pf_ai_usage
for insert
to authenticated
with check (
    public.pf_is_member(
        household_id
    )
    and created_by = auth.uid()
);

grant select, insert, update
on public.pf_ai_settings
to authenticated;

grant select, insert
on public.pf_ai_usage
to authenticated;

commit;

notify pgrst, 'reload schema';
