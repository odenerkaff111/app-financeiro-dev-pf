begin;

-- =========================================================
-- 1. INSTALLMENT SCHEDULE MANAGEMENT
-- =========================================================

create or replace function public.pf_update_installment_schedule_v1(
    target_household_id uuid,
    target_installment_group_id uuid,
    new_first_due_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    desired_day integer;
    updated_count integer := 0;
begin
    if not public.pf_can_write(target_household_id) then
        raise exception 'You do not have permission to update this household.';
    end if;

    if target_installment_group_id is null then
        raise exception 'Installment group is required.';
    end if;

    if new_first_due_date is null then
        raise exception 'First due date is required.';
    end if;

    if not exists (
        select 1
        from public.pf_transactions transaction
        where transaction.household_id = target_household_id
          and transaction.installment_group_id = target_installment_group_id
    ) then
        raise exception 'Installment group was not found in this household.';
    end if;

    desired_day := extract(day from new_first_due_date)::integer;

    with schedule as (
        select
            transaction.id,
            transaction.installment_number,
            (
                date_trunc('month', new_first_due_date)::date
                + make_interval(
                    months => greatest(coalesce(transaction.installment_number, 1) - 1, 0)
                )
            )::date as month_start
        from public.pf_transactions transaction
        where transaction.household_id = target_household_id
          and transaction.installment_group_id = target_installment_group_id
    ),
    resolved as (
        select
            schedule.id,
            schedule.month_start
            + (
                least(
                    desired_day,
                    extract(
                        day from (
                            schedule.month_start
                            + interval '1 month - 1 day'
                        )
                    )::integer
                ) - 1
            ) as due_date
        from schedule
    )
    update public.pf_transactions transaction
       set due_date = resolved.due_date,
           updated_at = now()
      from resolved
     where transaction.id = resolved.id;

    get diagnostics updated_count = row_count;
    return updated_count;
end;
$$;

revoke all
on function public.pf_update_installment_schedule_v1(uuid, uuid, date)
from public, anon;

grant execute
on function public.pf_update_installment_schedule_v1(uuid, uuid, date)
to authenticated;

-- Repair groups where an isolated manual edit created two installments
-- in the same calendar month. The due date of installment 1 becomes the
-- source of truth and the remaining installments are re-sequenced monthly.
do $$
declare
    selected_group record;
    desired_day integer;
begin
    for selected_group in
        select
            transaction.household_id,
            transaction.installment_group_id,
            min(transaction.due_date)
                filter (where transaction.installment_number = 1)
                as first_due_date
        from public.pf_transactions transaction
        where transaction.installment_group_id is not null
          and transaction.due_date is not null
        group by
            transaction.household_id,
            transaction.installment_group_id
        having count(*) > count(
            distinct date_trunc('month', transaction.due_date)
        )
    loop
        if selected_group.first_due_date is not null then
            desired_day := extract(day from selected_group.first_due_date)::integer;

            with schedule as (
                select
                    transaction.id,
                    (
                        date_trunc('month', selected_group.first_due_date)::date
                        + make_interval(
                            months => greatest(
                                coalesce(transaction.installment_number, 1) - 1,
                                0
                            )
                        )
                    )::date as month_start
                from public.pf_transactions transaction
                where transaction.household_id = selected_group.household_id
                  and transaction.installment_group_id = selected_group.installment_group_id
            ),
            resolved as (
                select
                    schedule.id,
                    schedule.month_start
                    + (
                        least(
                            desired_day,
                            extract(
                                day from (
                                    schedule.month_start
                                    + interval '1 month - 1 day'
                                )
                            )::integer
                        ) - 1
                    ) as due_date
                from schedule
            )
            update public.pf_transactions transaction
               set due_date = resolved.due_date,
                   updated_at = now()
              from resolved
             where transaction.id = resolved.id;
        end if;
    end loop;
end;
$$;

-- =========================================================
-- 2. ANONYMOUS DATA-API LOCKDOWN
--
-- The application is private and invite-only. Authentication itself uses
-- Supabase Auth endpoints, not the public Postgres schema, so anonymous users
-- do not need access to public financial objects.
-- =========================================================

revoke usage on schema public from public;
revoke usage on schema public from anon;

grant usage on schema public to authenticated;
grant usage on schema public to service_role;

do $$
begin
    if exists (
        select 1
        from pg_roles
        where rolname = 'supabase_auth_admin'
    ) then
        execute 'grant usage on schema public to supabase_auth_admin';
    end if;
end;
$$;

do $$
declare
    selected_table record;
begin
    for selected_table in
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
          and table_name like 'pf\_%' escape '\'
    loop
        execute format(
            'alter table public.%I enable row level security',
            selected_table.table_name
        );
        execute format(
            'revoke all on table public.%I from anon',
            selected_table.table_name
        );
        execute format(
            'revoke all on table public.%I from public',
            selected_table.table_name
        );
    end loop;
end;
$$;

revoke all on all sequences in schema public from anon;
revoke all on all sequences in schema public from public;

-- Future objects should not silently become public. New client-facing RPCs
-- must explicitly grant EXECUTE to authenticated, as the existing migrations do.
alter default privileges in schema public
    revoke all on tables from public;

alter default privileges in schema public
    revoke all on tables from anon;

alter default privileges in schema public
    revoke all on sequences from public;

alter default privileges in schema public
    revoke all on sequences from anon;

alter default privileges in schema public
    revoke execute on functions from public;

alter default privileges in schema public
    revoke execute on functions from anon;

commit;

notify pgrst, 'reload schema';
