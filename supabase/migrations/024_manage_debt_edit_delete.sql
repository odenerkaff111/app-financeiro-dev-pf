begin;

-- =========================================================
-- GERENCIAMENTO SEGURO DE DIVIDAS
-- ASCII-only para evitar problemas de encoding no PowerShell.
-- =========================================================

create or replace function public.pf_update_debt_v1(
    target_debt_id uuid,
    debt_creditor text,
    debt_description text,
    debt_original_amount numeric,
    debt_start_date date,
    debt_due_date date,
    debt_installment_amount numeric default null,
    debt_interest_enabled boolean default false,
    debt_auto_accrue_interest boolean default false,
    debt_interest_rate numeric default 0,
    debt_interest_period text default 'monthly',
    debt_interest_method text default 'simple'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    selected_debt public.pf_debts%rowtype;
    paid_total numeric := 0;
    remaining_principal numeric := 0;
    obligation_amount numeric := 0;
    principal_movement_id uuid;
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

    if not public.pf_can_write(selected_debt.household_id) then
        raise exception 'Seu acesso e somente leitura.';
    end if;

    if nullif(trim(debt_creditor), '') is null then
        raise exception 'Informe o credor.';
    end if;

    if debt_original_amount is null or debt_original_amount <= 0 then
        raise exception 'O valor da divida precisa ser maior que zero.';
    end if;

    if debt_installment_amount is not null and debt_installment_amount <= 0 then
        raise exception 'A mensalidade precisa ser maior que zero.';
    end if;

    if debt_interest_period not in ('daily', 'monthly', 'yearly') then
        raise exception 'Periodo de juros invalido.';
    end if;

    if debt_interest_method not in ('simple', 'compound') then
        raise exception 'Metodo de juros invalido.';
    end if;

    select coalesce(sum(movement.amount), 0)
    into paid_total
    from public.pf_debt_movements movement
    where movement.debt_id = target_debt_id
      and movement.movement_type = 'payment';

    if debt_original_amount + 0.005 < paid_total then
        raise exception 'O valor total nao pode ser menor que o total ja pago.';
    end if;

    update public.pf_debts
    set
        creditor = trim(debt_creditor),
        description = coalesce(nullif(trim(debt_description), ''), 'Divida com ' || trim(debt_creditor)),
        original_amount = debt_original_amount,
        installment_amount = case
            when coalesce(debt_installment_amount, 0) > 0 then debt_installment_amount
            else null
        end,
        start_date = coalesce(debt_start_date, start_date, current_date),
        due_date = debt_due_date,
        interest_enabled = coalesce(debt_interest_enabled, false),
        auto_accrue_interest = coalesce(debt_interest_enabled, false)
            and coalesce(debt_auto_accrue_interest, false),
        interest_rate = case
            when coalesce(debt_interest_enabled, false) then coalesce(debt_interest_rate, 0)
            else 0
        end,
        interest_period = coalesce(nullif(debt_interest_period, ''), 'monthly'),
        interest_method = coalesce(nullif(debt_interest_method, ''), 'simple'),
        updated_at = now()
    where id = target_debt_id;

    select movement.id
    into principal_movement_id
    from public.pf_debt_movements movement
    where movement.debt_id = target_debt_id
      and movement.movement_type = 'principal'
    order by movement.created_at asc, movement.id asc
    limit 1;

    if principal_movement_id is null then
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
            'principal',
            debt_original_amount,
            coalesce(debt_start_date, current_date),
            'Valor inicial da divida',
            auth.uid()
        );
    else
        update public.pf_debt_movements
        set
            amount = debt_original_amount,
            occurred_on = coalesce(debt_start_date, occurred_on)
        where id = principal_movement_id;
    end if;

    remaining_principal := greatest(debt_original_amount - paid_total, 0);

    obligation_amount := case
        when coalesce(debt_installment_amount, 0) > 0
            then least(debt_installment_amount, remaining_principal)
        else remaining_principal
    end;

    update public.pf_transactions
    set
        merchant = trim(debt_creditor),
        amount = greatest(obligation_amount, 0.01),
        original_amount = greatest(obligation_amount, 0.01),
        occurred_on = coalesce(debt_start_date, occurred_on),
        due_date = debt_due_date,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'debt_original_amount', debt_original_amount,
            'managed_from_debt', true
        )
    where debt_id = target_debt_id
      and type = 'expense'
      and status in ('planned', 'overdue')
      and obligation_amount > 0;

    if obligation_amount <= 0 then
        update public.pf_transactions
        set
            status = 'cancelled',
            updated_at = now()
        where debt_id = target_debt_id
          and type = 'expense'
          and status in ('planned', 'overdue');
    end if;
end;
$$;

revoke all on function public.pf_update_debt_v1(
    uuid, text, text, numeric, date, date, numeric,
    boolean, boolean, numeric, text, text
) from public, anon;

grant execute on function public.pf_update_debt_v1(
    uuid, text, text, numeric, date, date, numeric,
    boolean, boolean, numeric, text, text
) to authenticated;

create or replace function public.pf_delete_debt_v1(
    target_debt_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    selected_debt public.pf_debts%rowtype;
    has_financial_history boolean := false;
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

    if not public.pf_can_write(selected_debt.household_id) then
        raise exception 'Seu acesso e somente leitura.';
    end if;

    select exists (
        select 1
        from public.pf_debt_movements movement
        where movement.debt_id = target_debt_id
          and movement.movement_type in ('payment', 'interest', 'fee', 'discount')
    ) or exists (
        select 1
        from public.pf_transactions transaction
        where transaction.debt_id = target_debt_id
          and transaction.type = 'debt_payment'
          and transaction.status <> 'cancelled'
    )
    into has_financial_history;

    if has_financial_history then
        raise exception 'Esta divida ja possui pagamentos ou historico financeiro e nao pode ser excluida. Use o fluxo de quitacao/cancelamento.';
    end if;

    -- Se a obrigacao nasceu junto com a divida, ela deve desaparecer junto.
    delete from public.pf_transactions transaction
    where transaction.debt_id = target_debt_id
      and transaction.type = 'expense'
      and coalesce(transaction.metadata ->> 'origin', '') = 'debt_obligation';

    -- Se uma despesa antiga foi apenas promovida para divida, preserva A pagar
    -- e remove somente o vinculo de divida.
    update public.pf_transactions transaction
    set
        debt_id = null,
        updated_at = now(),
        metadata = (coalesce(transaction.metadata, '{}'::jsonb)
            - 'debt_group'
            - 'promoted_at') || jsonb_build_object('origin', 'unified_entry')
    where transaction.debt_id = target_debt_id
      and transaction.type = 'expense'
      and coalesce(transaction.metadata ->> 'origin', '') = 'promoted_debt_obligation';

    -- Qualquer outro lancamento planejado vinculado e apenas desvinculado.
    update public.pf_transactions transaction
    set
        debt_id = null,
        updated_at = now()
    where transaction.debt_id = target_debt_id;

    -- pf_debt_movements possui ON DELETE CASCADE.
    delete from public.pf_debts
    where id = target_debt_id;
end;
$$;

revoke all on function public.pf_delete_debt_v1(uuid)
from public, anon;

grant execute on function public.pf_delete_debt_v1(uuid)
to authenticated;

commit;

notify pgrst, 'reload schema';
