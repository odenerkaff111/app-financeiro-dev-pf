begin;

-- Corrige a validação administrativa da posição das dívidas.
--
-- A função permanece SECURITY INVOKER:
-- - no aplicativo, a consulta de pf_debts continua protegida pelo RLS;
-- - um usuário sem acesso não enxerga a dívida e recebe "Dívida não encontrada";
-- - no SQL Editor, o papel administrativo consegue validar o motor sem auth.uid().

create or replace function public.pf_calculate_debt_position(
    target_debt_id uuid,
    position_date date default current_date
)
returns table (
    ledger_balance numeric,
    accrued_interest numeric,
    projected_penalty numeric,
    projected_late_interest numeric,
    projected_balance numeric,
    daily_growth numeric,
    overdue_days integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
    selected_debt public.pf_debts%rowtype;
    selected_movement record;

    working_balance numeric := 0;
    calculated_ledger_balance numeric := 0;
    calculated_interest numeric := 0;
    calculated_penalty numeric := 0;
    calculated_late_interest numeric := 0;
    calculated_daily_growth numeric := 0;

    movement_count integer := 0;

    cursor_date date;
    event_date date;
    effective_start date;
    overdue_start date;
    split_date date;

    base_interest numeric;
    late_interest numeric;
    late_days integer;
    penalty_already_projected boolean := false;
begin
    select *
    into selected_debt
    from public.pf_debts debt
    where debt.id = target_debt_id;

    if not found then
        raise exception 'Dívida não encontrada.';
    end if;

    position_date := coalesce(
        position_date,
        current_date
    );

    overdue_start := case
        when selected_debt.due_date is null
            then null
        else selected_debt.due_date
            + selected_debt.grace_period_days
    end;

    select
        coalesce(
            sum(
                case
                    when movement.movement_type in (
                        'principal',
                        'interest',
                        'fee'
                    ) then movement.amount
                    when movement.movement_type in (
                        'payment',
                        'discount'
                    ) then -movement.amount
                    else 0
                end
            ),
            selected_debt.current_balance,
            selected_debt.original_amount,
            0
        )
    into calculated_ledger_balance
    from public.pf_debt_movements movement
    where movement.debt_id = selected_debt.id
      and movement.occurred_on <= position_date;

    for selected_movement in
        select
            movement.movement_type,
            movement.amount,
            movement.occurred_on
        from public.pf_debt_movements movement
        where movement.debt_id = selected_debt.id
          and movement.occurred_on <= position_date
        order by
            movement.occurred_on asc,
            movement.id asc
    loop
        movement_count := movement_count + 1;
        event_date := selected_movement.occurred_on;

        if cursor_date is null then
            cursor_date := event_date;
        end if;

        if event_date > cursor_date then
            effective_start := greatest(
                cursor_date,
                coalesce(
                    selected_debt.interest_start_date,
                    selected_debt.start_date,
                    cursor_date
                )
            );

            if event_date > effective_start then
                if overdue_start is not null
                   and not penalty_already_projected
                   and overdue_start <= effective_start
                   and event_date > overdue_start
                   and coalesce(selected_debt.penalty_rate, 0) > 0 then
                    calculated_penalty := calculated_penalty
                        + working_balance
                        * selected_debt.penalty_rate
                        / 100::numeric;

                    working_balance := working_balance
                        + working_balance
                        * selected_debt.penalty_rate
                        / 100::numeric;

                    penalty_already_projected := true;
                end if;

                if overdue_start is not null
                   and not penalty_already_projected
                   and overdue_start > effective_start
                   and overdue_start < event_date then
                    split_date := overdue_start;

                    if selected_debt.interest_enabled
                       and selected_debt.auto_accrue_interest then
                        base_interest := public.pf_calculate_interval_interest(
                            working_balance,
                            effective_start,
                            split_date,
                            selected_debt.interest_rate,
                            selected_debt.interest_period,
                            selected_debt.interest_method
                        );

                        working_balance := working_balance + base_interest;
                        calculated_interest := calculated_interest + base_interest;
                    end if;

                    if coalesce(selected_debt.penalty_rate, 0) > 0 then
                        calculated_penalty := calculated_penalty
                            + working_balance
                            * selected_debt.penalty_rate
                            / 100::numeric;

                        working_balance := working_balance
                            + working_balance
                            * selected_debt.penalty_rate
                            / 100::numeric;
                    end if;

                    penalty_already_projected := true;
                    effective_start := split_date;
                end if;

                if selected_debt.interest_enabled
                   and selected_debt.auto_accrue_interest then
                    base_interest := public.pf_calculate_interval_interest(
                        working_balance,
                        effective_start,
                        event_date,
                        selected_debt.interest_rate,
                        selected_debt.interest_period,
                        selected_debt.interest_method
                    );

                    working_balance := working_balance + base_interest;
                    calculated_interest := calculated_interest + base_interest;
                end if;

                if overdue_start is not null
                   and event_date > overdue_start
                   and coalesce(
                       selected_debt.daily_late_interest_rate,
                       0
                   ) > 0 then
                    late_days := greatest(
                        event_date
                        - greatest(
                            effective_start,
                            overdue_start
                        ),
                        0
                    );

                    late_interest := working_balance
                        * selected_debt.daily_late_interest_rate
                        / 100::numeric
                        * late_days;

                    working_balance := working_balance + late_interest;
                    calculated_late_interest := calculated_late_interest
                        + late_interest;
                end if;
            end if;
        end if;

        working_balance := greatest(
            0,
            working_balance
            + case
                when selected_movement.movement_type in (
                    'principal',
                    'interest',
                    'fee'
                ) then selected_movement.amount
                when selected_movement.movement_type in (
                    'payment',
                    'discount'
                ) then -selected_movement.amount
                else 0
              end
        );

        cursor_date := event_date;
    end loop;

    if movement_count = 0 then
        working_balance := coalesce(
            selected_debt.current_balance,
            selected_debt.original_amount,
            0
        );

        cursor_date := coalesce(
            selected_debt.start_date,
            selected_debt.interest_start_date,
            selected_debt.created_at::date,
            position_date
        );
    end if;

    if position_date > cursor_date then
        effective_start := greatest(
            cursor_date,
            coalesce(
                selected_debt.interest_start_date,
                selected_debt.start_date,
                cursor_date
            )
        );

        if position_date > effective_start then
            if overdue_start is not null
               and not penalty_already_projected
               and overdue_start <= effective_start
               and position_date > overdue_start
               and coalesce(selected_debt.penalty_rate, 0) > 0 then
                calculated_penalty := calculated_penalty
                    + working_balance
                    * selected_debt.penalty_rate
                    / 100::numeric;

                working_balance := working_balance
                    + working_balance
                    * selected_debt.penalty_rate
                    / 100::numeric;

                penalty_already_projected := true;
            end if;

            if overdue_start is not null
               and not penalty_already_projected
               and overdue_start > effective_start
               and overdue_start < position_date then
                split_date := overdue_start;

                if selected_debt.interest_enabled
                   and selected_debt.auto_accrue_interest then
                    base_interest := public.pf_calculate_interval_interest(
                        working_balance,
                        effective_start,
                        split_date,
                        selected_debt.interest_rate,
                        selected_debt.interest_period,
                        selected_debt.interest_method
                    );

                    working_balance := working_balance + base_interest;
                    calculated_interest := calculated_interest + base_interest;
                end if;

                if coalesce(selected_debt.penalty_rate, 0) > 0 then
                    calculated_penalty := calculated_penalty
                        + working_balance
                        * selected_debt.penalty_rate
                        / 100::numeric;

                    working_balance := working_balance
                        + working_balance
                        * selected_debt.penalty_rate
                        / 100::numeric;
                end if;

                penalty_already_projected := true;
                effective_start := split_date;
            end if;

            if selected_debt.interest_enabled
               and selected_debt.auto_accrue_interest then
                base_interest := public.pf_calculate_interval_interest(
                    working_balance,
                    effective_start,
                    position_date,
                    selected_debt.interest_rate,
                    selected_debt.interest_period,
                    selected_debt.interest_method
                );

                working_balance := working_balance + base_interest;
                calculated_interest := calculated_interest + base_interest;
            end if;

            if overdue_start is not null
               and position_date > overdue_start
               and coalesce(
                   selected_debt.daily_late_interest_rate,
                   0
               ) > 0 then
                late_days := greatest(
                    position_date
                    - greatest(
                        effective_start,
                        overdue_start
                    ),
                    0
                );

                late_interest := working_balance
                    * selected_debt.daily_late_interest_rate
                    / 100::numeric
                    * late_days;

                working_balance := working_balance + late_interest;
                calculated_late_interest := calculated_late_interest
                    + late_interest;
            end if;
        end if;
    end if;

    calculated_daily_growth := 0;

    if selected_debt.interest_enabled
       and selected_debt.auto_accrue_interest then
        calculated_daily_growth := calculated_daily_growth
            + public.pf_calculate_interval_interest(
                working_balance,
                position_date,
                position_date + 1,
                selected_debt.interest_rate,
                selected_debt.interest_period,
                selected_debt.interest_method
            );
    end if;

    if overdue_start is not null
       and position_date >= overdue_start
       and coalesce(
           selected_debt.daily_late_interest_rate,
           0
       ) > 0 then
        calculated_daily_growth := calculated_daily_growth
            + working_balance
            * selected_debt.daily_late_interest_rate
            / 100::numeric;
    end if;

    ledger_balance := round(
        greatest(
            calculated_ledger_balance,
            0
        ),
        2
    );

    accrued_interest := round(
        greatest(
            calculated_interest,
            0
        ),
        2
    );

    projected_penalty := round(
        greatest(
            calculated_penalty,
            0
        ),
        2
    );

    projected_late_interest := round(
        greatest(
            calculated_late_interest,
            0
        ),
        2
    );

    projected_balance := round(
        greatest(
            working_balance,
            0
        ),
        2
    );

    daily_growth := round(
        greatest(
            calculated_daily_growth,
            0
        ),
        2
    );

    overdue_days := case
        when overdue_start is null
            or position_date <= overdue_start
            then 0
        else position_date - overdue_start
    end;

    return next;
end;
$$;

revoke all
on function public.pf_calculate_debt_position(
    uuid,
    date
)
from public, anon;

grant execute
on function public.pf_calculate_debt_position(
    uuid,
    date
)
to authenticated;

commit;

notify pgrst, 'reload schema';
