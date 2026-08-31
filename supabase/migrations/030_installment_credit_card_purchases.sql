begin;

-- Support installment purchases paid with the user's own credit card or a
-- third-party card. Installments are represented as planned expense
-- transactions, one per due month. This makes them visible in A pagar,
-- month filters and the annual projection without counting the whole purchase
-- as an immediate cash outflow.

alter table public.pf_accounts
    add column if not exists available_credit numeric(14, 2);

create index if not exists pf_transactions_installment_group_idx
    on public.pf_transactions (household_id, installment_group_id)
    where installment_group_id is not null;

create or replace function public.pf_create_installment_purchase_v1(
    target_household_id uuid,
    purchase_description text,
    purchase_merchant text,
    purchase_total_amount numeric,
    purchase_installments integer,
    first_installment_due_date date,
    purchase_category_id uuid,
    credit_card_account_id uuid default null,
    third_party_card_holder text default null,
    third_party_card_institution text default null,
    purchase_notes text default null,
    purchase_is_essential boolean default false
)
returns table (
    installment_group_id uuid,
    created_installments integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    group_id uuid := gen_random_uuid();
    total_cents bigint;
    base_cents bigint;
    remainder_cents bigint;
    installment_index integer;
    installment_cents bigint;
    installment_amount numeric(14, 2);
    month_start date;
    month_last_day integer;
    desired_day integer;
    installment_due_date date;
    resolved_card_holder text;
    resolved_card_institution text;
begin
    if not public.pf_can_write(target_household_id) then
        raise exception 'You do not have permission to create transactions in this household.';
    end if;

    if purchase_total_amount is null or purchase_total_amount <= 0 then
        raise exception 'Purchase amount must be greater than zero.';
    end if;

    if purchase_installments is null
       or purchase_installments < 2
       or purchase_installments > 120 then
        raise exception 'Installments must be between 2 and 120.';
    end if;

    if first_installment_due_date is null then
        raise exception 'First installment due date is required.';
    end if;

    if purchase_category_id is null
       or not exists (
           select 1
           from public.pf_categories category
           where category.id = purchase_category_id
             and category.household_id = target_household_id
       ) then
        raise exception 'Expense category does not belong to the household.';
    end if;

    if credit_card_account_id is not null then
        select account.name, account.institution_name
          into resolved_card_holder, resolved_card_institution
          from public.pf_accounts account
         where account.id = credit_card_account_id
           and account.household_id = target_household_id
           and account.type = 'credit_card'
           and account.is_active = true;

        if not found then
            raise exception 'Selected credit card does not belong to the household or is inactive.';
        end if;
    else
        resolved_card_holder := nullif(trim(coalesce(third_party_card_holder, '')), '');
        resolved_card_institution := nullif(trim(coalesce(third_party_card_institution, '')), '');

        if resolved_card_holder is null then
            raise exception 'Inform the card holder when using a third-party card.';
        end if;
    end if;

    total_cents := round(purchase_total_amount * 100)::bigint;
    base_cents := total_cents / purchase_installments;
    remainder_cents := mod(total_cents, purchase_installments);
    desired_day := extract(day from first_installment_due_date)::integer;

    for installment_index in 1..purchase_installments loop
        installment_cents := base_cents
            + case when installment_index <= remainder_cents then 1 else 0 end;
        installment_amount := installment_cents::numeric / 100::numeric;

        month_start := (
            date_trunc('month', first_installment_due_date)::date
            + make_interval(months => installment_index - 1)
        )::date;

        month_last_day := extract(
            day from (month_start + interval '1 month - 1 day')
        )::integer;

        installment_due_date := month_start
            + (least(desired_day, month_last_day) - 1);

        insert into public.pf_transactions (
            household_id,
            account_id,
            category_id,
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
            installment_group_id,
            installment_number,
            installment_total,
            source,
            notes,
            is_essential,
            metadata
        )
        values (
            target_household_id,
            null,
            purchase_category_id,
            auth.uid(),
            auth.uid(),
            'expense',
            'planned',
            trim(purchase_description),
            nullif(trim(coalesce(purchase_merchant, '')), ''),
            installment_amount,
            installment_amount,
            current_date,
            installment_due_date,
            null,
            group_id,
            installment_index,
            purchase_installments,
            'manual',
            nullif(trim(coalesce(purchase_notes, '')), ''),
            coalesce(purchase_is_essential, false),
            jsonb_strip_nulls(
                jsonb_build_object(
                    'origin', 'installment_purchase',
                    'payment_method', 'credit_card',
                    'purchase_total_amount', purchase_total_amount,
                    'credit_card_account_id', credit_card_account_id,
                    'card_holder', resolved_card_holder,
                    'card_institution', resolved_card_institution
                )
            )
        );
    end loop;

    -- A credit-card purchase usually consumes the full purchase amount from
    -- the available limit immediately. The user can later confirm the actual
    -- released limit when paying the bill, because institutions may differ.
    if credit_card_account_id is not null then
        update public.pf_accounts
           set available_credit = case
                   when available_credit is null then null
                   else greatest(0, available_credit - purchase_total_amount)
               end,
               updated_at = now()
         where id = credit_card_account_id
           and household_id = target_household_id;
    end if;

    return query
    select group_id, purchase_installments;
end;
$$;

revoke all
on function public.pf_create_installment_purchase_v1(
    uuid,
    text,
    text,
    numeric,
    integer,
    date,
    uuid,
    uuid,
    text,
    text,
    text,
    boolean
)
from public, anon;

grant execute
on function public.pf_create_installment_purchase_v1(
    uuid,
    text,
    text,
    numeric,
    integer,
    date,
    uuid,
    uuid,
    text,
    text,
    text,
    boolean
)
to authenticated;

commit;

notify pgrst, 'reload schema';
