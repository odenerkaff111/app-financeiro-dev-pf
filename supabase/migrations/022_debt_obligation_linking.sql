begin;

-- =========================================================
-- DÍVIDA + OBRIGAÇÃO FINANCEIRA VINCULADAS
-- Uma dívida precisa existir em pf_debts e, quando houver
-- valor a vencer, também aparecer em "A pagar". A ligação
-- é feita por pf_transactions.debt_id para evitar duplicidade.
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
        raise exception 'Usuário não autenticado.';
    end if;

    if not public.pf_can_write(target_household_id) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    if target_debt_group not in ('personal', 'other') then
        raise exception 'A classificação da dívida deve ser Pessoal ou Outras dívidas.';
    end if;

    if nullif(trim(debt_creditor), '') is null then
        raise exception 'Informe o credor.';
    end if;

    if debt_original_amount is null or debt_original_amount <= 0 then
        raise exception 'O valor da dívida precisa ser maior que zero.';
    end if;

    select *
    into selected_account
    from public.pf_accounts
    where id = obligation_account_id
      and household_id = target_household_id
      and is_active = true;

    if not found then
        raise exception 'Selecione uma conta ativa para a obrigação.';
    end if;

    select category.id
    into debt_category_id
    from public.pf_categories category
    where category.household_id = target_household_id
      and category.kind = 'expense'
      and category.name = 'Dívidas'
    limit 1;

    if debt_category_id is null then
        raise exception 'Categoria Dívidas não encontrada para o grupo familiar.';
    end if;

    select *
    into created_debt
    from public.pf_create_debt_with_initial_payment_v2(
        target_household_id => target_household_id,
        debt_creditor => trim(debt_creditor),
        debt_description => coalesce(
            nullif(trim(debt_description), ''),
            'Dívida com ' || trim(debt_creditor)
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
        'Dívida a pagar',
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
-- PROMOVE UM LANÇAMENTO ANTIGO DE "A PAGAR" PARA DÍVIDA
-- SEM CRIAR UMA SEGUNDA OBRIGAÇÃO.
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
    category_name text;
    created_debt record;
    creditor_name text;
    original_debt_amount numeric;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if target_debt_group not in ('personal', 'other') then
        raise exception 'A classificação da dívida deve ser Pessoal ou Outras dívidas.';
    end if;

    select *
    into selected_transaction
    from public.pf_transactions
    where id = target_transaction_id
    for update;

    if not found then
        raise exception 'Lançamento não encontrado.';
    end if;

    if not public.pf_can_write(selected_transaction.household_id) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    if selected_transaction.debt_id is not null then
        return selected_transaction.debt_id;
    end if;

    if selected_transaction.type <> 'expense'
       or selected_transaction.status not in ('planned', 'overdue') then
        raise exception 'Somente despesas a pagar podem ser vinculadas como dívida.';
    end if;

    select category.name
    into category_name
    from public.pf_categories category
    where category.id = selected_transaction.category_id
      and category.household_id = selected_transaction.household_id;

    if category_name is distinct from 'Dívidas' then
        raise exception 'O lançamento precisa estar na categoria Dívidas.';
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
            'Dívida com ' || creditor_name
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

-- Lista apenas lançamentos que parecem dívida, estão em A pagar,
-- mas ainda não possuem vínculo com pf_debts.
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
  and category.name = 'Dívidas';

revoke all on public.pf_unlinked_debt_obligations from public, anon;
grant select on public.pf_unlinked_debt_obligations to authenticated;

-- =========================================================
-- QUANDO UM PAGAMENTO DE DÍVIDA É REGISTRADO, REDUZ OU
-- ENCERRA A OBRIGAÇÃO VINCULADA. O pagamento real continua
-- sendo a única saída realizada; a obrigação não vira uma
-- segunda despesa paga.
-- =========================================================

create or replace function public.pf_reconcile_debt_obligation_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    remaining_payment numeric;
    obligation record;
begin
    if new.type <> 'debt_payment'
       or new.status <> 'paid'
       or new.debt_id is null then
        return new;
    end if;

    remaining_payment := new.amount;

    for obligation in
        select
            transaction.id,
            transaction.amount,
            transaction.original_amount,
            transaction.metadata
        from public.pf_transactions transaction
        where transaction.household_id = new.household_id
          and transaction.debt_id = new.debt_id
          and transaction.type = 'expense'
          and transaction.status in ('planned', 'overdue')
          and coalesce(transaction.metadata ->> 'origin', '') in (
              'debt_obligation',
              'promoted_debt_obligation'
          )
        order by transaction.due_date asc nulls last, transaction.created_at asc
        for update
    loop
        exit when remaining_payment <= 0.005;

        if remaining_payment + 0.005 >= obligation.amount then
            update public.pf_transactions
            set
                status = 'cancelled',
                metadata = coalesce(obligation.metadata, '{}'::jsonb)
                    || jsonb_build_object(
                        'settled_by_debt_payment', new.id,
                        'settled_at', now()
                    ),
                updated_at = now()
            where id = obligation.id;

            remaining_payment := greatest(remaining_payment - obligation.amount, 0);
        else
            update public.pf_transactions
            set
                original_amount = coalesce(original_amount, obligation.amount),
                amount = round(obligation.amount - remaining_payment, 2),
                metadata = coalesce(obligation.metadata, '{}'::jsonb)
                    || jsonb_build_object(
                        'partially_settled_by_debt_payment', new.id,
                        'partial_settlement_at', now()
                    ),
                updated_at = now()
            where id = obligation.id;

            remaining_payment := 0;
        end if;
    end loop;

    return new;
end;
$$;

drop trigger if exists pf_reconcile_debt_obligation_payment_trigger
on public.pf_transactions;

create trigger pf_reconcile_debt_obligation_payment_trigger
after insert on public.pf_transactions
for each row
when (new.type = 'debt_payment' and new.debt_id is not null)
execute function public.pf_reconcile_debt_obligation_after_payment();

commit;

notify pgrst, 'reload schema';
