begin;

create or replace function public.pf_ensure_household(
    default_name text default 'Nossa família'
)
returns table (
    household_id uuid,
    household_name text,
    member_role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    selected_household_id uuid;
    selected_household_name text;
    selected_member_role text;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception 'Usuário não autenticado.';
    end if;

    -- Impede duas chamadas simultâneas de criarem duas famílias.
    perform pg_advisory_xact_lock(
        hashtextextended(current_user_id::text, 0)
    );

    select
        household.id,
        household.name,
        member.role
    into
        selected_household_id,
        selected_household_name,
        selected_member_role
    from public.pf_household_members member
    inner join public.pf_households household
        on household.id = member.household_id
    where member.user_id = current_user_id
    order by
        case when member.role = 'owner' then 0 else 1 end,
        household.created_at asc
    limit 1;

    if selected_household_id is null then
        insert into public.pf_households (
            name,
            created_by
        )
        values (
            coalesce(
                nullif(trim(default_name), ''),
                'Nossa família'
            ),
            current_user_id
        )
        returning
            id,
            name
        into
            selected_household_id,
            selected_household_name;

        selected_member_role := 'owner';
    end if;

    return query
    select
        selected_household_id,
        selected_household_name,
        selected_member_role;
end;
$$;

revoke all
on function public.pf_ensure_household(text)
from public;

grant execute
on function public.pf_ensure_household(text)
to authenticated;

commit;