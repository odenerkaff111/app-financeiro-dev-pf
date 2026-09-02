begin;

-- Historical installments registered when a debt first enters Kyra.
-- They reduce the debt balance without creating cash movements in bank accounts.
alter table public.pf_debts
    add column if not exists baseline_paid_installments integer not null default 0,
    add column if not exists baseline_paid_amount numeric(14, 2) not null default 0;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'pf_debts_baseline_paid_installments_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_baseline_paid_installments_valid
            check (baseline_paid_installments >= 0);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'pf_debts_baseline_paid_amount_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_baseline_paid_amount_valid
            check (baseline_paid_amount >= 0);
    end if;
end;
$$;

-- Preserve the existing view contract and append baseline fields at the end.
create or replace view public.pf_debt_progress
with (security_invoker = true)
as
select
    debt.id,
    debt.household_id,
    debt.created_by,
    debt.creditor,
    debt.description,
    debt.type,
    debt.original_amount,
    debt.current_balance,
    debt.installment_amount,
    debt.total_installments,
    debt.paid_installments,
    case
        when debt.total_installments is null then null
        else greatest(debt.total_installments - debt.paid_installments, 0)
    end as remaining_installments,
    debt.monthly_interest_rate,
    debt.penalty_rate,
    debt.daily_late_interest_rate,
    debt.interest_free,
    debt.start_date,
    debt.due_date,
    debt.status,
    debt.linked_account_id,
    debt.import_key,
    debt.created_at,
    debt.updated_at,
    coalesce(movement_summary.paid_amount, 0) as paid_amount,
    coalesce(movement_summary.interest_amount, 0) as interest_amount,
    coalesce(movement_summary.fee_amount, 0) as fee_amount,
    coalesce(movement_summary.discount_amount, 0) as discount_amount,
    case
        when debt.original_amount <= 0 then 0
        else round(
            least(
                100,
                (coalesce(movement_summary.paid_amount, 0) / debt.original_amount) * 100
            ),
            2
        )
    end as progress_percentage,
    debt.debt_group,
    debt.debt_kind,
    debt.interest_enabled,
    debt.auto_accrue_interest,
    debt.interest_rate,
    debt.interest_period,
    debt.interest_method,
    debt.interest_start_date,
    debt.interest_accrued_through,
    debt.penalty_applied,
    debt.grace_period_days,
    position.ledger_balance,
    position.accrued_interest,
    position.projected_penalty,
    position.projected_late_interest,
    position.projected_balance,
    position.daily_growth,
    position.overdue_days,
    debt.baseline_paid_installments,
    debt.baseline_paid_amount
from public.pf_debts debt
left join lateral (
    select
        sum(movement.amount) filter (where movement.movement_type = 'payment') as paid_amount,
        sum(movement.amount) filter (where movement.movement_type = 'interest') as interest_amount,
        sum(movement.amount) filter (where movement.movement_type = 'fee') as fee_amount,
        sum(movement.amount) filter (where movement.movement_type = 'discount') as discount_amount
    from public.pf_debt_movements movement
    where movement.debt_id = debt.id
) movement_summary on true
cross join lateral public.pf_calculate_debt_position(debt.id, current_date) position;

revoke all on public.pf_debt_progress from public, anon;
grant select on public.pf_debt_progress to authenticated;

