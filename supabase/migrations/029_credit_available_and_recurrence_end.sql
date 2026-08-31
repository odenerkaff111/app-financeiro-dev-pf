begin;

-- Track the amount of credit that the institution currently reports as available.
alter table public.pf_accounts
    add column if not exists available_credit numeric(14, 2);

update public.pf_accounts
set available_credit = greatest(
        coalesce(credit_limit, 0) - greatest(coalesce(balance, 0), 0),
        0
    )
where type = 'credit_card'
  and available_credit is null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_accounts_available_credit_nonnegative'
    ) then
        alter table public.pf_accounts
            add constraint pf_accounts_available_credit_nonnegative
            check (
                available_credit is null
                or available_credit >= 0
            );
    end if;
end;
$$;

-- Keep the available credit in sync when a transaction is explicitly posted
-- against the credit-card account. Manual bill-payment confirmation can still
-- override the value because banks may release a different amount.
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
        available_credit = case
            when type = 'credit_card'
                 and available_credit is not null then
                greatest(
                    0,
                    least(
                        coalesce(credit_limit, available_credit + asset_delta),
                        available_credit + asset_delta
                    )
                )
            else available_credit
        end,
        balance_updated_at = now(),
        updated_at = now()
    where id = target_account_id
      and household_id = target_household_id;
end;
$$;

-- Create/update a monthly recurrence and set its optional end date atomically.
create or replace function public.pf_make_transaction_monthly_recurring_v2(
    target_transaction_id uuid,
    recurrence_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    template_id uuid;
    template_start date;
begin
    template_id := public.pf_make_transaction_monthly_recurring_v1(
        target_transaction_id
    );

    select starts_on
    into template_start
    from public.pf_recurring_templates
    where id = template_id;

    if recurrence_ends_on is not null
       and template_start is not null
       and recurrence_ends_on < template_start then
        raise exception 'Recurrence end date cannot be before its start date.';
    end if;

    update public.pf_recurring_templates
    set
        ends_on = recurrence_ends_on,
        updated_at = now()
    where id = template_id;

    return template_id;
end;
$$;

revoke all
on function public.pf_make_transaction_monthly_recurring_v2(uuid, date)
from public, anon;

grant execute
on function public.pf_make_transaction_monthly_recurring_v2(uuid, date)
to authenticated;

commit;

notify pgrst, 'reload schema';
