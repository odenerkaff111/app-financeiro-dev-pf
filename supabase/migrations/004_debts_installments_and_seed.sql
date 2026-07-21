begin;

-- =========================================================
-- CAMPOS DE PARCELAMENTO DAS DÍVIDAS
-- =========================================================

alter table public.pf_debts
    add column if not exists installment_amount numeric(14, 2),
    add column if not exists total_installments integer,
    add column if not exists paid_installments integer not null default 0,
    add column if not exists interest_free boolean not null default false,
    add column if not exists import_key text;

-- Como ainda não sabemos quando essas dívidas começaram,
-- não vamos inventar datas.
alter table public.pf_debts
    alter column start_date drop not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_total_installments_positive'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_total_installments_positive
            check (
                total_installments is null
                or total_installments > 0
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_paid_installments_valid'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_paid_installments_valid
            check (
                paid_installments >= 0
                and (
                    total_installments is null
                    or paid_installments <= total_installments
                )
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'pf_debts_installment_amount_positive'
    ) then
        alter table public.pf_debts
            add constraint pf_debts_installment_amount_positive
            check (
                installment_amount is null
                or installment_amount > 0
            );
    end if;
end;
$$;

create unique index if not exists pf_debts_household_import_key_unique
    on public.pf_debts (
        household_id,
        import_key
    )
    where import_key is not null;

-- =========================================================
-- CORRIGE O TRIGGER DE CRIAÇÃO DA DÍVIDA
-- =========================================================

create or replace function public.pf_create_initial_debt_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
        new.household_id,
        new.id,
        'principal',
        new.original_amount,
        coalesce(new.start_date, current_date),
        'Valor inicial da dívida',
        new.created_by
    );

    return new;
end;
$$;

-- =========================================================
-- VISÃO COM PROGRESSO DAS DÍVIDAS
-- =========================================================

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
        else greatest(
            debt.total_installments - debt.paid_installments,
            0
        )
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

    coalesce(
        movement_summary.paid_amount,
        0
    ) as paid_amount,

    coalesce(
        movement_summary.interest_amount,
        0
    ) as interest_amount,

    coalesce(
        movement_summary.fee_amount,
        0
    ) as fee_amount,

    coalesce(
        movement_summary.discount_amount,
        0
    ) as discount_amount,

    case
        when debt.original_amount <= 0 then 0
        else round(
            least(
                100,
                (
                    coalesce(
                        movement_summary.paid_amount,
                        0
                    )
                    / debt.original_amount
                ) * 100
            ),
            2
        )
    end as progress_percentage

from public.pf_debts debt

left join lateral (
    select
        sum(movement.amount)
            filter (
                where movement.movement_type = 'payment'
            ) as paid_amount,

        sum(movement.amount)
            filter (
                where movement.movement_type = 'interest'
            ) as interest_amount,

        sum(movement.amount)
            filter (
                where movement.movement_type = 'fee'
            ) as fee_amount,

        sum(movement.amount)
            filter (
                where movement.movement_type = 'discount'
            ) as discount_amount

    from public.pf_debt_movements movement

    where movement.debt_id = debt.id
) movement_summary on true;

grant select
on public.pf_debt_progress
to authenticated;

-- =========================================================
-- IMPORTAÇÃO DAS DÍVIDAS REAIS SEM JUROS
-- =========================================================

do $$
declare
    selected_household_id uuid;
    selected_owner_id uuid;

    debt_row record;

    selected_debt_id uuid;

    calculated_installment numeric(14, 2);
    calculated_paid_amount numeric(14, 2);
