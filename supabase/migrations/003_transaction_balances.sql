begin;

-- =========================================================
-- VALIDA OS VÍNCULOS DA MOVIMENTAÇÃO
-- =========================================================

create or replace function public.pf_validate_transaction_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1
        from public.pf_accounts
        where id = new.account_id
          and household_id = new.household_id
    ) then
        raise exception 'A conta de origem não pertence ao grupo familiar informado.';
    end if;

    if new.destination_account_id is not null
       and not exists (
           select 1
           from public.pf_accounts
           where id = new.destination_account_id
             and household_id = new.household_id
       ) then
        raise exception 'A conta de destino não pertence ao grupo familiar informado.';
    end if;

    if new.category_id is not null
       and not exists (
           select 1
           from public.pf_categories
           where id = new.category_id
             and household_id = new.household_id
       ) then
        raise exception 'A categoria não pertence ao grupo familiar informado.';
    end if;

    if new.debt_id is not null
       and not exists (
           select 1
           from public.pf_debts
           where id = new.debt_id
             and household_id = new.household_id
       ) then
        raise exception 'A dívida não pertence ao grupo familiar informado.';
    end if;

    if new.type in (
        'transfer',
        'investment_contribution',
        'investment_withdrawal'
    ) then
        if new.destination_account_id is null then
            raise exception 'Essa movimentação exige uma conta de destino.';
        end if;

        if new.destination_account_id = new.account_id then
            raise exception 'A conta de origem e a conta de destino precisam ser diferentes.';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists pf_validate_transaction_links_trigger
on public.pf_transactions;

create trigger pf_validate_transaction_links_trigger
before insert or update
on public.pf_transactions
for each row
execute function public.pf_validate_transaction_links();

-- =========================================================
-- AJUSTA O SALDO DE UMA CONTA
--
-- Contas normais:
--   delta positivo aumenta o saldo
--   delta negativo diminui o saldo
--
-- Cartão:
--   a coluna balance representa a fatura atual
--   uma despesa aumenta a fatura
--   um pagamento diminui a fatura
-- =========================================================

create or replace function public.pf_adjust_account_balance(
    target_household_id uuid,
    target_account_id uuid,
    asset_delta numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if target_account_id is null
       or asset_delta is null
       or asset_delta = 0 then
        return;
    end if;

    update public.pf_accounts
    set
        balance = balance
            + case
                when type = 'credit_card'
                    then -asset_delta
                else asset_delta
              end,
        balance_updated_at = now(),
        updated_at = now()
    where id = target_account_id
      and household_id = target_household_id;
end;
$$;

-- =========================================================
-- APLICA OU REVERTE O EFEITO DE UMA MOVIMENTAÇÃO
--
-- multiplier:
--   1  = aplicar
--  -1  = reverter
-- =========================================================

create or replace function public.pf_apply_transaction_effect(
    target_household_id uuid,
    source_account_id uuid,
    target_destination_account_id uuid,
    transaction_type text,
    transaction_status text,
    transaction_amount numeric,
    transaction_source text,
    transaction_metadata jsonb,
    multiplier numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    skip_balance_update boolean;
begin
    skip_balance_update :=
        coalesce(
            transaction_metadata ->> 'skip_balance_update',
            'false'
        ) = 'true';

    if transaction_status <> 'paid' then
        return;
    end if;

    -- Transações do Open Finance não alteram o saldo porque
    -- o saldo real será sincronizado diretamente da instituição.
    if transaction_source in ('open_finance', 'import')
       or skip_balance_update then
        return;
    end if;

    case transaction_type
        when 'income' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                transaction_amount * multiplier
            );

        when 'debt_received' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                transaction_amount * multiplier
            );

        when 'expense' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

        when 'debt_payment' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

        when 'transfer' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

            perform public.pf_adjust_account_balance(
                target_household_id,
                target_destination_account_id,
                transaction_amount * multiplier
            );

        when 'investment_contribution' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

            perform public.pf_adjust_account_balance(
                target_household_id,
                target_destination_account_id,
                transaction_amount * multiplier
            );

        when 'investment_withdrawal' then
            perform public.pf_adjust_account_balance(
                target_household_id,
                source_account_id,
                -transaction_amount * multiplier
            );

            perform public.pf_adjust_account_balance(
                target_household_id,
                target_destination_account_id,
                transaction_amount * multiplier
            );

        when 'adjustment' then
            if coalesce(
                transaction_metadata ->> 'direction',
                'increase'
            ) = 'decrease' then
                perform public.pf_adjust_account_balance(
                    target_household_id,
                    source_account_id,
                    -transaction_amount * multiplier
                );
            else
                perform public.pf_adjust_account_balance(
                    target_household_id,
                    source_account_id,
                    transaction_amount * multiplier
                );
            end if;

        else
            return;
    end case;
end;
$$;

-- =========================================================
-- TRIGGER DE SALDOS
-- =========================================================

create or replace function public.pf_after_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        perform public.pf_apply_transaction_effect(
            new.household_id,
            new.account_id,
            new.destination_account_id,
            new.type,
            new.status,
            new.amount,
            new.source,
            new.metadata,
            1
        );

        return new;
    end if;

    if tg_op = 'UPDATE' then
        perform public.pf_apply_transaction_effect(
            old.household_id,
            old.account_id,
            old.destination_account_id,
            old.type,
            old.status,
            old.amount,
            old.source,
            old.metadata,
            -1
        );

        perform public.pf_apply_transaction_effect(
            new.household_id,
            new.account_id,
            new.destination_account_id,
            new.type,
            new.status,
            new.amount,
            new.source,
            new.metadata,
            1
        );

        return new;
    end if;

    if tg_op = 'DELETE' then
        perform public.pf_apply_transaction_effect(
            old.household_id,
            old.account_id,
            old.destination_account_id,
            old.type,
            old.status,
            old.amount,
            old.source,
            old.metadata,
            -1
        );

        return old;
    end if;

    return null;
end;
$$;

drop trigger if exists pf_after_transaction_change_trigger
on public.pf_transactions;

create trigger pf_after_transaction_change_trigger
after insert or update or delete
on public.pf_transactions
for each row
execute function public.pf_after_transaction_change();

commit;

notify pgrst, 'reload schema';