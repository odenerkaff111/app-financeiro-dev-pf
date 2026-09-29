-- Execute com postgres DEPOIS de 038/039 e ANTES da carga privada 040.
-- Usa um grupo temporario, valida invariantes e termina com ROLLBACK.
-- Nao envia WhatsApp, nao altera dados financeiros persistentes.
-- Se houver erro, pare: nao execute a carga de dados ate verificar a mensagem.
begin;
do $test$
declare actor uuid;h uuid:=gen_random_uuid();bank uuid:=gen_random_uuid();card uuid:=gen_random_uuid();cat uuid:=gen_random_uuid();
 loan uuid;request uuid:=gen_random_uuid();repay_request uuid:=gen_random_uuid();sid uuid;purchase uuid;purchase_request uuid:=gen_random_uuid();tid uuid;
 d date:=(now() at time zone 'America/Sao_Paulo')::date;bill_due date;sub_due date;state jsonb;bad boolean;available_before numeric;sub_group uuid;
begin
 select user_id into actor from public.pf_household_members where role='owner' limit 1;
 if actor is null then raise exception 'Crie primeiro um usuario/grupo pela aplicacao.'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 insert into public.pf_households(id,name,created_by) values(h,'TESTE TEMPORARIO - ROLLBACK',actor);
 insert into public.pf_household_members(household_id,user_id,role) values(h,actor,'owner') on conflict do nothing;
 insert into public.pf_accounts(id,household_id,owner_user_id,name,type,balance,credit_limit,available_credit,closing_day,due_day)
 values(bank,h,actor,'Banco de teste','checking',1000,null,null,null,null),(card,h,actor,'Cartao de teste','credit_card',0,1000,1000,3,10);
 insert into public.pf_categories(id,household_id,name,kind,group_type) values(cat,h,'Categoria de teste','expense','other');
 bill_due:=public.pf_recurring_due_date(10,(date_trunc('month',d)+interval '1 month')::date);
 sub_due:=public.pf_recurring_due_date(10,(date_trunc('month',d)+interval '2 months')::date);

 loan:=public.pf_create_personal_loan_v1(h,'Pessoa teste',100,bank,d,d+10,false,null,request);
 if (select balance from public.pf_accounts where id=bank)<>900 then raise exception 'TESTE: concessao nao debitou exatamente 100.'; end if;
 if public.pf_create_personal_loan_v1(h,'Pessoa teste',100,bank,d,d+10,false,null,request)<>loan then raise exception 'TESTE: concessao nao idempotente.'; end if;
 if (select balance from public.pf_accounts where id=bank)<>900 then raise exception 'TESTE: emprestimo duplicou debito.'; end if;
 perform public.pf_receive_personal_loan_v1(loan,bank,40,d,repay_request);
 perform public.pf_receive_personal_loan_v1(loan,bank,40,d,repay_request);
 if (select balance from public.pf_accounts where id=bank)<>940 or (select remaining_amount from public.pf_personal_loan_positions where id=loan)<>60 then raise exception 'TESTE: recebimento parcial/idempotencia incorretos.'; end if;
 bad:=false;begin perform public.pf_receive_personal_loan_v1(loan,bank,61,d,gen_random_uuid());exception when others then bad:=true;end;
 if not bad then raise exception 'TESTE: aceitou devolucao maior que o principal.'; end if;

 perform public.pf_reconcile_account_v1(bank,1000,'Saldo confirmado em teste',940);
 if (select balance from public.pf_accounts where id=bank)<>1000 then raise exception 'TESTE: conciliacao incorreta.'; end if;
 perform public.pf_create_personal_loan_v1(h,'Outra pessoa',20,bank,d,null,false,null,gen_random_uuid());
 if (select balance from public.pf_accounts where id=bank)<>980 then raise exception 'TESTE: movimento novo apos conciliacao nao afeta banco.'; end if;

 sid:=public.pf_reconcile_card_v1(card,bill_due,120,880,'Fatura confirmada em teste');
 purchase:=public.pf_create_card_purchase_v2(h,card,'Compra antiga','Loja',30,1,bill_due,cat,null,null,true,false,null,null,false,purchase_request);
 perform public.pf_create_card_purchase_v2(h,card,'Compra antiga','Loja',30,1,bill_due,cat,null,null,true,false,null,null,false,purchase_request);
 if (select total_amount from public.pf_card_statement_positions where id=sid)<>120 or (select unallocated_amount from public.pf_card_statements where id=sid)<>90 then raise exception 'TESTE: detalhamento duplicou fatura.'; end if;
 if (select available_credit from public.pf_accounts where id=card)<>880 then raise exception 'TESTE: detalhamento consumiu limite novamente.'; end if;
 perform public.pf_create_card_purchase_v2(h,card,'Compra nova','Loja',10,1,bill_due,cat,null,d,false,false,null,null,false,gen_random_uuid());
 if (select total_amount from public.pf_card_statement_positions where id=sid)<>130 or (select available_credit from public.pf_accounts where id=card)<>870 then raise exception 'TESTE: compra nova nao alterou fatura/limite uma vez.'; end if;
 request:=gen_random_uuid();
 perform public.pf_pay_card_statement_v1(sid,bank,d,request);
 perform public.pf_pay_card_statement_v1(sid,bank,d,request);
 if (select balance from public.pf_accounts where id=bank)<>850 then raise exception 'TESTE: pagamento duplicou debito da conta.'; end if;
 if (select remaining_amount from public.pf_card_statement_positions where id=sid)<>0 or (select balance from public.pf_accounts where id=card)<>0 then raise exception 'TESTE: fatura nao foi quitada.'; end if;
 if (select available_credit from public.pf_accounts where id=card)<>1000 then raise exception 'TESTE: limite nao liberado corretamente.'; end if;
 bad:=false;begin
  perform public.pf_manage_installments_v1(h,purchase,jsonb_build_array(jsonb_build_object('id',(select id from public.pf_transactions where installment_group_id=purchase limit 1),'amount',25,'due_date',bill_due)),false,null);
 exception when others then bad:=true;end;
 if not bad then raise exception 'TESTE: editor permitiu alterar parcela paga.'; end if;

 sub_group:=public.pf_create_card_purchase_v2(h,card,'Assinatura teste','Servico',25,1,sub_due,cat,null,d,false,true,null,null,false,gen_random_uuid());
 select recurrence_key into tid from public.pf_transactions where installment_group_id=sub_group limit 1;
 if tid is null or (select credit_card_account_id from public.pf_recurring_templates where id=tid)<>card then raise exception 'TESTE: assinatura nao foi vinculada ao cartao.'; end if;
 select available_credit into available_before from public.pf_accounts where id=card;
 perform public.pf_generate_recurring_transactions((date_trunc('month',d)+interval '1 month')::date);
 perform public.pf_generate_recurring_transactions((date_trunc('month',d)+interval '1 month')::date);
 if (select count(*) from public.pf_transactions where recurrence_key=tid and card_forecast)<>1 then raise exception 'TESTE: gerador duplicou a previsao mensal.'; end if;
 if (select available_credit from public.pf_accounts where id=card)<>available_before then raise exception 'TESTE: previsao consumiu credito.'; end if;
 update public.pf_recurring_templates set amount=26 where id=tid;
 if exists(select 1 from public.pf_transactions where recurrence_key=tid and card_forecast and amount<>26) then raise exception 'TESTE: edicao da recorrencia nao atualizou previsoes.'; end if;
 if (select amount from public.pf_transactions where installment_group_id=sub_group)<>25 then raise exception 'TESTE: edicao alterou cobranca ja confirmada.'; end if;

 state:=public.pf_daily_answer_v1(h,'no');
 if not (state->>'blocked')::boolean then raise exception 'TESTE: resposta Nao nao bloqueou.'; end if;
 bad:=false;begin perform public.pf_daily_answer_v1(h,'registered');exception when others then bad:=true;end;
 if not bad then raise exception 'TESTE: desbloqueou sem nova atividade.'; end if;
 bad:=false;begin perform public.pf_daily_answer_v1(h,'no_movements');exception when others then bad:=true;end;
 if not bad then raise exception 'TESTE: permitiu burlar Nao com sem movimentos.'; end if;
 perform public.pf_reconcile_account_v1(bank,850,'Conferencia real apos responder Nao',850);
 state:=public.pf_daily_answer_v1(h,'registered');
 if (state->>'blocked')::boolean then raise exception 'TESTE: conferencia salva nao desbloqueou.'; end if;
 bad:=false;begin perform public.pf_save_reminder_settings_v1(h,array['22:01'],'America/Sao_Paulo',false,null,false);exception when others then bad:=true;end;
 if not bad then raise exception 'TESTE: horario fora do intervalo aceito.'; end if;
 perform public.pf_save_reminder_settings_v1(h,array['22:00','08:00','12:00','08:00'],'America/Sao_Paulo',false,null,false);
 if (select times from public.pf_reminder_settings where household_id=h and user_id=actor)<>array['08:00','12:00','22:00'] then raise exception 'TESTE: horarios nao normalizados.'; end if;
 bad:=false;begin perform public.pf_create_personal_loan_v1(gen_random_uuid(),'Sem acesso',10,null,null,null,true,null,gen_random_uuid());exception when others then bad:=true;end;
 if not bad then raise exception 'TESTE: escrita em grupo nao autorizado.'; end if;
 if has_function_privilege('authenticated','public.pf_control_write(uuid)','execute') or has_function_privilege('anon','public.pf_claim_reminders_v1()','execute') then raise exception 'TESTE: funcao interna exposta.'; end if;
 raise notice 'TESTES SQL CONCLUIDOS. O ROLLBACK seguinte remove todos os registros temporarios.';
end;
$test$;
rollback;
