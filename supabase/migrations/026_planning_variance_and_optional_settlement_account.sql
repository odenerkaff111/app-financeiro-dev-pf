begin;

-- A direct planned transaction can be settled without selecting a bank
-- account. This matches the simplified workflow where account tracking is
-- optional. Existing rows remain valid.
alter table public.pf_transaction_settlements
    alter column account_id drop not null;

-- A simple planned income/expense represents an estimate, not a contract.
-- When it is finally paid/received, the actual value may be lower or higher.
-- The settlement closes the estimate and creates one realized transaction
-- using the actual amount. Partial settlements remain available through the
-- commitment flow (pf_commitments).
create or replace function public.pf_register_pending_transaction_settlement(
    target_transaction_id uuid,
    target_account_id uuid,
    settlement_amount numeric,
    settlement_date date default current_date,
    settlement_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_transaction public.pf_transactions%rowtype;
    created_transaction_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuario nao autenticado.';
    end if;

    if settlement_amount is null or settlement_amount <= 0 then
        raise exception 'O valor precisa ser maior que zero.';
    end if;

    select *
    into selected_transaction
    from public.pf_transactions transaction
    where transaction.id = target_transaction_id
    for update;

    if not found then
        raise exception 'Movimentacao planejada nao encontrada.';
    end if;

    if not public.pf_can_write(selected_transaction.household_id) then
        raise exception 'Seu acesso e somente leitura.';
    end if;

    if selected_transaction.status not in ('planned', 'overdue') then
        raise exception 'A movimentacao nao esta pendente.';
    end if;

    if selected_transaction.type not in ('income', 'expense') then
        raise exception 'Somente receitas e despesas pendentes podem ser liquidadas por este fluxo.';
    end if;

    if target_account_id is not null and not exists (
        select 1
        from public.pf_accounts account
        where account.id = target_account_id
          and account.household_id = selected_transaction.household_id
          and account.is_active = true
    ) then
        raise exception 'Conta nao encontrada ou inativa.';
    end if;

    insert into public.pf_transactions (
        household_id,
        account_id,
        destination_account_id,
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
        is_essential,
        metadata
    )
    values (
        selected_transaction.household_id,
        target_account_id,
        null,
        selected_transaction.category_id,
        selected_transaction.debt_id,
        current_user_id,
        coalesce(selected_transaction.responsible_user_id, current_user_id),
        selected_transaction.type,
        'paid',
        case
            when selected_transaction.type = 'income' then 'Recebimento - '
            else 'Pagamento - '
        end || selected_transaction.description,
        selected_transaction.merchant,
        settlement_amount,
        selected_transaction.amount,
        coalesce(settlement_date, current_date),
        selected_transaction.due_date,
        (
            coalesce(settlement_date, current_date)::timestamp
            + time '12:00'
        ) at time zone 'America/Sao_Paulo',
        'manual',
        nullif(trim(settlement_notes), ''),
        selected_transaction.is_essential,
        jsonb_build_object(
            'origin', 'dashboard_obligation_settlement',
            'planned_transaction_id', selected_transaction.id,
            'final_settlement', true,
            'expected_amount', selected_transaction.amount,
            'actual_amount', settlement_amount,
            'variance_amount', settlement_amount - selected_transaction.amount
        )
    )
    returning id into created_transaction_id;

    insert into public.pf_transaction_settlements (
        household_id,
        planned_transaction_id,
        settlement_transaction_id,
        account_id,
        amount,
        settled_on,
        notes,
        created_by
    )
    values (
        selected_transaction.household_id,
        selected_transaction.id,
        created_transaction_id,
        target_account_id,
        settlement_amount,
        coalesce(settlement_date, current_date),
        nullif(trim(settlement_notes), ''),
        current_user_id
    );

    update public.pf_transactions
    set
        status = 'cancelled',
        metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object(
                'settlement_completed', true,
                'expected_amount', selected_transaction.amount,
                'actual_amount', settlement_amount,
                'variance_amount', settlement_amount - selected_transaction.amount,
                'last_settlement_transaction_id', created_transaction_id
            ),
        updated_at = now()
    where id = selected_transaction.id;

    return created_transaction_id;
end;
$$;

revoke all
on function public.pf_register_pending_transaction_settlement(
    uuid,
    uuid,
    numeric,
    date,
    text
)
from public, anon;

grant execute
on function public.pf_register_pending_transaction_settlement(
    uuid,
    uuid,
    numeric,
    date,
    text
)
to authenticated;

commit;

notify pgrst, 'reload schema';
