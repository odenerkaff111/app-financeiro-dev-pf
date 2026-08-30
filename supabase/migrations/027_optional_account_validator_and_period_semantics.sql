begin;

-- The account field is optional for ordinary manual income, expense and
-- investment contributions. Migration 025 relaxed the column nullability,
-- but the legacy validator still rejected null account_id values.
create or replace function public.pf_validate_transaction_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.account_id is not null
       and not exists (
           select 1
           from public.pf_accounts account
           where account.id = new.account_id
             and account.household_id = new.household_id
       ) then
        raise exception 'A conta de origem nao pertence ao grupo familiar informado.';
    end if;

    if new.destination_account_id is not null
       and not exists (
           select 1
           from public.pf_accounts account
           where account.id = new.destination_account_id
             and account.household_id = new.household_id
       ) then
        raise exception 'A conta de destino nao pertence ao grupo familiar informado.';
    end if;

    if new.category_id is not null
       and not exists (
           select 1
           from public.pf_categories category
           where category.id = new.category_id
             and category.household_id = new.household_id
       ) then
        raise exception 'A categoria nao pertence ao grupo familiar informado.';
    end if;

    if new.debt_id is not null
       and not exists (
           select 1
           from public.pf_debts debt
           where debt.id = new.debt_id
             and debt.household_id = new.household_id
       ) then
        raise exception 'A divida nao pertence ao grupo familiar informado.';
    end if;

    -- These flows really need a source account to move money between assets.
    if new.type in ('transfer', 'investment_withdrawal')
       and new.account_id is null then
        raise exception 'Essa movimentacao exige uma conta de origem.';
    end if;

    -- Investment contributions may omit the source account, but still need
    -- the automatically created/selected investment destination.
    if new.type in (
        'transfer',
        'investment_contribution',
        'investment_withdrawal'
    ) then
        if new.destination_account_id is null then
            raise exception 'Essa movimentacao exige uma conta de destino.';
        end if;

        if new.account_id is not null
           and new.destination_account_id = new.account_id then
            raise exception 'A conta de origem e a conta de destino precisam ser diferentes.';
        end if;
    end if;

    return new;
end;
$$;

commit;

notify pgrst, 'reload schema';
