begin;

-- =========================================================
-- AJUSTE / ACORDO DE DIVIDA
-- Preserva o valor original e registra a diferenca como
-- desconto ou acrescimo no historico da divida.
-- ASCII-only para evitar problemas de encoding no PowerShell.
-- =========================================================

create or replace function public.pf_adjust_other_debt_balance_v1(
    target_debt_id uuid,
    target_balance numeric,
    adjustment_date date default current_date,
    adjustment_due_date date default null,
    adjustment_notes text default null,
    freeze_interest boolean default true,
    settlement_is_full_payoff boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    selected_debt public.pf_debts%rowtype;
    ledger_balance numeric := 0;
    adjustment_amount numeric := 0;
    next_obligation numeric := 0;
begin
    if auth.uid() is null then
        raise exception 'Usuario nao autenticado.';
    end if;

    select *
    into selected_debt
    from public.pf_debts
    where id = target_debt_id
    for update;

    if not found then
        raise exception 'Divida nao encontrada.';
    end if;

    if selected_debt.debt_group <> 'other' then
        raise exception 'Este ajuste esta disponivel apenas para Outras dividas.';
    end if;

    if not public.pf_can_write(selected_debt.household_id) then
        raise exception 'Seu acesso e somente leitura.';
    end if;

    if target_balance is null or target_balance <= 0 then
        raise exception 'Informe um novo saldo maior que zero.';
    end if;

    select coalesce(
        sum(
            case
                when movement.movement_type in ('principal', 'interest', 'fee')
                    then movement.amount
                when movement.movement_type in ('payment', 'discount')
                    then -movement.amount
                else 0
            end
        ),
        selected_debt.current_balance,
        selected_debt.original_amount,
        0
    )
    into ledger_balance
    from public.pf_debt_movements movement
    where movement.debt_id = target_debt_id;

    if target_balance < ledger_balance - 0.005 then
        adjustment_amount := ledger_balance - target_balance;

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
            target_debt_id,
            'discount',
            adjustment_amount,
            coalesce(adjustment_date, current_date),
            coalesce(
                nullif(trim(adjustment_notes), ''),
                'Acordo / desconto registrado no saldo da divida'
            ),
            auth.uid()
        );
    elsif target_balance > ledger_balance + 0.005 then
        adjustment_amount := target_balance - ledger_balance;

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
            target_debt_id,
            'fee',
            adjustment_amount,
            coalesce(adjustment_date, current_date),
            coalesce(
                nullif(trim(adjustment_notes), ''),
                'Atualizacao de saldo registrada na divida'
            ),
            auth.uid()
        );
    end if;

    if coalesce(freeze_interest, true) then
        update public.pf_debts
        set
            interest_enabled = false,
            auto_accrue_interest = false,
            interest_rate = 0,
            monthly_interest_rate = 0,
            penalty_rate = 0,
            daily_late_interest_rate = 0,
            updated_at = now()
        where id = target_debt_id;
    end if;

    if adjustment_due_date is not null then
        update public.pf_debts
        set
            due_date = adjustment_due_date,
            updated_at = now()
        where id = target_debt_id;
    end if;

    perform public.pf_recalculate_debt_balance(target_debt_id);

    if coalesce(settlement_is_full_payoff, true) then
        next_obligation := target_balance;
    elsif coalesce(selected_debt.installment_amount, 0) > 0 then
        next_obligation := least(selected_debt.installment_amount, target_balance);
    else
        next_obligation := target_balance;
    end if;

    update public.pf_transactions
    set
        amount = next_obligation,
        original_amount = next_obligation,
        due_date = coalesce(adjustment_due_date, due_date),
        status = case
            when status = 'cancelled' then status
            when due_date is not null and coalesce(adjustment_due_date, due_date) < current_date
                then 'overdue'
            else 'planned'
        end,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'debt_balance_adjustment', target_balance,
            'debt_adjusted_at', now(),
            'settlement_is_full_payoff', coalesce(settlement_is_full_payoff, true)
        )
    where debt_id = target_debt_id
      and type = 'expense'
      and status in ('planned', 'overdue');
end;
$$;

revoke all on function public.pf_adjust_other_debt_balance_v1(
    uuid, numeric, date, date, text, boolean, boolean
) from public, anon;

grant execute on function public.pf_adjust_other_debt_balance_v1(
    uuid, numeric, date, date, text, boolean, boolean
) to authenticated;

commit;

notify pgrst, 'reload schema';
