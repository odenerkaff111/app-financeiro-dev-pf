begin;

-- =========================================================
-- FIX: categoria de divida + funcoes de vinculo
-- Este arquivo e propositalmente ASCII-only para evitar
-- problemas de encoding ao copiar pelo Windows PowerShell.
-- =========================================================

-- Normaliza a categoria canonica, quando ela ja existe.
update public.pf_categories
set
    group_type = 'debt',
    is_system = true
where kind = 'expense'
  and name = U&'D\00EDvidas';

-- Garante uma categoria de despesa para dividas em todos os households.
insert into public.pf_categories (
    household_id,
    name,
    kind,
    group_type,
    is_system
)
select
    household.id,
    U&'D\00EDvidas',
    'expense',
    'debt',
    true
from public.pf_households household
where not exists (
    select 1
    from public.pf_categories category
    where category.household_id = household.id
      and category.kind = 'expense'
      and category.group_type = 'debt'
)
on conflict (household_id, name, kind)
do update
set
    group_type = 'debt',
    is_system = true;

-- =========================================================
-- CRIA DIVIDA + OBRIGACAO A PAGAR, VINCULADAS POR debt_id.
-- A busca da categoria passa a usar group_type='debt',
-- evitando dependencia do texto com acento.
-- =========================================================

create or replace function public.pf_create_debt_obligation_v1(
    target_household_id uuid,
    obligation_account_id uuid,
    debt_creditor text,
    debt_description text,
    debt_original_amount numeric,
    target_debt_group text default 'other',
    debt_start_date date default current_date,
    debt_due_date date default current_date,
    debt_installment_amount numeric default null,
    debt_interest_enabled boolean default false,
    debt_auto_accrue_interest boolean default false,
    debt_interest_rate numeric default 0,
    debt_interest_period text default 'monthly',
    debt_interest_method text default 'simple',
    obligation_notes text default null
)
returns table (
    debt_id uuid,
    obligation_transaction_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_account public.pf_accounts%rowtype;
    debt_category_id uuid;
    created_debt record;
    created_obligation_id uuid;
    obligation_amount numeric;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuario nao autenticado.';
    end if;

    if not public.pf_can_write(target_household_id) then
        raise exception 'Seu acesso e somente leitura.';
    end if;

    if target_debt_group not in ('personal', 'other') then
        raise exception 'A classificacao da divida deve ser Pessoal ou Outras dividas.';
    end if;

    if nullif(trim(debt_creditor), '') is null then
        raise exception 'Informe o credor.';
    end if;

    if debt_original_amount is null or debt_original_amount <= 0 then
        raise exception 'O valor da divida precisa ser maior que zero.';
    end if;

    select *
    into selected_account
    from public.pf_accounts
    where id = obligation_account_id
      and household_id = target_household_id
      and is_active = true;

    if not found then
        raise exception 'Selecione uma conta ativa para a obrigacao.';
    end if;

    select category.id
    into debt_category_id
    from public.pf_categories category
    where category.household_id = target_household_id
      and category.kind = 'expense'
      and category.group_type = 'debt'
    order by
        (category.name = U&'D\00EDvidas') desc,
        category.created_at asc
    limit 1;

    if debt_category_id is null then
        insert into public.pf_categories (
            household_id,
            name,
            kind,
            group_type,
            is_system
        )
        values (
            target_household_id,
            U&'D\00EDvidas',
            'expense',
            'debt',
            true
        )
        on conflict (household_id, name, kind)
        do update
        set
            group_type = 'debt',
            is_system = true
        returning id into debt_category_id;
    end if;

    select *
    into created_debt
    from public.pf_create_debt_with_initial_payment_v2(
        target_household_id => target_household_id,
        debt_creditor => trim(debt_creditor),
        debt_description => coalesce(
            nullif(trim(debt_description), ''),
            U&'D\00EDvida com ' || trim(debt_creditor)
        ),
        debt_original_amount => debt_original_amount,
        target_debt_group => target_debt_group,
        debt_start_date => coalesce(debt_start_date, current_date),
        debt_due_date => coalesce(debt_due_date, debt_start_date, current_date),
        debt_installment_amount => case
            when coalesce(debt_installment_amount, 0) > 0
                then debt_installment_amount
            else null
        end,
        debt_total_installments => null,
        debt_interest_enabled => coalesce(debt_interest_enabled, false),
        debt_auto_accrue_interest => coalesce(debt_interest_enabled, false)
            and coalesce(debt_auto_accrue_interest, false),
        debt_interest_rate => coalesce(debt_interest_rate, 0),
        debt_interest_period => coalesce(nullif(debt_interest_period, ''), 'monthly'),
        debt_interest_method => coalesce(nullif(debt_interest_method, ''), 'simple'),
        debt_penalty_rate => 0,
        debt_daily_late_interest_rate => 0,
        debt_grace_period_days => 0,
        debt_responsible_user_id => current_user_id,
        debt_visibility_scope => 'family',
        initial_payment_amount => 0,
        initial_payment_account_id => null,
        initial_payment_date => coalesce(debt_start_date, current_date),
        initial_payment_count_installment => false,
        initial_payment_notes => null
    );

    obligation_amount := case
        when coalesce(debt_installment_amount, 0) > 0
            then least(debt_installment_amount, debt_original_amount)
        else debt_original_amount
    end;

    insert into public.pf_transactions (
        household_id,
        account_id,
        category_id,
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
        source,
        notes,
        metadata
    )
    values (
        target_household_id,
        obligation_account_id,
        debt_category_id,
        created_debt.debt_id,
        current_user_id,
        current_user_id,
        'expense',
        'planned',
        U&'D\00EDvida a pagar',
        trim(debt_creditor),
        obligation_amount,
        obligation_amount,
        coalesce(debt_start_date, current_date),
        coalesce(debt_due_date, debt_start_date, current_date),
        'manual',
        nullif(trim(obligation_notes), ''),
        jsonb_build_object(
            'origin', 'debt_obligation',
            'debt_group', target_debt_group,
            'debt_original_amount', debt_original_amount
        )
    )
    returning id into created_obligation_id;

    return query
    select created_debt.debt_id::uuid, created_obligation_id;
end;
$$;

revoke all on function public.pf_create_debt_obligation_v1(
    uuid, uuid, text, text, numeric, text, date, date, numeric,
    boolean, boolean, numeric, text, text, text
) from public, anon;

grant execute on function public.pf_create_debt_obligation_v1(
    uuid, uuid, text, text, numeric, text, date, date, numeric,
    boolean, boolean, numeric, text, text, text
) to authenticated;

-- =========================================================
-- PROMOVE UMA DESPESA A PAGAR DA CATEGORIA DE DIVIDA
-- PARA pf_debts SEM CRIAR UMA SEGUNDA OBRIGACAO.
-- =========================================================

create or replace function public.pf_promote_transaction_to_debt_v1(
    target_transaction_id uuid,
    target_debt_group text default 'other'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_transaction public.pf_transactions%rowtype;
    category_group_type text;
    created_debt record;
    creditor_name text;
    original_debt_amount numeric;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuario nao autenticado.';
    end if;

    if target_debt_group not in ('personal', 'other') then
        raise exception 'A classificacao da divida deve ser Pessoal ou Outras dividas.';
    end if;

    select *
    into selected_transaction
    from public.pf_transactions
    where id = target_transaction_id
    for update;

    if not found then
        raise exception 'Lancamento nao encontrado.';
    end if;

    if not public.pf_can_write(selected_transaction.household_id) then
        raise exception 'Seu acesso e somente leitura.';
    end if;

    if selected_transaction.debt_id is not null then
        return selected_transaction.debt_id;
    end if;

    if selected_transaction.type <> 'expense'
       or selected_transaction.status not in ('planned', 'overdue') then
        raise exception 'Somente despesas a pagar podem ser vinculadas como divida.';
    end if;

    select category.group_type
    into category_group_type
    from public.pf_categories category
    where category.id = selected_transaction.category_id
      and category.household_id = selected_transaction.household_id;

    if category_group_type is distinct from 'debt' then
        raise exception 'O lancamento precisa estar em uma categoria de divida.';
    end if;

    creditor_name := coalesce(
        nullif(trim(selected_transaction.merchant), ''),
        nullif(trim(selected_transaction.description), ''),
        'Credor'
    );

    original_debt_amount := coalesce(
        nullif(selected_transaction.original_amount, 0),
        selected_transaction.amount
    );

    select *
    into created_debt
    from public.pf_create_debt_with_initial_payment_v2(
        target_household_id => selected_transaction.household_id,
        debt_creditor => creditor_name,
        debt_description => coalesce(
            nullif(trim(selected_transaction.description), ''),
            U&'D\00EDvida com ' || creditor_name
        ),
        debt_original_amount => original_debt_amount,
        target_debt_group => target_debt_group,
        debt_start_date => selected_transaction.occurred_on,
        debt_due_date => coalesce(selected_transaction.due_date, selected_transaction.occurred_on),
        debt_installment_amount => null,
        debt_total_installments => null,
        debt_interest_enabled => false,
        debt_auto_accrue_interest => false,
        debt_interest_rate => 0,
        debt_interest_period => 'monthly',
        debt_interest_method => 'simple',
        debt_penalty_rate => 0,
        debt_daily_late_interest_rate => 0,
        debt_grace_period_days => 0,
        debt_responsible_user_id => selected_transaction.responsible_user_id,
        debt_visibility_scope => 'family',
        initial_payment_amount => 0,
        initial_payment_account_id => null,
        initial_payment_date => selected_transaction.occurred_on,
        initial_payment_count_installment => false,
        initial_payment_notes => null
    );

    update public.pf_transactions
    set
        debt_id = created_debt.debt_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'origin', 'promoted_debt_obligation',
            'debt_group', target_debt_group,
            'promoted_at', now()
        ),
        updated_at = now()
    where id = selected_transaction.id;

    return created_debt.debt_id;
end;
$$;

revoke all on function public.pf_promote_transaction_to_debt_v1(uuid, text)
from public, anon;

grant execute on function public.pf_promote_transaction_to_debt_v1(uuid, text)
to authenticated;

-- Lista despesas a pagar de categorias de divida que ainda nao
-- possuem vinculo com pf_debts.
create or replace view public.pf_unlinked_debt_obligations
with (security_invoker = true)
as
select
    transaction.id,
    transaction.household_id,
    transaction.account_id,
    transaction.description,
    transaction.merchant,
    transaction.amount,
    transaction.original_amount,
    transaction.occurred_on,
    transaction.due_date,
    transaction.status
from public.pf_transactions transaction
join public.pf_categories category
  on category.id = transaction.category_id
 and category.household_id = transaction.household_id
where transaction.type = 'expense'
  and transaction.status in ('planned', 'overdue')
  and transaction.debt_id is null
  and category.kind = 'expense'
  and category.group_type = 'debt';

revoke all on public.pf_unlinked_debt_obligations from public, anon;
grant select on public.pf_unlinked_debt_obligations to authenticated;

commit;

notify pgrst, 'reload schema';