create or replace function public.pf_create_debt_obligation_v2(
    target_household_id uuid,
    debt_creditor text,
    debt_original_amount numeric,
    target_debt_group text default 'personal',
    debt_due_date date default current_date,
    debt_installment_amount numeric default null,
    debt_total_installments integer default null,
    debt_baseline_paid_installments integer default 0,
    debt_interest_enabled boolean default false,
    debt_auto_accrue_interest boolean default false,
    debt_interest_rate numeric default 0,
    debt_interest_period text default 'monthly',
    debt_interest_method text default 'simple'
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
    debt_category_id uuid;
    created_debt record;
    created_obligation_id uuid;
    historical_paid numeric := 0;
    remaining_balance numeric := 0;
    obligation_amount numeric := 0;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuario nao autenticado.';
    end if;

    if not public.pf_can_write(target_household_id) then
        raise exception 'Seu acesso e somente leitura.';
    end if;

    if target_debt_group not in ('personal', 'other') then
        raise exception 'Classificacao de divida invalida.';
    end if;

    if nullif(trim(debt_creditor), '') is null then
        raise exception 'Informe o credor.';
    end if;

    if debt_original_amount is null or debt_original_amount <= 0 then
        raise exception 'O valor total precisa ser maior que zero.';
    end if;

    if debt_installment_amount is not null and debt_installment_amount <= 0 then
        raise exception 'O valor da parcela precisa ser maior que zero.';
    end if;

    if debt_total_installments is not null and debt_total_installments <= 0 then
        raise exception 'O total de parcelas precisa ser maior que zero.';
    end if;

    if coalesce(debt_baseline_paid_installments, 0) < 0 then
        raise exception 'As parcelas pagas nao podem ser negativas.';
    end if;

    if debt_total_installments is not null
       and coalesce(debt_baseline_paid_installments, 0) > debt_total_installments then
        raise exception 'As parcelas pagas nao podem superar o total de parcelas.';
    end if;

    if debt_interest_period not in ('daily', 'monthly', 'yearly') then
        raise exception 'Periodo de juros invalido.';
    end if;

    if debt_interest_method not in ('simple', 'compound') then
        raise exception 'Metodo de juros invalido.';
    end if;

    if coalesce(debt_interest_rate, 0) < 0 then
        raise exception 'A taxa de juros nao pode ser negativa.';
    end if;

    historical_paid := case
        when coalesce(debt_baseline_paid_installments, 0) <= 0 then 0
        when coalesce(debt_installment_amount, 0) > 0 then
            least(
                debt_original_amount,
                round(debt_installment_amount * debt_baseline_paid_installments, 2)
            )
        when coalesce(debt_total_installments, 0) > 0 then
            least(
                debt_original_amount,
                round(
                    debt_original_amount
                    * debt_baseline_paid_installments::numeric
                    / debt_total_installments::numeric,
                    2
                )
            )
        else 0
    end;

    if coalesce(debt_baseline_paid_installments, 0) > 0 and historical_paid <= 0 then
        raise exception 'Informe o valor da parcela ou o total de parcelas para registrar o historico.';
    end if;

    if historical_paid >= debt_original_amount - 0.005 then
        raise exception 'Pelos dados informados, a divida ja estaria quitada.';
    end if;

    select category.id
    into debt_category_id
    from public.pf_categories category
    where category.household_id = target_household_id
      and category.kind = 'expense'
      and category.group_type = 'debt'
    order by category.is_system desc, category.created_at asc
    limit 1;

    if debt_category_id is null then
        raise exception 'Categoria de divida nao encontrada.';
    end if;

    select *
    into created_debt
    from public.pf_create_debt_with_initial_payment_v2(
        target_household_id => target_household_id,
        debt_creditor => trim(debt_creditor),
        debt_description => 'Divida com ' || trim(debt_creditor),
        debt_original_amount => debt_original_amount,
        target_debt_group => target_debt_group,
        debt_start_date => current_date,
        debt_due_date => debt_due_date,
        debt_installment_amount => debt_installment_amount,
        debt_total_installments => debt_total_installments,
        debt_interest_enabled => coalesce(debt_interest_enabled, false),
        debt_auto_accrue_interest => coalesce(debt_interest_enabled, false)
            and coalesce(debt_auto_accrue_interest, false),
        debt_interest_rate => coalesce(debt_interest_rate, 0),
        debt_interest_period => debt_interest_period,
        debt_interest_method => debt_interest_method,
        debt_penalty_rate => 0,
        debt_daily_late_interest_rate => 0,
        debt_grace_period_days => 0,
        debt_responsible_user_id => current_user_id,
        debt_visibility_scope => 'family',
        initial_payment_amount => 0,
        initial_payment_account_id => null,
        initial_payment_date => current_date,
        initial_payment_count_installment => false,
        initial_payment_notes => null
    );

    update public.pf_debts
    set
        baseline_paid_installments = coalesce(debt_baseline_paid_installments, 0),
        baseline_paid_amount = historical_paid,
        paid_installments = coalesce(debt_baseline_paid_installments, 0),
        interest_start_date = current_date,
        updated_at = now()
    where id = created_debt.debt_id;

    if historical_paid > 0 then
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
            target_household_id,
            created_debt.debt_id,
            'payment',
            historical_paid,
            current_date,
            'baseline_installments_before_kyra',
            current_user_id
        );
    end if;

    remaining_balance := greatest(debt_original_amount - historical_paid, 0);
    obligation_amount := case
        when coalesce(debt_installment_amount, 0) > 0 then
            least(debt_installment_amount, remaining_balance)
        else remaining_balance
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
        null,
        debt_category_id,
        created_debt.debt_id,
        current_user_id,
        current_user_id,
        'expense',
        'planned',
        'Parcela da divida',
        trim(debt_creditor),
        obligation_amount,
        obligation_amount,
        current_date,
        debt_due_date,
        'manual',
        null,
        jsonb_build_object(
            'origin', 'debt_obligation',
            'debt_group', target_debt_group,
            'debt_original_amount', debt_original_amount,
            'baseline_paid_installments', coalesce(debt_baseline_paid_installments, 0)
        )
    )
    returning id into created_obligation_id;

    return query
    select created_debt.debt_id::uuid, created_obligation_id;
