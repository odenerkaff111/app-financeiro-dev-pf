begin;

-- Amplia os tipos de ações aceitos pelo assistente.
do $$
declare
    selected_constraint record;
    action_type_attnum smallint;
begin
    select attribute.attnum
    into action_type_attnum
    from pg_attribute attribute
    where attribute.attrelid = 'public.pf_ai_messages'::regclass
      and attribute.attname = 'action_type'
      and not attribute.attisdropped;

    for selected_constraint in
        select constraint_record.conname
        from pg_constraint constraint_record
        where constraint_record.conrelid = 'public.pf_ai_messages'::regclass
          and constraint_record.contype = 'c'
          and action_type_attnum = any(constraint_record.conkey)
    loop
        execute format(
            'alter table public.pf_ai_messages drop constraint %I',
            selected_constraint.conname
        );
    end loop;
end;
$$;

alter table public.pf_ai_messages
    add constraint pf_ai_messages_action_type_check
    check (
        action_type is null
        or action_type in (
            'create_transaction',
            'create_transfer',
            'register_debt_payment',
            'register_debt_received',
            'register_variable_recurring',
            'import_statement',
            'create_commitment',
            'register_commitment_settlement',
            'create_other_debt'
        )
    );

-- As tabelas do motor financeiro foram criadas depois da migration
-- original de auditoria. Liga as duas ao mesmo log central.
do $$
begin
    if to_regprocedure('public.pf_capture_audit()') is not null then
        if to_regclass('public.pf_commitments') is not null then
            execute 'drop trigger if exists pf_audit_changes_trigger on public.pf_commitments';
            execute 'create trigger pf_audit_changes_trigger after insert or update or delete on public.pf_commitments for each row execute function public.pf_capture_audit()';
        end if;

        if to_regclass('public.pf_commitment_settlements') is not null then
            execute 'drop trigger if exists pf_audit_changes_trigger on public.pf_commitment_settlements';
            execute 'create trigger pf_audit_changes_trigger after insert or update or delete on public.pf_commitment_settlements for each row execute function public.pf_capture_audit()';
        end if;
    end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
