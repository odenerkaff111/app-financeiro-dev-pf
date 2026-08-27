begin;

-- Normaliza pagamentos de dívida para que a movimentação financeira tenha
-- descrição, contraparte e categoria consistentes em qualquer origem
-- (assistente, tela de dívidas ou cadastro unificado). O tipo interno
-- continua 'debt_payment' porque o motor financeiro usa essa semântica.

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
    selected_position record;
    effective_payment_date date;
    created_transaction_id uuid;
    capitalized_interest numeric := 0;
    capitalized_penalty numeric := 0;
    debt_category_id uuid;
begin
    current_user_id := auth.uid();
    effective_payment_date := coalesce(payment_date, current_date);

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    if payment_amount is null or payment_amount <= 0 then
        raise exception 'O valor do pagamento precisa ser maior que zero.';
    end if;

    select *
    into selected_debt
    from public.pf_debts
    where id = target_debt_id
    for update;

    if not found then
        raise exception 'Dívida não encontrada.';
    end if;

    if not public.pf_can_write(selected_debt.household_id) then
        raise exception 'Seu acesso é somente leitura.';
    end if;

    if selected_debt.status in ('paid', 'cancelled') then
        raise exception 'Esta dívida não aceita novos pagamentos.';
    end if;

    select *
    into selected_position
    from public.pf_calculate_debt_position(
        selected_debt.id,
        effective_payment_date
    );

    if payment_amount > selected_position.projected_balance + 0.005 then
        raise exception
            'O pagamento não pode ser maior que o saldo atualizado de %.',
            selected_position.projected_balance;
    end if;

    select *
    into selected_account
    from public.pf_accounts
    where id = target_account_id
      and household_id = selected_debt.household_id
      and is_active = true;

    if not found then
        raise exception 'Conta de pagamento não encontrada ou inativa.';
    end if;

    capitalized_interest := round(
        greatest(
            coalesce(selected_position.accrued_interest, 0)
            + coalesce(selected_position.projected_late_interest, 0),
            0
        ),
        2
    );

    capitalized_penalty := round(
        greatest(
            coalesce(selected_position.projected_penalty, 0),
            0
        ),
        2
    );

    if capitalized_interest > 0.005 then
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
            selected_debt.household_id,
            selected_debt.id,
            'interest',
            capitalized_interest,
            effective_payment_date,
            'Juros capitalizados automaticamente até o pagamento',
            current_user_id
        );
    end if;

    if capitalized_penalty > 0.005 then
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
            selected_debt.household_id,
            selected_debt.id,
            'fee',
            capitalized_penalty,
            effective_payment_date,
            'Multa capitalizada automaticamente no pagamento',
            current_user_id
        );
    end if;

    select category.id
    into debt_category_id
    from public.pf_categories as category
    where category.household_id = selected_debt.household_id
      and category.kind = 'expense'
      and category.name = 'Dívidas'
    limit 1;

    if debt_category_id is null then
        raise exception 'Categoria Dívidas não encontrada para o grupo familiar.';
    end if;

    if capitalized_interest > 0.005
       or capitalized_penalty > 0.005 then
        update public.pf_debts
        set
            interest_accrued_through = case
                when capitalized_interest > 0.005
                    then effective_payment_date
                else interest_accrued_through
            end,
            penalty_applied = penalty_applied
                or capitalized_penalty > 0.005,
            updated_at = now()
        where id = selected_debt.id;
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
        paid_at,
        source,
        notes,
        metadata
    )
    values (
        selected_debt.household_id,
        target_account_id,
        debt_category_id,
        selected_debt.id,
        current_user_id,
        current_user_id,
        'debt_payment',
        'paid',
        'Pagamento de dívida',
        selected_debt.creditor,
        payment_amount,
        payment_amount,
        effective_payment_date,
        effective_payment_date,
        (
            effective_payment_date::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        'manual',
        nullif(trim(payment_notes), ''),
        jsonb_build_object(
            'origin',
            'debt_module',
            'count_installment',
            count_installment,
            'capitalized_interest',
            capitalized_interest,
            'capitalized_penalty',
            capitalized_penalty
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
        effective_payment_date,
        coalesce(
            nullif(trim(payment_notes), ''),
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


-- Corrige pagamentos já registrados antes desta migration.
update public.pf_transactions as transaction
set
    description = 'Pagamento de dívida',
    merchant = debt.creditor,
    category_id = category.id
from public.pf_debts as debt
join public.pf_categories as category
  on category.household_id = debt.household_id
 and category.kind = 'expense'
 and category.name = 'Dívidas'
where transaction.type = 'debt_payment'
  and transaction.debt_id = debt.id
  and transaction.household_id = debt.household_id;

commit;
