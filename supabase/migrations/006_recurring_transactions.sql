begin;

-- =========================================================
-- MODELOS DE LANÇAMENTOS RECORRENTES
-- =========================================================

create table if not exists public.pf_recurring_templates (
    id uuid primary key default gen_random_uuid(),

    household_id uuid not null
        references public.pf_households(id)
        on delete cascade,

    created_by uuid not null default auth.uid()
        references auth.users(id),

    account_id uuid not null
        references public.pf_accounts(id)
        on delete restrict,

    category_id uuid
        references public.pf_categories(id)
        on delete set null,

    type text not null
        check (type in ('income', 'expense')),

    description text not null,
    merchant text,

    amount numeric(14, 2)
        check (
            amount is null
            or amount > 0
        ),

    day_of_month integer not null
        check (
            day_of_month between 1 and 31
        ),

    is_variable boolean not null default false,
    auto_generate boolean not null default true,

    starts_on date not null
        default date_trunc(
            'month',
            current_date
        )::date,

    ends_on date,

    is_active boolean not null default true,

    import_key text,
    notes text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint pf_recurring_templates_dates_valid
        check (
            ends_on is null
            or ends_on >= starts_on
        ),

    constraint pf_recurring_templates_amount_valid
        check (
            is_variable = true
            or amount is not null
        )
);

create unique index if not exists
pf_recurring_templates_import_key_unique
on public.pf_recurring_templates (
    household_id,
    import_key
)
where import_key is not null;

create index if not exists
pf_recurring_templates_household_active_idx
on public.pf_recurring_templates (
    household_id,
    is_active
);

-- Uma recorrência só pode gerar um lançamento
-- por data de vencimento.
create unique index if not exists
pf_transactions_recurring_due_unique
on public.pf_transactions (
    household_id,
    recurrence_key,
    due_date
)
where recurrence_key is not null;

-- =========================================================
-- RLS
-- =========================================================

alter table public.pf_recurring_templates
enable row level security;

drop policy if exists
"pf_recurring_templates_select"
on public.pf_recurring_templates;

create policy
"pf_recurring_templates_select"
on public.pf_recurring_templates
for select
to authenticated
using (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_recurring_templates.household_id
          and member.user_id = auth.uid()
    )
);

drop policy if exists
"pf_recurring_templates_insert"
on public.pf_recurring_templates;

create policy
"pf_recurring_templates_insert"
on public.pf_recurring_templates
for insert
to authenticated
with check (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_recurring_templates.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
);

drop policy if exists
"pf_recurring_templates_update"
on public.pf_recurring_templates;

create policy
"pf_recurring_templates_update"
on public.pf_recurring_templates
for update
to authenticated
using (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_recurring_templates.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
)
with check (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_recurring_templates.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
);

drop policy if exists
"pf_recurring_templates_delete"
on public.pf_recurring_templates;

create policy
"pf_recurring_templates_delete"
on public.pf_recurring_templates
for delete
to authenticated
using (
    exists (
        select 1
        from public.pf_household_members member
        where member.household_id =
            pf_recurring_templates.household_id
          and member.user_id = auth.uid()
          and member.role in (
              'owner',
              'member'
          )
    )
);

grant select, insert, update, delete
on public.pf_recurring_templates
to authenticated;

-- =========================================================
-- CALCULA O DIA REAL DO VENCIMENTO
--
-- Exemplo:
-- recorrência no dia 31 em fevereiro
-- será criada no último dia de fevereiro.
-- =========================================================

create or replace function public.pf_recurring_due_date(
    target_day integer,
    target_month date
)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
    month_start date;
    month_end date;
    real_day integer;
begin
    month_start :=
        date_trunc(
            'month',
            target_month
        )::date;

    month_end :=
        (
            month_start
            + interval '1 month'
            - interval '1 day'
        )::date;

    real_day := least(
        target_day,
        extract(
            day from month_end
        )::integer
    );

    return make_date(
        extract(
            year from month_start
        )::integer,

        extract(
            month from month_start
        )::integer,

        real_day
    );
end;
$$;

