begin;

-- Self-contained monthly recurrence helper for ordinary income/expense records.
-- It does not depend on the older v1/v2 wrappers and supports optional account_id.
create or replace function public.pf_make_transaction_monthly_recurring_v3(
    target_transaction_id uuid,
    recurrence_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_transaction public.pf_transactions%rowtype;
    existing_template public.pf_recurring_templates%rowtype;
    created_template_id uuid;
    recurrence_start date;
    recurrence_day integer;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuario nao autenticado.';
    end if;

    select transaction.*
    into selected_transaction
    from public.pf_transactions transaction
    where transaction.id = target_transaction_id
    for update;

    if not found then
        raise exception 'Lancamento nao encontrado.';
    end if;

    if not public.pf_can_write(selected_transaction.household_id) then
        raise exception 'Seu acesso e somente leitura.';
    end if;

    if selected_transaction.type not in ('income', 'expense') then
        raise exception 'Somente receita ou despesa pode ser recorrente neste fluxo.';
    end if;

    if selected_transaction.status = 'cancelled' then
        raise exception 'Lancamento cancelado nao pode virar recorrencia.';
    end if;

    recurrence_start := coalesce(
        selected_transaction.due_date,
        selected_transaction.occurred_on,
        current_date
    );

    if recurrence_ends_on is not null
       and recurrence_ends_on < recurrence_start then
        raise exception 'A recorrencia nao pode terminar antes do primeiro lancamento.';
    end if;

    if selected_transaction.recurrence_key is not null then
        select template.*
        into existing_template
        from public.pf_recurring_templates template
        where template.id = selected_transaction.recurrence_key
          and template.household_id = selected_transaction.household_id
        for update;

        if found then
            update public.pf_recurring_templates
            set
                ends_on = recurrence_ends_on,
                is_active = true,
                auto_generate = true,
                updated_at = now()
            where id = existing_template.id;

            return existing_template.id;
        end if;
    end if;

    recurrence_day := extract(day from recurrence_start)::integer;

    insert into public.pf_recurring_templates (
        household_id,
        created_by,
        account_id,
        category_id,
        type,
        description,
        merchant,
        amount,
        day_of_month,
        is_variable,
        auto_generate,
        starts_on,
        ends_on,
        is_active,
        notes,
        is_essential
    )
    values (
        selected_transaction.household_id,
        current_user_id,
        selected_transaction.account_id,
        selected_transaction.category_id,
        selected_transaction.type,
        selected_transaction.description,
        selected_transaction.merchant,
        selected_transaction.amount,
        recurrence_day,
        false,
        true,
        recurrence_start,
        recurrence_ends_on,
        true,
        selected_transaction.notes,
        coalesce(selected_transaction.is_essential, false)
    )
    returning id into created_template_id;

    update public.pf_transactions
    set
        recurrence_key = created_template_id,
        updated_at = now()
    where id = selected_transaction.id;

    return created_template_id;
end;
$$;

revoke all
on function public.pf_make_transaction_monthly_recurring_v3(uuid, date)
from public, anon;

grant execute
on function public.pf_make_transaction_monthly_recurring_v3(uuid, date)
to authenticated;

commit;

notify pgrst, 'reload schema';
