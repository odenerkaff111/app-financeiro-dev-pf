begin;

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

    if not public.pf_is_member(selected_debt.household_id) then
        raise exception 'Você não possui acesso a esta dívida.';
    end if;

    if selected_debt.status in ('paid', 'cancelled') then
        raise exception 'Esta dívida não aceita novos pagamentos.';
    end if;

    if payment_amount > selected_debt.current_balance then
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
        raise exception 'Conta de pagamento não encontrada ou inativa.';
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
        coalesce(payment_date, current_date),
        coalesce(payment_date, current_date),
        (
            coalesce(payment_date, current_date)::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        'manual',
        nullif(trim(payment_notes), ''),
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
        coalesce(payment_date, current_date),
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

revoke all
on function public.pf_register_debt_payment(
    uuid,
    uuid,
    numeric,
    date,
    boolean,
    text
)
from public;

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

commit;

notify pgrst, 'reload schema';