-- =========================================================
-- GERA OS LANÇAMENTOS FIXOS DO MÊS
-- =========================================================

create or replace function
public.pf_generate_recurring_transactions(
    target_month date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;
    month_start date;
    month_end date;

    template_row
        public.pf_recurring_templates%rowtype;

    calculated_due_date date;
    generated_count integer := 0;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception
            'Usuário não autenticado.';
    end if;

    month_start :=
        date_trunc(
            'month',
            coalesce(
                target_month,
                current_date
            )
        )::date;

    month_end :=
        (
            month_start
            + interval '1 month'
            - interval '1 day'
        )::date;

    for template_row in
        select template.*
        from public.pf_recurring_templates template

        inner join public.pf_household_members member
            on member.household_id =
                template.household_id
           and member.user_id =
                current_user_id

        where template.is_active = true
          and template.auto_generate = true
          and template.is_variable = false
          and template.amount is not null

          and template.starts_on <= month_end

          and (
              template.ends_on is null
              or template.ends_on >= month_start
          )
    loop
        calculated_due_date :=
            public.pf_recurring_due_date(
                template_row.day_of_month,
                month_start
            );

        if not exists (
            select 1
            from public.pf_transactions transaction
            where transaction.household_id =
                template_row.household_id

              and transaction.recurrence_key =
                template_row.id

              and transaction.due_date =
                calculated_due_date
        ) then
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

                recurrence_key,
                source,

                notes,
                metadata
            )
            values (
                template_row.household_id,
                template_row.account_id,
                template_row.category_id,
                current_user_id,
                current_user_id,

                template_row.type,
                'planned',

                template_row.description,
                template_row.merchant,

                template_row.amount,
                template_row.amount,

                calculated_due_date,
                calculated_due_date,

                template_row.id,
                'manual',

                template_row.notes,

                jsonb_build_object(
                    'origin',
                    'recurring_template',

                    'template_id',
                    template_row.id,

                    'generated_for',
                    to_char(
                        month_start,
                        'YYYY-MM'
                    )
                )
            );

            generated_count :=
                generated_count + 1;
        end if;
    end loop;

    return generated_count;
end;
$$;

revoke all
on function public.pf_generate_recurring_transactions(date)
from public;

grant execute
on function public.pf_generate_recurring_transactions(date)
to authenticated;

-- =========================================================
-- REGISTRA VALOR DE RECORRÊNCIA VARIÁVEL
-- =========================================================

create or replace function
public.pf_register_variable_recurring(
    target_template_id uuid,
    target_amount numeric,
    target_month date default current_date,
    target_status text default 'planned'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid;

    selected_template
        public.pf_recurring_templates%rowtype;

    month_start date;
    calculated_due_date date;

    existing_transaction_id uuid;
    result_transaction_id uuid;
begin
    current_user_id := auth.uid();

    if current_user_id is null then
        raise exception
            'Usuário não autenticado.';
    end if;

    if target_amount is null
       or target_amount <= 0 then
        raise exception
            'O valor precisa ser maior que zero.';
    end if;

    if target_status not in (
        'planned',
        'paid'
    ) then
        raise exception
            'Status inválido.';
    end if;

    select template.*
    into selected_template
    from public.pf_recurring_templates template

    inner join public.pf_household_members member
        on member.household_id =
            template.household_id
       and member.user_id =
            current_user_id

    where template.id =
        target_template_id

    limit 1;

    if not found then
        raise exception
            'Recorrência não encontrada.';
    end if;

    month_start :=
        date_trunc(
            'month',
            coalesce(
                target_month,
                current_date
            )
        )::date;

    calculated_due_date :=
        public.pf_recurring_due_date(
            selected_template.day_of_month,
            month_start
        );

    select transaction.id
    into existing_transaction_id
    from public.pf_transactions transaction

    where transaction.household_id =
        selected_template.household_id

      and transaction.recurrence_key =
        selected_template.id

      and transaction.due_date =
        calculated_due_date

    limit 1;

    if existing_transaction_id is null then
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

            recurrence_key,
            source,

            notes,
            metadata
        )
        values (
            selected_template.household_id,
            selected_template.account_id,
            selected_template.category_id,
            current_user_id,
            current_user_id,

            selected_template.type,
            target_status,

            selected_template.description,
            selected_template.merchant,

            target_amount,
            target_amount,

            calculated_due_date,
            calculated_due_date,

            case
                when target_status = 'paid'
                    then now()
                else null
            end,

            selected_template.id,
            'manual',

            selected_template.notes,

            jsonb_build_object(
                'origin',
                'variable_recurring_template',

                'template_id',
                selected_template.id,

                'generated_for',
                to_char(
                    month_start,
                    'YYYY-MM'
                )
            )
        )
        returning id
        into result_transaction_id;
    else
        update public.pf_transactions
        set
            amount = target_amount,
            original_amount = target_amount,
            status = target_status,

            paid_at = case
                when target_status = 'paid'
                    then now()
                else null
            end,

            updated_at = now()

        where id = existing_transaction_id

        returning id
        into result_transaction_id;
    end if;

    return result_transaction_id;
