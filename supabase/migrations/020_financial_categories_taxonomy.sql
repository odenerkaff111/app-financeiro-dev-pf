begin;

-- Atualiza a taxonomia de categorias sem perder referências históricas.
-- Categorias antigas que ficaram genéricas são consolidadas em uma categoria-alvo.

create or replace function public.pf_merge_expense_category(
    target_household_id uuid,
    source_name text,
    destination_name text,
    destination_group_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    source_category_id uuid;
    destination_category_id uuid;
begin
    select id
      into source_category_id
      from public.pf_categories
     where household_id = target_household_id
       and kind = 'expense'
       and name = source_name
     limit 1;

    select id
      into destination_category_id
      from public.pf_categories
     where household_id = target_household_id
       and kind = 'expense'
       and name = destination_name
     limit 1;

    if source_category_id is null then
        if destination_category_id is null then
            insert into public.pf_categories (
                household_id,
                name,
                kind,
                group_type,
                is_system
            )
            values (
                target_household_id,
                destination_name,
                'expense',
                destination_group_type,
                true
            );
        end if;
        return;
    end if;

    if destination_category_id is null then
        update public.pf_categories
           set name = destination_name,
               group_type = destination_group_type,
               is_system = true
         where id = source_category_id;
        return;
    end if;

    if source_category_id = destination_category_id then
        update public.pf_categories
           set group_type = destination_group_type,
               is_system = true
         where id = destination_category_id;
        return;
    end if;

    -- Orçamentos possuem unique(household_id, category_id, month), então
    -- consolidamos os valores antes de trocar/remover a categoria antiga.
    insert into public.pf_budgets (
        household_id,
        category_id,
        month,
        amount,
        created_by,
        created_at,
        updated_at
    )
    select
        household_id,
        destination_category_id,
        month,
        amount,
        created_by,
        created_at,
        now()
    from public.pf_budgets
    where household_id = target_household_id
      and category_id = source_category_id
    on conflict (household_id, category_id, month)
    do update
       set amount = public.pf_budgets.amount + excluded.amount,
           updated_at = now();

    delete from public.pf_budgets
     where household_id = target_household_id
       and category_id = source_category_id;

    update public.pf_transactions
       set category_id = destination_category_id
     where household_id = target_household_id
       and category_id = source_category_id;

    update public.pf_recurring_templates
       set category_id = destination_category_id
     where household_id = target_household_id
       and category_id = source_category_id;

    update public.pf_commitments
       set category_id = destination_category_id
     where household_id = target_household_id
       and category_id = source_category_id;

    update public.pf_categories
       set parent_id = destination_category_id
     where household_id = target_household_id
       and parent_id = source_category_id;

    delete from public.pf_categories
     where id = source_category_id;

    update public.pf_categories
       set group_type = destination_group_type,
           is_system = true
     where id = destination_category_id;
end;
$$;

do $$
declare
    household_record record;
begin
    for household_record in
        select id from public.pf_households
    loop
        -- Consolida/renomeia as categorias antigas preservando dados já lançados.
        perform public.pf_merge_expense_category(
            household_record.id,
            'Compras',
            'Alimentação',
            'essential'
        );

        perform public.pf_merge_expense_category(
            household_record.id,
            'Supermercado',
            'Alimentação',
            'essential'
        );

        perform public.pf_merge_expense_category(
            household_record.id,
            'Lazer',
            'Outros',
            'other'
        );

        perform public.pf_merge_expense_category(
            household_record.id,
            'Contas da casa',
            'Outros',
            'other'
        );

        perform public.pf_merge_expense_category(
            household_record.id,
            'Filhos',
            'Outros',
            'other'
        );

        perform public.pf_merge_expense_category(
            household_record.id,
            'Impostos pessoais',
            'Imposto',
            'essential'
        );

        perform public.pf_merge_expense_category(
            household_record.id,
            'Transporte',
            'Gasolina',
            'essential'
        );

        insert into public.pf_categories (
            household_id,
            name,
            kind,
            group_type,
            is_system
        )
        values
            (household_record.id, 'Assinaturas', 'expense', 'lifestyle', true),
            (household_record.id, 'Alimentação', 'expense', 'essential', true),
            (household_record.id, 'Luz', 'expense', 'essential', true),
            (household_record.id, 'Água', 'expense', 'essential', true),
            (household_record.id, 'Internet', 'expense', 'essential', true),
            (household_record.id, 'Judô', 'expense', 'essential', true),
            (household_record.id, 'Academia', 'expense', 'essential', true),
            (household_record.id, 'Diversão', 'expense', 'lifestyle', true),
            (household_record.id, 'Dívidas', 'expense', 'debt', true),
            (household_record.id, 'Doação', 'expense', 'other', true),
            (household_record.id, 'Educação', 'expense', 'essential', true),
            (household_record.id, 'Escola', 'expense', 'essential', true),
            (household_record.id, 'Imposto', 'expense', 'essential', true),
            (household_record.id, 'Outros', 'expense', 'other', true),
            (household_record.id, 'Moradia', 'expense', 'essential', true),
            (household_record.id, 'Aluguel', 'expense', 'essential', true),
            (household_record.id, 'Restaurantes e delivery', 'expense', 'lifestyle', true),
            (household_record.id, 'Saúde', 'expense', 'essential', true),
            (household_record.id, 'Plano de saúde', 'expense', 'essential', true),
            (household_record.id, 'Gasolina', 'expense', 'essential', true)
        on conflict (household_id, name, kind)
        do update
           set group_type = excluded.group_type,
               is_system = true;
    end loop;
end;
$$;

-- Novos grupos familiares já nascem com a taxonomia atual.
create or replace function public.pf_after_household_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.pf_household_members (
        household_id,
        user_id,
        role
    )
    values (
        new.id,
        new.created_by,
        'owner'
    )
    on conflict do nothing;

    insert into public.pf_categories (
        household_id,
        name,
        kind,
        group_type,
        icon,
        is_system
    )
    values
        (new.id, 'Salário', 'income', 'income', 'wallet-cards', true),
        (new.id, 'Renda extra', 'income', 'income', 'circle-plus', true),
        (new.id, 'Reembolso', 'income', 'income', 'rotate-ccw', true),
        (new.id, 'Rendimentos', 'income', 'income', 'trending-up', true),

        (new.id, 'Assinaturas', 'expense', 'lifestyle', 'repeat', true),
        (new.id, 'Alimentação', 'expense', 'essential', 'utensils', true),
        (new.id, 'Luz', 'expense', 'essential', 'zap', true),
        (new.id, 'Água', 'expense', 'essential', 'droplets', true),
        (new.id, 'Internet', 'expense', 'essential', 'wifi', true),
        (new.id, 'Judô', 'expense', 'essential', 'activity', true),
        (new.id, 'Academia', 'expense', 'essential', 'dumbbell', true),
        (new.id, 'Diversão', 'expense', 'lifestyle', 'party-popper', true),
        (new.id, 'Dívidas', 'expense', 'debt', 'hand-coins', true),
        (new.id, 'Doação', 'expense', 'other', 'heart-handshake', true),
        (new.id, 'Educação', 'expense', 'essential', 'graduation-cap', true),
        (new.id, 'Escola', 'expense', 'essential', 'school', true),
        (new.id, 'Imposto', 'expense', 'essential', 'landmark', true),
        (new.id, 'Outros', 'expense', 'other', 'ellipsis', true),
        (new.id, 'Moradia', 'expense', 'essential', 'house', true),
        (new.id, 'Aluguel', 'expense', 'essential', 'key-round', true),
        (new.id, 'Restaurantes e delivery', 'expense', 'lifestyle', 'utensils', true),
        (new.id, 'Saúde', 'expense', 'essential', 'heart-pulse', true),
        (new.id, 'Plano de saúde', 'expense', 'essential', 'shield-plus', true),
        (new.id, 'Gasolina', 'expense', 'essential', 'fuel', true),

        (new.id, 'Pagamento de dívida', 'debt', 'debt', 'hand-coins', true),
        (new.id, 'Juros e multas', 'debt', 'debt', 'triangle-alert', true),
        (new.id, 'Aportes e investimentos', 'investment', 'investment', 'chart-no-axes-combined', true)
    on conflict (household_id, name, kind) do nothing;

    return new;
end;
$$;

drop function public.pf_merge_expense_category(uuid, text, text, text);

commit;
