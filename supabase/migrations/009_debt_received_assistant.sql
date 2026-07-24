begin;

alter table public.pf_ai_messages
    drop constraint if exists pf_ai_messages_action_type_check;

alter table public.pf_ai_messages
    add constraint pf_ai_messages_action_type_check
    check (
        action_type is null
        or action_type in (
            'create_transaction',
            'create_transfer',
            'register_debt_payment',
            'register_debt_received',
            'register_variable_recurring',
            'import_statement'
        )
    );

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
        raise exception 'O valor recebido precisa ser maior que zero.';
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

    if selected_debt.status = 'cancelled' then
        raise exception 'Esta dívida está cancelada.';
    end if;

    select *
    into selected_account
    from public.pf_accounts
    where id = target_account_id
      and household_id = selected_debt.household_id
      and is_active = true;

    if not found then
        raise exception 'Conta de recebimento não encontrada ou inativa.';
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
        coalesce(received_date, current_date),
        coalesce(received_date, current_date),
        (
            coalesce(received_date, current_date)::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        'ai',
        nullif(trim(received_notes), ''),
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
        coalesce(received_date, current_date),
        coalesce(
            nullif(trim(received_notes), ''),
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
                selected_debt.current_balance + received_amount
            )
        )::numeric(14, 2)
    into recalculated_balance
    from public.pf_debt_movements movement
    where movement.debt_id = selected_debt.id;

    update public.pf_debts
    set
        original_amount = original_amount + received_amount,
        current_balance = recalculated_balance,
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
from public;

grant execute
on function public.pf_register_debt_received(
    uuid,
    uuid,
    numeric,
    date,
    text
)
to authenticated;

commit;

notify pgrst, 'reload schema';