end;
$$;

revoke all
on function public.pf_register_variable_recurring(
    uuid,
    numeric,
    date,
    text
)
from public;

grant execute
on function public.pf_register_variable_recurring(
    uuid,
    numeric,
    date,
    text
)
to authenticated;

-- =========================================================
-- CATEGORIAS E RECORRÊNCIAS INICIAIS
-- =========================================================

do $$
declare
    selected_household_id uuid;
    selected_owner_id uuid;
    selected_account_id uuid;

    salary_category_id uuid;
    housing_category_id uuid;
    home_category_id uuid;
    education_category_id uuid;
    health_category_id uuid;
    debt_category_id uuid;
    donation_category_id uuid;
    entertainment_category_id uuid;

    current_month_start date;
    next_month_start date;
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
            'Nenhum grupo familiar encontrado.';
    end if;

    select account.id
    into selected_account_id
    from public.pf_accounts account

    where account.household_id =
        selected_household_id

      and account.is_active = true

      and account.type not in (
          'credit_card',
          'investment'
      )

    order by
        case
            when lower(account.name)
                like '%santander%'
                then 0

            when lower(
                coalesce(
                    account.institution_name,
                    ''
                )
            ) like '%santander%'
                then 0

            else 1
        end,

        account.created_at asc

    limit 1;

    if selected_account_id is null then
        raise exception
            'Nenhuma conta ativa foi encontrada para vincular as recorrências.';
    end if;

    current_month_start :=
        date_trunc(
            'month',
            current_date
        )::date;

    next_month_start :=
        (
            current_month_start
            + interval '1 month'
        )::date;

    insert into public.pf_categories (
        household_id,
        name,
        kind,
        group_type,
        is_system
    )
    values
        (
            selected_household_id,
            'Salário',
            'income',
            'income',
            true
        ),
        (
            selected_household_id,
            'Moradia',
            'expense',
            'essential',
            true
        ),
        (
            selected_household_id,
            'Contas da casa',
            'expense',
            'essential',
            true
        ),
        (
            selected_household_id,
            'Educação',
            'expense',
            'essential',
            true
        ),
        (
            selected_household_id,
            'Saúde',
            'expense',
            'essential',
            true
        ),
        (
            selected_household_id,
            'Dívidas',
            'expense',
            'debt',
            true
        ),
        (
            selected_household_id,
            'Doação',
            'expense',
            'other',
            true
        ),
        (
            selected_household_id,
            'Diversão',
            'expense',
            'lifestyle',
            true
        )

    on conflict (
        household_id,
        name,
        kind
    )
    do update
    set
        group_type =
            excluded.group_type,

        is_system = true;

    select id
    into salary_category_id
    from public.pf_categories
    where household_id =
        selected_household_id
      and name = 'Salário'
      and kind = 'income';

    select id
    into housing_category_id
    from public.pf_categories
    where household_id =
        selected_household_id
      and name = 'Moradia'
      and kind = 'expense';

    select id
    into home_category_id
    from public.pf_categories
    where household_id =
        selected_household_id
      and name = 'Contas da casa'
      and kind = 'expense';

    select id
    into education_category_id
    from public.pf_categories
    where household_id =
        selected_household_id
      and name = 'Educação'
      and kind = 'expense';

    select id
    into health_category_id
    from public.pf_categories
    where household_id =
        selected_household_id
      and name = 'Saúde'
      and kind = 'expense';

    select id
    into debt_category_id
    from public.pf_categories
    where household_id =
        selected_household_id
      and name = 'Dívidas'
      and kind = 'expense';

    select id
    into donation_category_id
    from public.pf_categories
    where household_id =
        selected_household_id
      and name = 'Doação'
      and kind = 'expense';

    select id
    into entertainment_category_id
    from public.pf_categories
    where household_id =
        selected_household_id
      and name = 'Diversão'
      and kind = 'expense';

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
        is_active,

        import_key,
        notes
    )
    values
        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            salary_category_id,

            'income',
            'Salário mensal',
            'Power of Data',
            10000.00,

            5,
            false,
            true,

            next_month_start,
            true,

            'salary-power-of-data',

            'Normalmente recebido entre os dias 3 e 6. O mês atual foi registrado manualmente como R$ 7.500 devido ao adiantamento.'
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            housing_category_id,

            'expense',
            'Aluguel',
            'Sr. Jurandir',
            2600.00,

            6,
            false,
            true,

            current_month_start,
            true,

            'rent-sr-jurandir',

            'Pode ser desativado ou encerrado quando a família deixar o imóvel alugado.'
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            education_category_id,

            'expense',
            'Mensalidade escolar',
            'Ipê Amarelo',
            1271.00,

            10,
            false,
            true,

            current_month_start,
            true,

            'school-ipe-amarelo',

            null
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            education_category_id,

            'expense',
            'Judô',
            'Judô',
            80.00,

            10,
            false,
            true,

            current_month_start,
            true,

            'judo-monthly',

            null
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            donation_category_id,

            'expense',
            'Doação mensal',
            'Doação',
            200.00,

            10,
            false,
            true,

            current_month_start,
            true,

            'monthly-donation',

            'Valor inicial de referência. Pode ser editado posteriormente.'
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            entertainment_category_id,

            'expense',
            'Disney+',
            'Disney+',
            20.00,

            10,
            false,
            true,

            current_month_start,
            true,

            'streaming-disney',

            null
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            home_category_id,

            'expense',
            'Conta de água',
            'Copasa',
            null,

            15,
            true,
            false,

            current_month_start,
            true,

            'water-copasa',

            'O valor varia e deve ser informado a cada mês.'
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            home_category_id,

            'expense',
            'Internet',
            'Vanete',
            115.00,

            15,
            false,
            true,

            current_month_start,
            true,

            'internet-vanete',

            null
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            home_category_id,

            'expense',
            'Conta de luz',
            'Cemig',
            null,

            17,
            true,
            false,

            current_month_start,
            true,

            'electricity-cemig',

            'O valor varia e deve ser informado a cada mês.'
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            health_category_id,

            'expense',
            'Academia',
            'Allp Fit',
            220.00,

            20,
            false,
            true,

            current_month_start,
            true,

            'gym-allp-fit',

            null
        ),

        (
            selected_household_id,
            selected_owner_id,
            selected_account_id,
            debt_category_id,

            'expense',
            'Financiamento do carro',
            'BV',
            1195.00,

            22,
            false,
            true,

            current_month_start,
            true,

            'car-financing-bv',

            null
        )

    on conflict (
        household_id,
        import_key
    )
    where import_key is not null

    do update
    set
        account_id =
            excluded.account_id,

        category_id =
            excluded.category_id,

        type =
            excluded.type,

        description =
            excluded.description,

        merchant =
            excluded.merchant,

        amount =
            excluded.amount,

        day_of_month =
            excluded.day_of_month,

        is_variable =
            excluded.is_variable,

        auto_generate =
            excluded.auto_generate,

        notes =
            excluded.notes,

        updated_at =
            now();
end;
$$;

commit;

notify pgrst, 'reload schema';