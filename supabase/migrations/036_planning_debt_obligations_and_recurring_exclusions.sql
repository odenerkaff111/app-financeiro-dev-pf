begin;

-- =========================================================
-- 1. PLANEJAMENTOS COM NOME E VINCULO EXPLICITO
-- =========================================================

alter table public.pf_budgets
    add column if not exists name text;

update public.pf_budgets budget
set name = category.name
from public.pf_categories category
where category.id = budget.category_id
  and (
      budget.name is null
      or btrim(budget.name) = ''
  );

alter table public.pf_budgets
    alter column name set not null;

alter table public.pf_budgets
    drop constraint if exists pf_budgets_household_id_category_id_month_key;

drop index if exists public.pf_budgets_household_category_month_name_unique;

create unique index pf_budgets_household_category_month_name_unique
    on public.pf_budgets (
        household_id,
        category_id,
        month,
        name
    );

alter table public.pf_transactions
    add column if not exists budget_id uuid
        references public.pf_budgets(id)
        on delete set null;

create index if not exists pf_transactions_budget_id_idx
    on public.pf_transactions (budget_id);

-- =========================================================
-- 2. PARCELA DE DIVIDA PODE SER ENCERRADA COM PAGAMENTO PARCIAL
--
-- Se count_installment=true, a obrigacao mensal e encerrada mesmo
-- quando o valor pago for menor que o valor previsto. A diferenca
-- permanece somente no saldo total da divida e NAO e somada a
-- parcela do mes seguinte.
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
    closes_installment boolean;
begin
    if new.type <> 'debt_payment'
       or new.status <> 'paid'
       or new.debt_id is null then
        return new;
    end if;

    closes_installment := coalesce(
        new.metadata ->> 'count_installment',
        'false'
    ) = 'true';

    remaining_payment := new.amount;

    for obligation in
        select
            transaction.id,
            transaction.amount,
            transaction.original_amount,
            transaction.metadata,
            transaction.due_date
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

        if closes_installment then
            update public.pf_transactions
            set
                status = 'cancelled',
                metadata = coalesce(obligation.metadata, '{}'::jsonb)
                    || jsonb_build_object(
                        'settled_by_debt_payment', new.id,
                        'settled_at', now(),
                        'scheduled_installment_amount', obligation.amount,
                        'actual_installment_payment', least(new.amount, obligation.amount),
                        'installment_shortfall_not_rolled_forward',
                            greatest(obligation.amount - new.amount, 0)
                    ),
                updated_at = now()
            where id = obligation.id;

            remaining_payment := 0;
        elsif remaining_payment + 0.005 >= obligation.amount then
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

-- Gera a parcela seguinte somente depois de o movimento da divida
-- existir, garantindo que o saldo projetado ja considere o pagamento.
create or replace function public.pf_create_next_debt_installment_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    payment_transaction public.pf_transactions%rowtype;
    selected_debt public.pf_debts%rowtype;
    previous_due_date date;
    next_due_date date;
    projected_balance numeric := 0;
    next_amount numeric := 0;
    debt_category_id uuid;
    closes_installment boolean;
begin
    if new.movement_type <> 'payment'
       or new.transaction_id is null then
        return new;
    end if;

    select *
    into payment_transaction
    from public.pf_transactions
    where id = new.transaction_id;

    if not found or payment_transaction.type <> 'debt_payment' then
        return new;
    end if;

    closes_installment := coalesce(
        payment_transaction.metadata ->> 'count_installment',
        'false'
    ) = 'true';

    if not closes_installment then
        return new;
    end if;

    select *
    into selected_debt
    from public.pf_debts
    where id = new.debt_id;

    if not found
       or selected_debt.installment_amount is null
       or selected_debt.installment_amount <= 0
       or selected_debt.status in ('paid', 'cancelled') then
        return new;
    end if;

    if selected_debt.total_installments is not null
       and selected_debt.paid_installments + 1 >= selected_debt.total_installments then
        return new;
    end if;

    select transaction.due_date
    into previous_due_date
    from public.pf_transactions transaction
    where transaction.debt_id = selected_debt.id
      and transaction.status = 'cancelled'
      and transaction.metadata ->> 'settled_by_debt_payment' = payment_transaction.id::text
    order by transaction.due_date desc nulls last
    limit 1;

    next_due_date := (
        coalesce(previous_due_date, new.occurred_on)
        + interval '1 month'
    )::date;

    select position.projected_balance
    into projected_balance
    from public.pf_calculate_debt_position(
        selected_debt.id,
        new.occurred_on
    ) position;

    projected_balance := greatest(coalesce(projected_balance, 0), 0);

    if projected_balance <= 0.005 then
        return new;
    end if;

    next_amount := least(selected_debt.installment_amount, projected_balance);

    select category.id
    into debt_category_id
    from public.pf_categories category
    where category.household_id = selected_debt.household_id
      and category.kind = 'expense'
      and category.group_type = 'debt'
    order by category.is_system desc, category.created_at asc
    limit 1;

    if exists (
        select 1
        from public.pf_transactions transaction
        where transaction.debt_id = selected_debt.id
          and transaction.type = 'expense'
          and transaction.status in ('planned', 'overdue')
          and transaction.due_date = next_due_date
          and coalesce(transaction.metadata ->> 'origin', '') = 'debt_obligation'
    ) then
        return new;
    end if;

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
        selected_debt.household_id,
        null,
        debt_category_id,
        selected_debt.id,
        payment_transaction.created_by,
        payment_transaction.responsible_user_id,
        'expense',
        'planned',
        'Parcela da divida',
        selected_debt.creditor,
        next_amount,
        next_amount,
        new.occurred_on,
        next_due_date,
        'manual',
        null,
        jsonb_build_object(
            'origin', 'debt_obligation',
            'debt_group', selected_debt.debt_group,
            'generated_after_payment', payment_transaction.id,
            'previous_installment_due_date', previous_due_date,
            'previous_actual_payment', payment_transaction.amount
        )
    );

    return new;
end;
$$;

drop trigger if exists pf_create_next_debt_installment_payment_trigger
on public.pf_debt_movements;

create trigger pf_create_next_debt_installment_payment_trigger
after insert on public.pf_debt_movements
for each row
when (new.movement_type = 'payment' and new.transaction_id is not null)
execute function public.pf_create_next_debt_installment_after_payment();

commit;

notify pgrst, 'reload schema';
