begin;

-- Account attribution is optional for ordinary manual transactions.
-- Specialized flows such as transfers may still require it in the UI/RPC.
alter table public.pf_transactions
    alter column account_id drop not null;

alter table public.pf_recurring_templates
    alter column account_id drop not null;

-- Turns an existing income/expense transaction into the first occurrence
-- of a monthly recurring template. This keeps the operation atomic.
create or replace function public.pf_make_transaction_monthly_recurring_v1(
    target_transaction_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_transaction public.pf_transactions%rowtype;
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

    if selected_transaction.recurrence_key is not null then
        return selected_transaction.recurrence_key;
    end if;

    recurrence_start := coalesce(
        selected_transaction.due_date,
        selected_transaction.occurred_on,
        current_date
    );

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
        null,
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
on function public.pf_make_transaction_monthly_recurring_v1(uuid)
from public, anon;

grant execute
on function public.pf_make_transaction_monthly_recurring_v1(uuid)
to authenticated;

-- Recurring generation predates the explicit is_essential field.
-- Copy the flag from the template whenever a generated transaction is inserted.
create or replace function public.pf_apply_recurring_template_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    recurring_is_essential boolean;
begin
    if new.recurrence_key is null then
        return new;
    end if;

    select template.is_essential
    into recurring_is_essential
    from public.pf_recurring_templates template
    where template.id = new.recurrence_key
      and template.household_id = new.household_id;

    if found then
        new.is_essential := coalesce(recurring_is_essential, false);
    end if;

    return new;
end;
$$;

drop trigger if exists pf_apply_recurring_template_flags_trigger
on public.pf_transactions;

create trigger pf_apply_recurring_template_flags_trigger
before insert or update of recurrence_key
on public.pf_transactions
for each row
execute function public.pf_apply_recurring_template_flags();

commit;

notify pgrst, 'reload schema';
