begin;

create extension if not exists pgcrypto;

-- =========================================================
-- PERFIS E GRUPOS FAMILIARES
-- =========================================================

create table if not exists public.pf_profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    name text not null,
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.pf_households (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_by uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.pf_household_members (
    household_id uuid not null references public.pf_households(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null default 'member'
        check (role in ('owner', 'member', 'viewer')),
    created_at timestamptz not null default now(),
    primary key (household_id, user_id)
);

-- =========================================================
-- CONTAS, CARTÕES E INVESTIMENTOS
-- =========================================================

create table if not exists public.pf_accounts (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    owner_user_id uuid references auth.users(id) on delete set null,

    name text not null,
    institution_name text,
    type text not null
        check (
            type in (
                'checking',
                'savings',
                'cash',
                'wallet',
                'credit_card',
                'investment'
            )
        ),

    balance numeric(14, 2) not null default 0,
    credit_limit numeric(14, 2),
    closing_day integer check (closing_day between 1 and 31),
    due_day integer check (due_day between 1 and 31),

    source text not null default 'manual'
        check (source in ('manual', 'open_finance', 'import')),

    external_id text,
    is_shared boolean not null default true,
    is_active boolean not null default true,
    balance_updated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- =========================================================
-- CATEGORIAS
-- =========================================================

create table if not exists public.pf_categories (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    parent_id uuid references public.pf_categories(id) on delete cascade,

    name text not null,

    kind text not null
        check (kind in ('income', 'expense', 'debt', 'investment')),

    group_type text not null
        check (
            group_type in (
                'income',
                'essential',
                'lifestyle',
                'debt',
                'investment',
                'other'
            )
        ),

    icon text,
    color text,
    is_system boolean not null default false,
    created_at timestamptz not null default now(),

    unique (household_id, name, kind)
);

-- =========================================================
-- DÍVIDAS
-- =========================================================

create table if not exists public.pf_debts (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    created_by uuid not null default auth.uid() references auth.users(id),

    creditor text not null,
    description text,

    type text not null default 'other'
        check (
            type in (
                'loan',
                'financing',
                'credit_card',
                'tax',
                'informal',
                'overdue_bill',
                'other'
            )
        ),

    original_amount numeric(14, 2) not null
        check (original_amount > 0),

    current_balance numeric(14, 2) not null default 0
        check (current_balance >= 0),

    monthly_interest_rate numeric(8, 4) not null default 0,
    penalty_rate numeric(8, 4) not null default 0,
    daily_late_interest_rate numeric(8, 4) not null default 0,

    start_date date not null default current_date,
    due_date date,

    status text not null default 'active'
        check (status in ('active', 'paid', 'negotiating', 'cancelled')),

    linked_account_id uuid references public.pf_accounts(id) on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- =========================================================
-- LANÇAMENTOS
-- =========================================================

create table if not exists public.pf_transactions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,

    account_id uuid not null references public.pf_accounts(id) on delete restrict,
    destination_account_id uuid references public.pf_accounts(id) on delete restrict,
    category_id uuid references public.pf_categories(id) on delete set null,
    debt_id uuid references public.pf_debts(id) on delete set null,

    created_by uuid not null default auth.uid() references auth.users(id),
    responsible_user_id uuid default auth.uid() references auth.users(id),

    type text not null
        check (
            type in (
                'income',
                'expense',
                'transfer',
                'debt_received',
                'debt_payment',
                'investment_contribution',
                'investment_withdrawal',
                'adjustment'
            )
        ),

    status text not null default 'paid'
        check (status in ('planned', 'paid', 'overdue', 'cancelled')),

    description text not null,
    merchant text,

    amount numeric(14, 2) not null check (amount > 0),
    original_amount numeric(14, 2),

    occurred_on date not null default current_date,
    due_date date,
    paid_at timestamptz,

    installment_group_id uuid,
    installment_number integer check (installment_number is null or installment_number > 0),
    installment_total integer check (installment_total is null or installment_total > 0),
    recurrence_key uuid,

    source text not null default 'manual'
        check (source in ('manual', 'ai', 'open_finance', 'import')),

    external_id text,

    reconciliation_status text not null default 'pending'
        check (reconciliation_status in ('pending', 'matched', 'ignored')),

    matched_transaction_id uuid
        references public.pf_transactions(id)
        on delete set null,

    notes text,
    metadata jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists pf_transactions_external_unique
    on public.pf_transactions (household_id, source, external_id)
    where external_id is not null;

create index if not exists pf_transactions_household_date_idx
    on public.pf_transactions (household_id, occurred_on desc);

create index if not exists pf_transactions_due_date_idx
    on public.pf_transactions (household_id, due_date)
    where status in ('planned', 'overdue');

-- =========================================================
-- MOVIMENTAÇÕES DAS DÍVIDAS
-- =========================================================

create table if not exists public.pf_debt_movements (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    debt_id uuid not null references public.pf_debts(id) on delete cascade,
    transaction_id uuid references public.pf_transactions(id) on delete set null,

    movement_type text not null
        check (
            movement_type in (
                'principal',
                'interest',
                'fee',
                'payment',
                'discount'
            )
        ),

    amount numeric(14, 2) not null check (amount > 0),
    occurred_on date not null default current_date,
    notes text,

    created_by uuid not null default auth.uid() references auth.users(id),
    created_at timestamptz not null default now()
);

-- =========================================================
-- METAS
-- =========================================================

create table if not exists public.pf_goals (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    created_by uuid not null default auth.uid() references auth.users(id),

    name text not null,
    description text,

    target_amount numeric(14, 2) not null check (target_amount > 0),
    current_amount numeric(14, 2) not null default 0 check (current_amount >= 0),

    target_date date,
    linked_account_id uuid references public.pf_accounts(id) on delete set null,

    status text not null default 'active'
        check (status in ('active', 'completed', 'paused', 'cancelled')),

    color text,
    icon text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.pf_goal_contributions (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    goal_id uuid not null references public.pf_goals(id) on delete cascade,
    transaction_id uuid references public.pf_transactions(id) on delete set null,

    amount numeric(14, 2) not null check (amount > 0),
    contributed_on date not null default current_date,
    notes text,

    created_by uuid not null default auth.uid() references auth.users(id),
    created_at timestamptz not null default now()
);

-- =========================================================
-- ORÇAMENTOS MENSAIS
-- =========================================================

create table if not exists public.pf_budgets (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    category_id uuid not null references public.pf_categories(id) on delete cascade,

    month date not null,
    amount numeric(14, 2) not null check (amount > 0),

    created_by uuid not null default auth.uid() references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (household_id, category_id, month)
);

-- =========================================================
-- OPEN FINANCE
-- Não armazenar CLIENT_SECRET, API KEY ou tokens bancários aqui.
-- =========================================================

create table if not exists public.pf_bank_connections (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    owner_user_id uuid not null references auth.users(id),

    provider text not null,
    external_item_id text not null,
    institution_name text not null,

    status text not null default 'active'
        check (status in ('active', 'error', 'expired', 'revoked')),

    last_sync_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (provider, external_item_id)
);

-- =========================================================
-- AUDITORIA DO AGENTE DE IA
-- =========================================================

create table if not exists public.pf_ai_commands (
    id uuid primary key default gen_random_uuid(),
    household_id uuid not null references public.pf_households(id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users(id),

    raw_text text not null,
    parsed_payload jsonb,

    status text not null default 'preview'
        check (status in ('preview', 'applied', 'rejected', 'error')),

    provider text,
    model text,
    error_message text,

    created_at timestamptz not null default now(),
    applied_at timestamptz
);

-- =========================================================
-- FUNÇÕES DE PERMISSÃO
-- =========================================================

create or replace function public.pf_is_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.pf_household_members
        where household_id = target_household_id
          and user_id = auth.uid()
    );
$$;

create or replace function public.pf_is_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.pf_household_members
        where household_id = target_household_id
          and user_id = auth.uid()
          and role = 'owner'
    );
$$;

create or replace function public.pf_shares_household(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.pf_household_members mine
        inner join public.pf_household_members other_member
            on other_member.household_id = mine.household_id
        where mine.user_id = auth.uid()
          and other_member.user_id = target_user_id
    );
$$;

-- =========================================================
-- PERFIL AUTOMÁTICO PARA NOVOS USUÁRIOS
-- =========================================================

create or replace function public.pf_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.pf_profiles (id, name)
    values (
        new.id,
        coalesce(
            nullif(new.raw_user_meta_data ->> 'name', ''),
            split_part(coalesce(new.email, 'usuario'), '@', 1)
        )
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists pf_on_auth_user_created on auth.users;

create trigger pf_on_auth_user_created
after insert on auth.users
for each row
execute function public.pf_handle_new_user();

insert into public.pf_profiles (id, name)
select
    id,
    coalesce(
        nullif(raw_user_meta_data ->> 'name', ''),
        split_part(coalesce(email, 'usuario'), '@', 1)
    )
from auth.users
on conflict (id) do nothing;

-- =========================================================
-- CRIAÇÃO DO GRUPO FAMILIAR E CATEGORIAS PADRÃO
-- =========================================================

create or replace function public.pf_after_household_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.pf_household_members (
        household_id,
        user_id,
        role
    )
    values (
        new.id,
        new.created_by,
        'owner'
    )
    on conflict do nothing;

    insert into public.pf_categories (
        household_id,
        name,
        kind,
        group_type,
        icon,
        is_system
    )
    values
        (new.id, 'Salário', 'income', 'income', 'wallet-cards', true),
        (new.id, 'Renda extra', 'income', 'income', 'circle-plus', true),
        (new.id, 'Reembolso', 'income', 'income', 'rotate-ccw', true),
        (new.id, 'Rendimentos', 'income', 'income', 'trending-up', true),

        (new.id, 'Moradia', 'expense', 'essential', 'house', true),
        (new.id, 'Supermercado', 'expense', 'essential', 'shopping-basket', true),
        (new.id, 'Contas da casa', 'expense', 'essential', 'receipt', true),
        (new.id, 'Educação', 'expense', 'essential', 'graduation-cap', true),
        (new.id, 'Saúde', 'expense', 'essential', 'heart-pulse', true),
        (new.id, 'Transporte', 'expense', 'essential', 'car', true),
        (new.id, 'Filhos', 'expense', 'essential', 'baby', true),
        (new.id, 'Impostos pessoais', 'expense', 'essential', 'landmark', true),

        (new.id, 'Lazer', 'expense', 'lifestyle', 'party-popper', true),
        (new.id, 'Restaurantes e delivery', 'expense', 'lifestyle', 'utensils', true),
        (new.id, 'Compras', 'expense', 'lifestyle', 'shopping-bag', true),
        (new.id, 'Assinaturas', 'expense', 'lifestyle', 'repeat', true),

        (new.id, 'Pagamento de dívida', 'debt', 'debt', 'hand-coins', true),
        (new.id, 'Juros e multas', 'debt', 'debt', 'triangle-alert', true),

        (new.id, 'Aportes e investimentos', 'investment', 'investment', 'chart-no-axes-combined', true)
    on conflict do nothing;

    return new;
end;
$$;

drop trigger if exists pf_on_household_created on public.pf_households;

create trigger pf_on_household_created
after insert on public.pf_households
for each row
execute function public.pf_after_household_created();

-- =========================================================
-- CÁLCULO AUTOMÁTICO DO SALDO DAS DÍVIDAS
-- =========================================================

create or replace function public.pf_recalculate_debt_balance(target_debt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.pf_debts
    set
        current_balance = greatest(
            0,
            coalesce(
                (
                    select sum(
                        case
                            when movement_type in ('principal', 'interest', 'fee')
                                then amount
                            when movement_type in ('payment', 'discount')
                                then -amount
                            else 0
                        end
                    )
                    from public.pf_debt_movements
                    where debt_id = target_debt_id
                ),
                0
            )
        ),
        updated_at = now()
    where id = target_debt_id;
end;
$$;

create or replace function public.pf_create_initial_debt_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.pf_debt_movements (
        household_id,
        debt_id,
        movement_type,
        amount,
        occurred_on,
        notes,
        created_by
    )
    values (
        new.household_id,
        new.id,
        'principal',
        new.original_amount,
        new.start_date,
        'Valor inicial da dívida',
        new.created_by
    );

    return new;
end;
$$;

drop trigger if exists pf_on_debt_created on public.pf_debts;

create trigger pf_on_debt_created
after insert on public.pf_debts
for each row
execute function public.pf_create_initial_debt_movement();

create or replace function public.pf_after_debt_movement_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'DELETE' then
        perform public.pf_recalculate_debt_balance(old.debt_id);
        return old;
    end if;

    perform public.pf_recalculate_debt_balance(new.debt_id);

    if tg_op = 'UPDATE' and old.debt_id <> new.debt_id then
        perform public.pf_recalculate_debt_balance(old.debt_id);
    end if;

    return new;
end;
$$;

drop trigger if exists pf_on_debt_movement_change
on public.pf_debt_movements;

create trigger pf_on_debt_movement_change
after insert or update or delete
on public.pf_debt_movements
for each row
execute function public.pf_after_debt_movement_change();

-- =========================================================
-- CÁLCULO AUTOMÁTICO DAS METAS
-- =========================================================

create or replace function public.pf_recalculate_goal_amount(target_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.pf_goals
    set
        current_amount = coalesce(
            (
                select sum(amount)
                from public.pf_goal_contributions
                where goal_id = target_goal_id
            ),
            0
        ),
        status = case
            when coalesce(
                (
                    select sum(amount)
                    from public.pf_goal_contributions
                    where goal_id = target_goal_id
                ),
                0
            ) >= target_amount
                then 'completed'
            when status = 'completed'
                then 'active'
            else status
        end,
        updated_at = now()
    where id = target_goal_id;
end;
$$;

create or replace function public.pf_after_goal_contribution_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'DELETE' then
        perform public.pf_recalculate_goal_amount(old.goal_id);
        return old;
    end if;

    perform public.pf_recalculate_goal_amount(new.goal_id);

    if tg_op = 'UPDATE' and old.goal_id <> new.goal_id then
        perform public.pf_recalculate_goal_amount(old.goal_id);
    end if;

    return new;
end;
$$;

drop trigger if exists pf_on_goal_contribution_change
on public.pf_goal_contributions;

create trigger pf_on_goal_contribution_change
after insert or update or delete
on public.pf_goal_contributions
for each row
execute function public.pf_after_goal_contribution_change();

-- =========================================================
-- VISÃO RESUMIDA DO DASHBOARD
-- =========================================================

create or replace view public.pf_dashboard_summary
with (security_invoker = true)
as
select
    household.id as household_id,

    coalesce(
        (
            select sum(account.balance)
            from public.pf_accounts account
            where account.household_id = household.id
              and account.is_active = true
              and account.type in ('checking', 'savings', 'cash', 'wallet')
        ),
        0
    ) as available_balance,

    coalesce(
        (
            select sum(transaction.amount)
            from public.pf_transactions transaction
            where transaction.household_id = household.id
              and transaction.type = 'income'
              and transaction.status in ('planned', 'overdue')
        ),
        0
    ) as receivable_amount,

    coalesce(
        (
            select sum(transaction.amount)
            from public.pf_transactions transaction
            where transaction.household_id = household.id
              and transaction.type in ('expense', 'debt_payment')
              and transaction.status in ('planned', 'overdue')
        ),
        0
    ) as payable_amount,

    coalesce(
        (
            select sum(transaction.amount)
            from public.pf_transactions transaction
            where transaction.household_id = household.id
              and transaction.status in ('planned', 'overdue')
              and transaction.due_date < current_date
        ),
        0
    ) as overdue_amount,

    coalesce(
        (
            select sum(
                greatest(
                    transaction.amount
                    - coalesce(transaction.original_amount, transaction.amount),
                    0
                )
            )
            from public.pf_transactions transaction
            where transaction.household_id = household.id
              and transaction.status in ('planned', 'overdue')
              and transaction.due_date < current_date
        ),
        0
    ) as overdue_increase_amount,

    coalesce(
        (
            select sum(debt.current_balance)
            from public.pf_debts debt
            where debt.household_id = household.id
              and debt.status in ('active', 'negotiating')
        ),
        0
    ) as total_debt_amount,

    coalesce(
        (
            select sum(account.balance)
            from public.pf_accounts account
            where account.household_id = household.id
              and account.is_active = true
              and account.type = 'investment'
        ),
        0
    ) as invested_amount,

    coalesce(
        (
            select sum(transaction.amount)
            from public.pf_transactions transaction
            where transaction.household_id = household.id
              and transaction.type = 'income'
              and transaction.status = 'paid'
              and date_trunc('month', transaction.occurred_on)
                  = date_trunc('month', current_date)
        ),
        0
    ) as received_this_month,

    coalesce(
        (
            select sum(transaction.amount)
            from public.pf_transactions transaction
            where transaction.household_id = household.id
              and transaction.type = 'expense'
              and transaction.status = 'paid'
              and date_trunc('month', transaction.occurred_on)
                  = date_trunc('month', current_date)
        ),
        0
    ) as spent_this_month

from public.pf_households household;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.pf_profiles enable row level security;
alter table public.pf_households enable row level security;
alter table public.pf_household_members enable row level security;

drop policy if exists pf_profiles_select on public.pf_profiles;
create policy pf_profiles_select
on public.pf_profiles
for select
using (
    id = auth.uid()
    or public.pf_shares_household(id)
);

drop policy if exists pf_profiles_update on public.pf_profiles;
create policy pf_profiles_update
on public.pf_profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists pf_households_select on public.pf_households;
create policy pf_households_select
on public.pf_households
for select
using (public.pf_is_member(id));

drop policy if exists pf_households_insert on public.pf_households;
create policy pf_households_insert
on public.pf_households
for insert
with check (created_by = auth.uid());

drop policy if exists pf_households_update on public.pf_households;
create policy pf_households_update
on public.pf_households
for update
using (public.pf_is_owner(id))
with check (public.pf_is_owner(id));

drop policy if exists pf_households_delete on public.pf_households;
create policy pf_households_delete
on public.pf_households
for delete
using (public.pf_is_owner(id));

drop policy if exists pf_household_members_select
on public.pf_household_members;

create policy pf_household_members_select
on public.pf_household_members
for select
using (public.pf_is_member(household_id));

drop policy if exists pf_household_members_insert
on public.pf_household_members;

create policy pf_household_members_insert
on public.pf_household_members
for insert
with check (public.pf_is_owner(household_id));

drop policy if exists pf_household_members_update
on public.pf_household_members;

create policy pf_household_members_update
on public.pf_household_members
for update
using (public.pf_is_owner(household_id))
with check (public.pf_is_owner(household_id));

drop policy if exists pf_household_members_delete
on public.pf_household_members;

create policy pf_household_members_delete
on public.pf_household_members
for delete
using (public.pf_is_owner(household_id));

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'pf_accounts',
        'pf_categories',
        'pf_debts',
        'pf_transactions',
        'pf_debt_movements',
        'pf_goals',
        'pf_goal_contributions',
        'pf_budgets',
        'pf_bank_connections',
        'pf_ai_commands'
    ]
    loop
        execute format(
            'alter table public.%I enable row level security',
            table_name
        );

        execute format(
            'drop policy if exists %I on public.%I',
            table_name || '_select',
            table_name
        );

        execute format(
            'create policy %I on public.%I for select using (public.pf_is_member(household_id))',
            table_name || '_select',
            table_name
        );

        execute format(
            'drop policy if exists %I on public.%I',
            table_name || '_insert',
            table_name
        );

        execute format(
            'create policy %I on public.%I for insert with check (public.pf_is_member(household_id))',
            table_name || '_insert',
            table_name
        );

        execute format(
            'drop policy if exists %I on public.%I',
            table_name || '_update',
            table_name
        );

        execute format(
            'create policy %I on public.%I for update using (public.pf_is_member(household_id)) with check (public.pf_is_member(household_id))',
            table_name || '_update',
            table_name
        );

        execute format(
            'drop policy if exists %I on public.%I',
            table_name || '_delete',
            table_name
        );

        execute format(
            'create policy %I on public.%I for delete using (public.pf_is_member(household_id))',
            table_name || '_delete',
            table_name
        );

        execute format(
            'grant select, insert, update, delete on table public.%I to authenticated',
            table_name
        );
    end loop;
end;
$$;

grant select, insert, update on public.pf_profiles to authenticated;
grant select, insert, update, delete on public.pf_households to authenticated;
grant select, insert, update, delete on public.pf_household_members to authenticated;
grant select on public.pf_dashboard_summary to authenticated;

grant execute on function public.pf_is_member(uuid) to authenticated;
grant execute on function public.pf_is_owner(uuid) to authenticated;
grant execute on function public.pf_shares_household(uuid) to authenticated;

commit;