begin
    select
        household.id,
        household.created_by
    into
        selected_household_id,
        selected_owner_id
    from public.pf_households household
    order by household.created_at asc
    limit 1;

    if selected_household_id is null then
        raise exception
            'Nenhum grupo familiar foi encontrado.';
    end if;

    for debt_row in
        select *
        from (
            values
                (
                    'personal:samuel',
                    'SAMUEL',
                    631.00::numeric,
                    12,
                    7
                ),
                (
                    'personal:valdete',
                    'VALDETE',
                    950.00::numeric,
                    12,
                    6
                ),
                (
                    'personal:gu',
                    'GU',
                    1000.00::numeric,
                    12,
                    6
                ),
                (
                    'personal:dirce',
                    'DIRCE',
                    2104.00::numeric,
                    12,
                    5
                ),
                (
                    'personal:atlimarjom',
                    'ATLIMARJOM',
                    2430.00::numeric,
                    18,
                    6
                ),
                (
                    'personal:marcela',
                    'MARCELA',
                    6380.00::numeric,
                    18,
                    6
                ),
                (
                    'personal:jose-geraldo',
                    'JOSÉ GERALDO',
                    6785.00::numeric,
                    20,
                    5
                ),
                (
                    'personal:maria',
                    'MARIA',
                    6900.00::numeric,
                    20,
                    6
                ),
                (
                    'personal:vanda',
                    'VANDA',
                    11356.00::numeric,
                    26,
                    0
                ),
                (
                    'personal:mary',
                    'Mary',
                    2580.00::numeric,
                    12,
                    2
                )
        ) as imported_debt (
            import_key,
            creditor,
            original_amount,
            total_installments,
            paid_installments
        )
    loop
        calculated_installment := round(
            debt_row.original_amount
            / debt_row.total_installments,
            2
        );

        calculated_paid_amount := round(
            debt_row.original_amount
            * debt_row.paid_installments
            / debt_row.total_installments,
            2
        );

        select debt.id
        into selected_debt_id
        from public.pf_debts debt
        where debt.household_id = selected_household_id
          and debt.import_key = debt_row.import_key
        limit 1;

        if selected_debt_id is null then
            insert into public.pf_debts (
                household_id,
                created_by,
                creditor,
                description,
                type,
                original_amount,
                current_balance,
                installment_amount,
                total_installments,
                paid_installments,
                monthly_interest_rate,
                penalty_rate,
                daily_late_interest_rate,
                interest_free,
                start_date,
                due_date,
                status,
                import_key
            )
            values (
                selected_household_id,
                selected_owner_id,
                debt_row.creditor,
                'Empréstimo pessoal sem juros. Data de início ainda não informada.',
                'informal',
                debt_row.original_amount,
                debt_row.original_amount,
                calculated_installment,
                debt_row.total_installments,
                debt_row.paid_installments,
                0,
                0,
                0,
                true,
                null,
                null,
                'active',
                debt_row.import_key
            )
            returning id
            into selected_debt_id;
        else
            update public.pf_debts
            set
                installment_amount = calculated_installment,
                total_installments = debt_row.total_installments,
                paid_installments = debt_row.paid_installments,
                interest_free = true,
                monthly_interest_rate = 0,
                penalty_rate = 0,
                daily_late_interest_rate = 0,
                updated_at = now()
            where id = selected_debt_id;
        end if;

        -- Garante que existe o movimento principal.
        if not exists (
            select 1
            from public.pf_debt_movements movement
            where movement.debt_id = selected_debt_id
              and movement.movement_type = 'principal'
        ) then
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
                selected_household_id,
                selected_debt_id,
                'principal',
                debt_row.original_amount,
                current_date,
                'Valor inicial da dívida',
                selected_owner_id
            );
        end if;

        -- Consolida as parcelas históricas já pagas.
        if calculated_paid_amount > 0
           and not exists (
               select 1
               from public.pf_debt_movements movement
               where movement.debt_id = selected_debt_id
                 and movement.movement_type = 'payment'
                 and movement.notes =
                     'Importação inicial das parcelas já pagas'
           ) then
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
                selected_household_id,
                selected_debt_id,
                'payment',
                calculated_paid_amount,
                current_date,
                'Importação inicial das parcelas já pagas',
                selected_owner_id
            );
        end if;
    end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';