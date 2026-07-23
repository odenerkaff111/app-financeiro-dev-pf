begin;

create extension if not exists pgcrypto;

-- =========================================================
-- CONVERSAS DO ASSISTENTE
-- =========================================================

create table if not exists public.pf_ai_conversations (
    id uuid primary key default gen_random_uuid(),

    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,

    created_by uuid not null default auth.uid()
        references auth.users(id)
        on delete cascade,

    title text not null default 'Nova conversa',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_message_at timestamptz not null default now()
);

create index if not exists
pf_ai_conversations_household_idx
on public.pf_ai_conversations (
    household_id,
    last_message_at desc
);

-- =========================================================
-- MENSAGENS E AÇÕES PROPOSTAS
-- =========================================================

create table if not exists public.pf_ai_messages (
    id uuid primary key default gen_random_uuid(),

    conversation_id uuid not null
        references public.pf_ai_conversations(id)
        on delete cascade,

    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,

    created_by uuid not null default auth.uid()
        references auth.users(id)
        on delete cascade,

    role text not null
        check (
            role in (
                'user',
                'assistant',
                'system'
            )
        ),

    content text not null default '',

    action_type text
        check (
            action_type is null
            or action_type in (
                'create_transaction',
                'create_transfer',
                'register_debt_payment',
                'register_variable_recurring',
                'import_statement'
            )
        ),

    action_status text not null default 'none'
        check (
            action_status in (
                'none',
                'pending',
                'confirmed',
                'cancelled',
                'failed'
            )
        ),

    action_payload jsonb not null default '{}'::jsonb,

    error_message text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists
pf_ai_messages_conversation_idx
on public.pf_ai_messages (
    conversation_id,
    created_at asc
);

create index if not exists
pf_ai_messages_pending_actions_idx
on public.pf_ai_messages (
    household_id,
    action_status
)
where action_status = 'pending';

-- =========================================================
-- RLS
-- =========================================================

alter table public.pf_ai_conversations
enable row level security;

alter table public.pf_ai_messages
enable row level security;

drop policy if exists
"pf_ai_conversations_select"
on public.pf_ai_conversations;

create policy
"pf_ai_conversations_select"
on public.pf_ai_conversations
for select
to authenticated
using (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_ai_conversations.household_id
          and member.user_id = auth.uid()
    )
);

drop policy if exists
"pf_ai_conversations_insert"
on public.pf_ai_conversations;

create policy
"pf_ai_conversations_insert"
on public.pf_ai_conversations
for insert
to authenticated
with check (
    created_by = auth.uid()
    and exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_ai_conversations.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
);

drop policy if exists
"pf_ai_conversations_update"
on public.pf_ai_conversations;

create policy
"pf_ai_conversations_update"
on public.pf_ai_conversations
for update
to authenticated
using (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_ai_conversations.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
)
with check (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_ai_conversations.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
);

drop policy if exists
"pf_ai_conversations_delete"
on public.pf_ai_conversations;

create policy
"pf_ai_conversations_delete"
on public.pf_ai_conversations
for delete
to authenticated
using (
    created_by = auth.uid()
);

drop policy if exists
"pf_ai_messages_select"
on public.pf_ai_messages;

create policy
"pf_ai_messages_select"
on public.pf_ai_messages
for select
to authenticated
using (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_ai_messages.household_id
          and member.user_id = auth.uid()
    )
);

drop policy if exists
"pf_ai_messages_insert"
on public.pf_ai_messages;

create policy
"pf_ai_messages_insert"
on public.pf_ai_messages
for insert
to authenticated
with check (
    created_by = auth.uid()
    and exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_ai_messages.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
);

drop policy if exists
"pf_ai_messages_update"
on public.pf_ai_messages;

create policy
"pf_ai_messages_update"
on public.pf_ai_messages
for update
to authenticated
using (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_ai_messages.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
)
with check (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_ai_messages.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
);

drop policy if exists
"pf_ai_messages_delete"
on public.pf_ai_messages;

create policy
"pf_ai_messages_delete"
on public.pf_ai_messages
for delete
to authenticated
using (
    created_by = auth.uid()
);

grant select, insert, update, delete
on public.pf_ai_conversations
to authenticated;

grant select, insert, update, delete
on public.pf_ai_messages
to authenticated;

commit;

notify pgrst, 'reload schema';