end;
$$;

revoke all on function public.pf_create_debt_obligation_v2(
    uuid, text, numeric, text, date, numeric, integer, integer,
    boolean, boolean, numeric, text, text
) from public, anon;

grant execute on function public.pf_create_debt_obligation_v2(
    uuid, text, numeric, text, date, numeric, integer, integer,
    boolean, boolean, numeric, text, text
) to authenticated;

create or replace function public.pf_update_debt_v2(
    target_debt_id uuid,
    debt_creditor text,
    debt_original_amount numeric,
    debt_due_date date,
    debt_installment_amount numeric default null,
    debt_total_installments integer default null,
    debt_baseline_paid_installments integer default 0,
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
    debt_category_id uuid;
    baseline_movement_id uuid;
    real_paid_total numeric := 0;
    post_tracking_installments integer := 0;
    new_total_paid_installments integer := 0;
    historical_paid numeric := 0;
    projected_balance numeric := 0;
    obligation_amount numeric := 0;
    existing_obligation_id uuid;
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
        raise exception 'O valor total precisa ser maior que zero.';
    end if;

    if debt_installment_amount is not null and debt_installment_amount <= 0 then
        raise exception 'O valor da parcela precisa ser maior que zero.';
    end if;

    if debt_total_installments is not null and debt_total_installments <= 0 then
        raise exception 'O total de parcelas precisa ser maior que zero.';
    end if;

    if coalesce(debt_baseline_paid_installments, 0) < 0 then
        raise exception 'As parcelas pagas nao podem ser negativas.';
    end if;

    if debt_interest_period not in ('daily', 'monthly', 'yearly') then
        raise exception 'Periodo de juros invalido.';
    end if;

    if debt_interest_method not in ('simple', 'compound') then
        raise exception 'Metodo de juros invalido.';
    end if;

    post_tracking_installments := greatest(
        coalesce(selected_debt.paid_installments, 0)
        - coalesce(selected_debt.baseline_paid_installments, 0),
        0
    );

    new_total_paid_installments := coalesce(debt_baseline_paid_installments, 0)
        + post_tracking_installments;

    if debt_total_installments is not null
       and new_total_paid_installments > debt_total_installments then
        raise exception 'As parcelas pagas nao podem superar o total de parcelas.';
    end if;

    historical_paid := case
        when coalesce(debt_baseline_paid_installments, 0) <= 0 then 0
        when coalesce(debt_installment_amount, 0) > 0 then
            least(
                debt_original_amount,
                round(debt_installment_amount * debt_baseline_paid_installments, 2)
            )
        when coalesce(debt_total_installments, 0) > 0 then
            least(
                debt_original_amount,
                round(
                    debt_original_amount
                    * debt_baseline_paid_installments::numeric
                    / debt_total_installments::numeric,
                    2
                )
            )
        else 0
    end;

    select coalesce(sum(movement.amount), 0)
    into real_paid_total
    from public.pf_debt_movements movement
    where movement.debt_id = target_debt_id
      and movement.movement_type = 'payment'
      and coalesce(movement.notes, '') <> 'baseline_installments_before_kyra';

    if historical_paid + real_paid_total > debt_original_amount + 0.005 then
        raise exception 'O valor total nao pode ser menor que o historico ja pago.';
    end if;

    update public.pf_debts
    set
        creditor = trim(debt_creditor),
        description = 'Divida com ' || trim(debt_creditor),
        original_amount = debt_original_amount,
        current_balance = debt_original_amount,
        installment_amount = case
            when coalesce(debt_installment_amount, 0) > 0 then debt_installment_amount
            else null
        end,
        total_installments = debt_total_installments,
        paid_installments = new_total_paid_installments,
        baseline_paid_installments = coalesce(debt_baseline_paid_installments, 0),
        baseline_paid_amount = historical_paid,
        due_date = debt_due_date,
        interest_enabled = coalesce(debt_interest_enabled, false),
        auto_accrue_interest = coalesce(debt_interest_enabled, false)
            and coalesce(debt_auto_accrue_interest, false),
        interest_rate = case
            when coalesce(debt_interest_enabled, false) then coalesce(debt_interest_rate, 0)
            else 0
        end,
        monthly_interest_rate = case
            when coalesce(debt_interest_enabled, false)
             and debt_interest_period = 'monthly' then coalesce(debt_interest_rate, 0)
            else 0
        end,
        interest_period = debt_interest_period,
        interest_method = debt_interest_method,
        interest_start_date = coalesce(interest_start_date, current_date),
        interest_free = not coalesce(debt_interest_enabled, false),
        updated_at = now()
    where id = target_debt_id;

    update public.pf_debt_movements movement
    set amount = debt_original_amount
    where movement.id = (
        select principal.id
        from public.pf_debt_movements principal
        where principal.debt_id = target_debt_id
          and principal.movement_type = 'principal'
        order by principal.created_at asc, principal.id asc
        limit 1
    );

    select movement.id
    into baseline_movement_id
    from public.pf_debt_movements movement
    where movement.debt_id = target_debt_id
      and movement.movement_type = 'payment'
      and movement.notes = 'baseline_installments_before_kyra'
    order by movement.created_at asc
    limit 1;

    if historical_paid > 0 then
        if baseline_movement_id is null then
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
                'payment',
                historical_paid,
                current_date,
                'baseline_installments_before_kyra',
                auth.uid()
            );
        else
            update public.pf_debt_movements
            set amount = historical_paid
            where id = baseline_movement_id;
        end if;
    elsif baseline_movement_id is not null then
        delete from public.pf_debt_movements
        where id = baseline_movement_id;
    end if;

    select position.projected_balance
    into projected_balance
    from public.pf_calculate_debt_position(target_debt_id, current_date) position;

    projected_balance := greatest(coalesce(projected_balance, 0), 0);
    obligation_amount := case
        when coalesce(debt_installment_amount, 0) > 0 then
            least(debt_installment_amount, projected_balance)
        else projected_balance
    end;

    select category.id
    into debt_category_id
    from public.pf_categories category
    where category.household_id = selected_debt.household_id
      and category.kind = 'expense'
      and category.group_type = 'debt'
    order by category.is_system desc, category.created_at asc
    limit 1;

    select transaction.id
    into existing_obligation_id
    from public.pf_transactions transaction
    where transaction.debt_id = target_debt_id
      and transaction.type = 'expense'
      and transaction.status in ('planned', 'overdue')
      and coalesce(transaction.metadata ->> 'origin', '') = 'debt_obligation'
    order by transaction.created_at asc
    limit 1;

    if obligation_amount > 0 then
        if existing_obligation_id is null then
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
                metadata
            )
            values (
                selected_debt.household_id,
                null,
                debt_category_id,
                target_debt_id,
                auth.uid(),
                auth.uid(),
                'expense',
                'planned',
                'Parcela da divida',
                trim(debt_creditor),
                obligation_amount,
                obligation_amount,
                current_date,
                debt_due_date,
                'manual',
                jsonb_build_object(
                    'origin', 'debt_obligation',
                    'debt_group', selected_debt.debt_group,
                    'debt_original_amount', debt_original_amount,
                    'baseline_paid_installments', coalesce(debt_baseline_paid_installments, 0)
                )
            );
        else
            update public.pf_transactions
            set
                account_id = null,
                category_id = coalesce(debt_category_id, category_id),
                merchant = trim(debt_creditor),
                description = 'Parcela da divida',
                amount = obligation_amount,
                original_amount = obligation_amount,
                due_date = debt_due_date,
                updated_at = now(),
                metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                    'debt_original_amount', debt_original_amount,
                    'baseline_paid_installments', coalesce(debt_baseline_paid_installments, 0),
                    'managed_from_debt', true
                )
            where id = existing_obligation_id;
        end if;
    else
        update public.pf_transactions
        set status = 'cancelled', updated_at = now()
        where id = existing_obligation_id;

        update public.pf_debts
        set status = 'paid', updated_at = now()
        where id = target_debt_id;
    end if;
end;
$$;

revoke all on function public.pf_update_debt_v2(
    uuid, text, numeric, date, numeric, integer, integer,
    boolean, boolean, numeric, text, text
) from public, anon;

grant execute on function public.pf_update_debt_v2(
    uuid, text, numeric, date, numeric, integer, integer,
    boolean, boolean, numeric, text, text
) to authenticated;

commit;

notify pgrst, 'reload schema';
