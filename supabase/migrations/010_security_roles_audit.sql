begin;

-- =========================================================
-- FUNÇÕES CENTRAIS DE AUTORIZAÇÃO
-- owner e member são apresentados na interface como Administrador.
-- viewer é somente leitura para dados financeiros.
-- =========================================================

create or replace function public.pf_is_member(
    target_household_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.pf_household_members member
        where member.household_id = target_household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member',
              'viewer'
          )
    );
$$;

create or replace function public.pf_can_write(
    target_household_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.pf_household_members member
        where member.household_id = target_household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    );
$$;

create or replace function public.pf_is_owner(
    target_household_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.pf_household_members member
        where member.household_id = target_household_id
          and member.user_id = auth.uid()
          and member.role = 'owner'
    );
$$;

create or replace function public.pf_current_household_role(
    target_household_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select member.role
    from public.pf_household_members member
    where member.household_id = target_household_id
      and member.user_id = auth.uid()
    limit 1;
$$;

revoke all
on function public.pf_is_member(uuid),
            public.pf_can_write(uuid),
            public.pf_is_owner(uuid),
            public.pf_current_household_role(uuid)
from public;

grant execute
on function public.pf_is_member(uuid),
            public.pf_can_write(uuid),
            public.pf_is_owner(uuid),
            public.pf_current_household_role(uuid)
to authenticated;

create index if not exists
pf_household_members_user_household_idx
on public.pf_household_members (
    user_id,
    household_id
);

-- =========================================================
-- PROTEÇÃO DO PROPRIETÁRIO
-- Um administrador comum não pode remover ou rebaixar o owner.
-- =========================================================

create or replace function public.pf_protect_household_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'DELETE' then
        if old.role = 'owner'
           and not public.pf_is_owner(old.household_id) then
            raise exception
                'Somente o proprietário pode remover o proprietário do grupo.';
        end if;

        return old;
    end if;

    if old.role = 'owner'
       and (
           new.role <> 'owner'
           or new.user_id <> old.user_id
       )
       and not public.pf_is_owner(old.household_id) then
        raise exception
            'Somente o proprietário pode alterar o acesso do proprietário.';
    end if;

    if new.role = 'owner'
       and old.role <> 'owner'
       and not public.pf_is_owner(new.household_id) then
        raise exception
            'Somente o proprietário pode criar outro proprietário.';
    end if;

    return new;
end;
$$;

drop trigger if exists
pf_protect_household_owner_trigger
on public.pf_household_members;

create trigger pf_protect_household_owner_trigger
before update or delete
on public.pf_household_members
for each row
execute function public.pf_protect_household_owner();

-- =========================================================
-- AUDITORIA
-- =========================================================

create table if not exists public.pf_audit_log (
    id uuid primary key default gen_random_uuid(),

    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,

    actor_user_id uuid
        references auth.users(id)
        on delete set null,

    table_name text not null,
    record_id text,
    operation text not null
        check (
            operation in (
                'INSERT',
                'UPDATE',
                'DELETE'
            )
        ),

    source text not null default 'application',

    old_data jsonb,
    new_data jsonb,

    created_at timestamptz not null default now()
);

create index if not exists
pf_audit_log_household_created_idx
on public.pf_audit_log (
    household_id,
    created_at desc
);

alter table public.pf_audit_log
enable row level security;

revoke all
on public.pf_audit_log
from anon;

grant select
on public.pf_audit_log
to authenticated;

drop policy if exists
pf_audit_admin_read
on public.pf_audit_log;

create policy
pf_audit_admin_read
on public.pf_audit_log
for select
to authenticated
using (
    (select public.pf_can_write(household_id))
);

create or replace function public.pf_capture_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    before_data jsonb;
    after_data jsonb;
    selected_data jsonb;
    selected_household_id uuid;
    selected_record_id text;
    selected_source text;
begin
    if tg_op = 'DELETE' then
        before_data := to_jsonb(old);
        after_data := null;
        selected_data := before_data;
    elsif tg_op = 'INSERT' then
        before_data := null;
        after_data := to_jsonb(new);
        selected_data := after_data;
    else
        before_data := to_jsonb(old);
        after_data := to_jsonb(new);
        selected_data := after_data;
    end if;

    selected_household_id :=
        nullif(
            selected_data ->> 'household_id',
            ''
        )::uuid;

    if selected_household_id is null then
        if tg_op = 'DELETE' then
            return old;
        end if;

        return new;
    end if;

    selected_record_id :=
        coalesce(
            nullif(
                selected_data ->> 'id',
                ''
            ),
            nullif(
                selected_data ->> 'user_id',
                ''
            )
        );

    selected_source :=
        coalesce(
            nullif(
                selected_data ->> 'source',
                ''
            ),
            nullif(
                selected_data #>> '{metadata,origin}',
                ''
            ),
            'application'
        );

    insert into public.pf_audit_log (
        household_id,
        actor_user_id,
        table_name,
        record_id,
        operation,
        source,
        old_data,
        new_data
    )
    values (
        selected_household_id,
        auth.uid(),
        tg_table_name,
        selected_record_id,
        tg_op,
        selected_source,
        before_data,
        after_data
    );

    if tg_op = 'DELETE' then
        return old;
    end if;

    return new;
end;
$$;

do $$
declare
    selected_table text;
    audited_tables text[] := array[
        'pf_accounts',
        'pf_categories',
        'pf_transactions',
        'pf_debts',
        'pf_debt_movements',
        'pf_recurring_templates',
        'pf_ai_settings',
        'pf_household_members'
    ];
begin
    foreach selected_table in array audited_tables loop
        if to_regclass(
            'public.' || selected_table
        ) is not null then
            execute format(
                'drop trigger if exists pf_audit_changes_trigger on public.%I',
                selected_table
            );

            execute format(
                'create trigger pf_audit_changes_trigger
                 after insert or update or delete
                 on public.%I
                 for each row
                 execute function public.pf_capture_audit()',
                selected_table
            );
        end if;
    end loop;
end;
$$;

-- =========================================================
-- RLS PADRONIZADO PARA TODAS AS TABELAS PF COM household_id
-- =========================================================

do $$
declare
    selected_table record;
    selected_policy record;
begin
    for selected_table in
        select columns.table_name
        from information_schema.columns columns
        join information_schema.tables tables
          on tables.table_schema = columns.table_schema
         and tables.table_name = columns.table_name
        where columns.table_schema = 'public'
          and columns.column_name = 'household_id'
          and columns.table_name like 'pf\_%' escape '\'
          and tables.table_type = 'BASE TABLE'
          and columns.table_name not in (
              'pf_audit_log',
              'pf_household_members',
              'pf_ai_conversations',
              'pf_ai_messages',
              'pf_ai_settings',
              'pf_ai_usage'
          )
        group by columns.table_name
    loop
        execute format(
            'alter table public.%I enable row level security',
            selected_table.table_name
        );

        for selected_policy in
            select policyname
            from pg_policies
            where schemaname = 'public'
              and tablename = selected_table.table_name
        loop
            execute format(
                'drop policy if exists %I on public.%I',
                selected_policy.policyname,
                selected_table.table_name
            );
        end loop;

        execute format(
            'create policy pf_member_read
             on public.%I
             for select
             to authenticated
             using (
                 (select public.pf_is_member(household_id))
             )',
            selected_table.table_name
        );

        execute format(
            'create policy pf_admin_insert
             on public.%I
             for insert
             to authenticated
             with check (
                 (select public.pf_can_write(household_id))
             )',
            selected_table.table_name
        );

        execute format(
            'create policy pf_admin_update
             on public.%I
             for update
             to authenticated
             using (
                 (select public.pf_can_write(household_id))
             )
             with check (
                 (select public.pf_can_write(household_id))
             )',
            selected_table.table_name
        );

        execute format(
            'create policy pf_admin_delete
             on public.%I
             for delete
             to authenticated
             using (
                 (select public.pf_can_write(household_id))
             )',
            selected_table.table_name
        );

        execute format(
            'revoke all on public.%I from anon',
            selected_table.table_name
        );

        execute format(
            'grant select, insert, update, delete
             on public.%I
             to authenticated',
            selected_table.table_name
        );
    end loop;
end;
$$;

-- =========================================================
-- HOUSEHOLDS
-- =========================================================

alter table public.pf_households
enable row level security;

do $$
declare
    selected_policy record;
begin
    for selected_policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = 'pf_households'
    loop
        execute format(
            'drop policy if exists %I on public.pf_households',
            selected_policy.policyname
        );
    end loop;
end;
$$;

create policy
pf_households_member_read
on public.pf_households
for select
to authenticated
using (
    (select public.pf_is_member(id))
);

create policy
pf_households_admin_update
on public.pf_households
for update
to authenticated
using (
    (select public.pf_can_write(id))
)
with check (
    (select public.pf_can_write(id))
);

revoke all
on public.pf_households
from anon;

grant select, update
on public.pf_households
to authenticated;

-- =========================================================
-- MEMBROS
-- =========================================================

alter table public.pf_household_members
enable row level security;

do $$
declare
    selected_policy record;
begin
    for selected_policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = 'pf_household_members'
    loop
        execute format(
            'drop policy if exists %I on public.pf_household_members',
            selected_policy.policyname
        );
    end loop;
end;
$$;

create policy
pf_household_members_member_read
on public.pf_household_members
for select
to authenticated
using (
    (select public.pf_is_member(household_id))
);

create policy
pf_household_members_admin_insert
on public.pf_household_members
for insert
to authenticated
with check (
    (select public.pf_can_write(household_id))
);

create policy
pf_household_members_admin_update
on public.pf_household_members
for update
to authenticated
using (
    (select public.pf_can_write(household_id))
)
with check (
    (select public.pf_can_write(household_id))
);

create policy
pf_household_members_admin_delete
on public.pf_household_members
for delete
to authenticated
using (
    (select public.pf_can_write(household_id))
);

revoke all
on public.pf_household_members
from anon;

grant select, insert, update, delete
on public.pf_household_members
to authenticated;

-- =========================================================
-- CONVERSAS DE IA
-- O visualizador pode conversar, mas não confirmar ações financeiras.
-- =========================================================

do $$
declare
    selected_table text;
    selected_policy record;
begin
    foreach selected_table in array array[
        'pf_ai_conversations',
        'pf_ai_messages'
    ]
    loop
        if to_regclass(
            'public.' || selected_table
        ) is not null then
            execute format(
                'alter table public.%I enable row level security',
                selected_table
            );

            for selected_policy in
                select policyname
                from pg_policies
                where schemaname = 'public'
                  and tablename = selected_table
            loop
                execute format(
                    'drop policy if exists %I on public.%I',
                    selected_policy.policyname,
                    selected_table
                );
            end loop;

            execute format(
                'create policy pf_ai_member_read
                 on public.%I
                 for select
                 to authenticated
                 using (
                     (select public.pf_is_member(household_id))
                 )',
                selected_table
            );

            execute format(
                'create policy pf_ai_member_insert
                 on public.%I
                 for insert
                 to authenticated
                 with check (
                     (select public.pf_is_member(household_id))
                 )',
                selected_table
            );

            execute format(
                'create policy pf_ai_member_update
                 on public.%I
                 for update
                 to authenticated
                 using (
                     (select public.pf_is_member(household_id))
                 )
                 with check (
                     (select public.pf_is_member(household_id))
                 )',
                selected_table
            );

            execute format(
                'create policy pf_ai_own_delete
                 on public.%I
                 for delete
                 to authenticated
                 using (
                     created_by = auth.uid()
                     or (select public.pf_can_write(household_id))
                 )',
                selected_table
            );

            execute format(
                'revoke all on public.%I from anon',
                selected_table
            );

            execute format(
                'grant select, insert, update, delete
                 on public.%I
                 to authenticated',
                selected_table
            );
        end if;
    end loop;
end;
$$;

-- =========================================================
-- CONFIGURAÇÕES E USO DE IA
-- =========================================================

do $$
declare
    selected_policy record;
begin
    if to_regclass(
        'public.pf_ai_settings'
    ) is not null then
        alter table public.pf_ai_settings
        enable row level security;

        for selected_policy in
            select policyname
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pf_ai_settings'
        loop
            execute format(
                'drop policy if exists %I on public.pf_ai_settings',
                selected_policy.policyname
            );
        end loop;

        create policy
        pf_ai_settings_member_read
        on public.pf_ai_settings
        for select
        to authenticated
        using (
            (select public.pf_is_member(household_id))
        );

        create policy
        pf_ai_settings_admin_insert
        on public.pf_ai_settings
        for insert
        to authenticated
        with check (
            (select public.pf_can_write(household_id))
        );

        create policy
        pf_ai_settings_admin_update
        on public.pf_ai_settings
        for update
        to authenticated
        using (
            (select public.pf_can_write(household_id))
        )
        with check (
            (select public.pf_can_write(household_id))
        );

        revoke all
        on public.pf_ai_settings
        from anon;

        grant select, insert, update
        on public.pf_ai_settings
        to authenticated;
    end if;

    if to_regclass(
        'public.pf_ai_usage'
    ) is not null then
        alter table public.pf_ai_usage
        enable row level security;

        for selected_policy in
            select policyname
            from pg_policies
            where schemaname = 'public'
              and tablename = 'pf_ai_usage'
        loop
            execute format(
                'drop policy if exists %I on public.pf_ai_usage',
                selected_policy.policyname
            );
        end loop;

        create policy
        pf_ai_usage_admin_read
        on public.pf_ai_usage
        for select
        to authenticated
        using (
            (select public.pf_can_write(household_id))
        );

        create policy
        pf_ai_usage_member_insert
        on public.pf_ai_usage
        for insert
        to authenticated
        with check (
            (select public.pf_is_member(household_id))
            and created_by = auth.uid()
        );

        revoke all
        on public.pf_ai_usage
        from anon;

        grant select, insert
        on public.pf_ai_usage
        to authenticated;
    end if;
end;
$$;

-- =========================================================
-- VIEWS PF DEVEM RESPEITAR RLS
-- =========================================================

do $$
declare
    selected_view record;
begin
    for selected_view in
        select viewname
        from pg_views
        where schemaname = 'public'
          and viewname like 'pf\_%' escape '\'
    loop
        execute format(
            'alter view public.%I set (security_invoker = true)',
            selected_view.viewname
        );

        execute format(
            'revoke all on public.%I from anon',
            selected_view.viewname
        );

        execute format(
            'grant select on public.%I to authenticated',
            selected_view.viewname
        );
    end loop;
end;
$$;

-- =========================================================
-- FUNÇÕES DE DÍVIDAS: ADMINISTRADOR OBRIGATÓRIO
-- =========================================================

create or replace function public.pf_register_debt_payment(
    target_debt_id uuid,
    target_account_id uuid,
    payment_amount numeric,
    payment_date date default current_date,
    count_installment boolean default true,
    payment_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_debt public.pf_debts%rowtype;
    selected_account public.pf_accounts%rowtype;
    created_transaction_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if payment_amount is null or payment_amount <= 0 then
        raise exception
            'O valor do pagamento precisa ser maior que zero.';
    end if;

    select *
    into selected_debt
    from public.pf_debts
    where id = target_debt_id
    for update;

    if not found then
        raise exception 'Dívida não encontrada.';
    end if;

    if not public.pf_can_write(
        selected_debt.household_id
    ) then
        raise exception
            'Seu acesso é somente leitura.';
    end if;

    if selected_debt.status in (
        'paid',
        'cancelled'
    ) then
        raise exception
            'Esta dívida não aceita novos pagamentos.';
    end if;

    if payment_amount >
       selected_debt.current_balance then
        raise exception
            'O pagamento não pode ser maior que o saldo restante de %.',
            selected_debt.current_balance;
    end if;

    select *
    into selected_account
    from public.pf_accounts
    where id = target_account_id
      and household_id = selected_debt.household_id
      and is_active = true;

    if not found then
        raise exception
            'Conta de pagamento não encontrada ou inativa.';
    end if;

    insert into public.pf_transactions (
        household_id,
        account_id,
        debt_id,
        created_by,
        responsible_user_id,
        type,
        status,
        description,
        merchant,
        amount,
        original_amount,
        occurred_on,
        due_date,
        paid_at,
        source,
        notes,
        metadata
    )
    values (
        selected_debt.household_id,
        target_account_id,
        selected_debt.id,
        current_user_id,
        current_user_id,
        'debt_payment',
        'paid',
        'Pagamento de dívida - ' || selected_debt.creditor,
        selected_debt.creditor,
        payment_amount,
        payment_amount,
        coalesce(
            payment_date,
            current_date
        ),
        coalesce(
            payment_date,
            current_date
        ),
        (
            coalesce(
                payment_date,
                current_date
            )::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        'manual',
        nullif(
            trim(payment_notes),
            ''
        ),
        jsonb_build_object(
            'origin',
            'debt_module',
            'count_installment',
            count_installment
        )
    )
    returning id
    into created_transaction_id;

    insert into public.pf_debt_movements (
        household_id,
        debt_id,
        transaction_id,
        movement_type,
        amount,
        occurred_on,
        notes,
        created_by
    )
    values (
        selected_debt.household_id,
        selected_debt.id,
        created_transaction_id,
        'payment',
        payment_amount,
        coalesce(
            payment_date,
            current_date
        ),
        coalesce(
            nullif(
                trim(payment_notes),
                ''
            ),
            'Pagamento registrado pelo módulo de dívidas'
        ),
        current_user_id
    );

    update public.pf_debts
    set
        paid_installments = case
            when count_installment
                 and total_installments is not null
                then least(
                    paid_installments + 1,
                    total_installments
                )
            else paid_installments
        end,
        status = case
            when current_balance <= 0.005
                then 'paid'
            else status
        end,
        updated_at = now()
    where id = selected_debt.id;

    return created_transaction_id;
end;
$$;

revoke all
on function public.pf_register_debt_payment(
    uuid,
    uuid,
    numeric,
    date,
    boolean,
    text
)
from public, anon;

grant execute
on function public.pf_register_debt_payment(
    uuid,
    uuid,
    numeric,
    date,
    boolean,
    text
)
to authenticated;

create or replace function public.pf_register_debt_received(
    target_debt_id uuid,
    target_account_id uuid,
    received_amount numeric,
    received_date date default current_date,
    received_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_debt public.pf_debts%rowtype;
    selected_account public.pf_accounts%rowtype;
    created_transaction_id uuid;
    recalculated_balance numeric(14, 2);
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if received_amount is null or received_amount <= 0 then
        raise exception
            'O valor recebido precisa ser maior que zero.';
    end if;

    select *
    into selected_debt
    from public.pf_debts
    where id = target_debt_id
    for update;

    if not found then
        raise exception 'Dívida não encontrada.';
    end if;

    if not public.pf_can_write(
        selected_debt.household_id
    ) then
        raise exception
            'Seu acesso é somente leitura.';
    end if;

    if selected_debt.status = 'cancelled' then
        raise exception
            'Esta dívida está cancelada.';
    end if;

    select *
    into selected_account
    from public.pf_accounts
    where id = target_account_id
      and household_id = selected_debt.household_id
      and is_active = true;

    if not found then
        raise exception
            'Conta de recebimento não encontrada ou inativa.';
    end if;

    insert into public.pf_transactions (
        household_id,
        account_id,
        debt_id,
        created_by,
        responsible_user_id,
        type,
        status,
        description,
        merchant,
        amount,
        original_amount,
        occurred_on,
        due_date,
        paid_at,
        source,
        notes,
        metadata
    )
    values (
        selected_debt.household_id,
        target_account_id,
        selected_debt.id,
        current_user_id,
        current_user_id,
        'debt_received',
        'paid',
        'Empréstimo recebido - ' || selected_debt.creditor,
        selected_debt.creditor,
        received_amount,
        received_amount,
        coalesce(
            received_date,
            current_date
        ),
        coalesce(
            received_date,
            current_date
        ),
        (
            coalesce(
                received_date,
                current_date
            )::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        'ai',
        nullif(
            trim(received_notes),
            ''
        ),
        jsonb_build_object(
            'origin',
            'financial_assistant',
            'debt_received',
            true,
            'debt_id',
            selected_debt.id
        )
    )
    returning id
    into created_transaction_id;

    insert into public.pf_debt_movements (
        household_id,
        debt_id,
        transaction_id,
        movement_type,
        amount,
        occurred_on,
        notes,
        created_by
    )
    values (
        selected_debt.household_id,
        selected_debt.id,
        created_transaction_id,
        'principal',
        received_amount,
        coalesce(
            received_date,
            current_date
        ),
        coalesce(
            nullif(
                trim(received_notes),
                ''
            ),
            'Novo valor recebido do credor'
        ),
        current_user_id
    );

    select
        greatest(
            0,
            coalesce(
                sum(
                    case
                        when movement.movement_type in (
                            'principal',
                            'interest',
                            'fee'
                        ) then movement.amount
                        when movement.movement_type in (
                            'payment',
                            'discount'
                        ) then -movement.amount
                        else 0
                    end
                ),
                selected_debt.current_balance
                    + received_amount
            )
        )::numeric(14, 2)
    into recalculated_balance
    from public.pf_debt_movements movement
    where movement.debt_id =
        selected_debt.id;

    update public.pf_debts
    set
        original_amount =
            original_amount + received_amount,
        current_balance =
            recalculated_balance,
        status = 'active',
        updated_at = now()
    where id = selected_debt.id;

    return created_transaction_id;
end;
$$;

revoke all
on function public.pf_register_debt_received(
    uuid,
    uuid,
    numeric,
    date,
    text
)
from public, anon;

grant execute
on function public.pf_register_debt_received(
    uuid,
    uuid,
    numeric,
    date,
    text
)
to authenticated;

-- =========================================================
-- TABELAS ANTIGAS QUE NÃO FAZEM PARTE DO FINANCEIRO PESSOAL
-- =========================================================

do $$
begin
    if to_regclass(
        'public.usuarios'
    ) is not null then
        execute
            'revoke all on public.usuarios from anon, authenticated';
    end if;

    if to_regclass(
        'public.configuracoes_sistema'
    ) is not null then
        execute
            'revoke all on public.configuracoes_sistema from anon, authenticated';
    end if;

    if to_regclass(
        'public.perfis'
    ) is not null then
        execute
            'alter table public.perfis enable row level security';
    end if;
end;
$$;

-- Avatares antigos deixam de ser públicos.
update storage.buckets
set public = false
where id = 'avatars';

commit;

notify pgrst, 'reload schema';
