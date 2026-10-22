-- Opcional: executar com postgres apos 044. Testes em grupo temporario; tudo e desfeito.
begin;
do $test$
declare actor uuid; viewer uuid; h uuid:=gen_random_uuid(); bank uuid:=gen_random_uuid(); own uuid:=gen_random_uuid();
 third uuid:=gen_random_uuid(); reserve uuid:=gen_random_uuid(); cat uuid; g uuid; first_group uuid; sid uuid;
 request uuid; d date:=(now() at time zone 'America/Sao_Paulo')::date;
 m date:=(date_trunc('month',now() at time zone 'America/Sao_Paulo')+interval '1 month')::date;
 versions jsonb; version text; result jsonb; again jsonb; before_balance numeric; failed boolean; count_before integer;
begin
 select user_id into actor from public.pf_household_members where role='owner' order by household_id limit 1;
 if actor is null then raise exception 'Crie um usuario/grupo pela aplicacao antes do teste.'; end if;
 select id into viewer from auth.users where id<>actor limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 insert into public.pf_households(id,name,created_by) values(h,'TESTE FATURAS 044 - ROLLBACK',actor);
 select id into cat from public.pf_categories where household_id=h and kind='expense' limit 1;
 insert into public.pf_accounts(id,household_id,owner_user_id,name,type,balance,available_credit,closing_day,due_day)
 values(bank,h,actor,'Banco teste','checking',1000,null,null,null),
 (own,h,actor,'Cartao pre-pago teste','credit_card',0,200,3,10),
 (third,h,actor,'Titular teste - Cartao emprestado (controle)','credit_card',0,500,2,9),
 (reserve,h,actor,'Reserva separada','investment',300,null,null,null);
 if viewer is not null then insert into public.pf_household_members values(h,viewer,'viewer',now()); end if;

 request:=gen_random_uuid();
 first_group:=public.pf_create_third_party_purchase_v2(h,'Titular teste',null,'Compra A','Loja',10.01,3,m+3,cat,d-1,null,false,request);
 g:=public.pf_create_third_party_purchase_v2(h,'Titular teste',null,'Compra A','Loja',10.01,3,m+3,cat,d-1,null,false,request);
 if g<>first_group or (select count(*) from public.pf_transactions where installment_group_id=g)<>3 then raise exception 'TESTE: compra repetida duplicou parcelas.'; end if;
 if (select sum(amount) from public.pf_transactions where installment_group_id=g)<>10.01 then raise exception 'TESTE: centavos das parcelas divergentes.'; end if;
 if exists(select 1 from public.pf_transactions where installment_group_id=g and (card_statement_id is null or occurred_on<>d-1)) then raise exception 'TESTE: vinculo automatico ou data incorretos.'; end if;
 if (select card_owner_type from public.pf_accounts where id=third)<>'third_party' or (select count(*) from public.pf_accounts where household_id=h and type='credit_card')<>2 then raise exception 'TESTE: cadastro de terceiro duplicado.'; end if;
 perform public.pf_create_third_party_purchase_v2(h,'Titular teste',null,'Compra B','Loja',20,2,m+8,cat,d,null,false,gen_random_uuid());
 perform public.pf_create_third_party_purchase_v2(h,'Titular teste',null,'Compra C','Loja',2,1,m+8,cat,d,null,false,gen_random_uuid());
 if (select balance from public.pf_accounts where id=bank)<>1000 then raise exception 'TESTE: compra no credito alterou banco.'; end if;
 if (select sum(remaining_amount) from public.pf_card_statement_positions where account_id=third and due_date>=m and due_date<m+interval '1 month')<>15.34 then raise exception 'TESTE: resumo mensal duplicou ou perdeu parcelas.'; end if;
 if exists(select 1 from public.pf_obligations_v2 where household_id=h and source_id in(select id from public.pf_transactions where household_id=h and card_statement_id is not null)) then raise exception 'TESTE: parcelas ainda aparecem como contas avulsas.'; end if;

 select jsonb_agg(jsonb_build_object('id',id,'version',version_token) order by id) into versions
 from public.pf_card_statement_dashboard where account_id=third and due_date>=m and due_date<m+interval '1 month';
 request:=gen_random_uuid();
 result:=public.pf_merge_card_statements_v1(third,m,m+8,versions,request);
 again:=public.pf_merge_card_statements_v1(third,m,m+8,versions,request);
 if result<>again then raise exception 'TESTE: unificacao nao idempotente.'; end if;
 sid:=(result->>'id')::uuid;
 if (select total_amount from public.pf_card_statement_positions where id=sid)<>15.34 then raise exception 'TESTE: unificacao alterou total.'; end if;
 if (select sum(remaining_amount) from public.pf_card_statement_positions where account_id=third and due_date>=m+interval '1 month' and due_date<m+interval '2 months')<>13.34 then raise exception 'TESTE: unificacao alterou outro mes.'; end if;

 select version_token into version from public.pf_card_statement_dashboard where id=sid;
 perform public.pf_create_third_party_purchase_v2(h,'Titular teste',null,'Compra nova','Loja',1,1,m+8,cat,d,null,false,gen_random_uuid());
 failed:=false; begin perform public.pf_pay_card_statement_v2(sid,bank,d,gen_random_uuid(),version); exception when others then failed:=true; end;
 if not failed or (select balance from public.pf_accounts where id=bank)<>1000 then raise exception 'TESTE: pagamento com valor desatualizado foi aceito.'; end if;
 select version_token into version from public.pf_card_statement_dashboard where id=sid;
 failed:=false; begin perform public.pf_pay_card_statement_v2(sid,reserve,d,gen_random_uuid(),version); exception when others then failed:=true; end;
 if not failed then raise exception 'TESTE: aceitou reserva como conta pagadora.'; end if;
 failed:=false; begin perform public.pf_pay_card_statement_v2(sid,bank,d+1,gen_random_uuid(),version); exception when others then failed:=true; end;
 if not failed then raise exception 'TESTE: aceitou pagamento futuro.'; end if;
 if viewer is not null then
  perform set_config('request.jwt.claim.sub',viewer::text,true);
  failed:=false; begin perform public.pf_pay_card_statement_v2(sid,bank,d,gen_random_uuid(),version); exception when others then failed:=true; end;
  if not failed then raise exception 'TESTE: viewer conseguiu pagar fatura.'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
 end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 failed:=false; begin perform public.pf_pay_card_statement_v2(sid,bank,d,gen_random_uuid(),version); exception when others then failed:=true; end;
 if not failed then raise exception 'TESTE: outro usuario conseguiu pagar fatura.'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);

 request:=gen_random_uuid();
 result:=public.pf_pay_card_statement_v2(sid,bank,d,request,version);
 again:=public.pf_pay_card_statement_v2(sid,bank,d,request,version);
 if result<>again or (result->>'amount')::numeric<>16.34 then raise exception 'TESTE: recibo incorreto ou nao idempotente.'; end if;
 if (select balance from public.pf_accounts where id=bank)<>983.66 then raise exception 'TESTE: banco nao debitou exatamente uma vez.'; end if;
 if (select count(*) from public.pf_transactions where household_id=h and metadata->>'origin'='card_statement_payment')<>1 then raise exception 'TESTE: duplicou pagamento.'; end if;
 if exists(select 1 from public.pf_transactions where card_statement_id=sid and status<>'paid') or (select remaining_amount from public.pf_card_statement_positions where id=sid)<>0 then raise exception 'TESTE: baixa incompleta.'; end if;
 if (select balance from public.pf_accounts where id=reserve)<>300 or (select available_credit from public.pf_accounts where id=third)<>500 then raise exception 'TESTE: pagamento alterou reserva ou limite.'; end if;
 failed:=false; begin perform public.pf_pay_card_statement_v2(sid,bank,d-1,request,version); exception when others then failed:=true; end;
 if not failed then raise exception 'TESTE: reutilizou requisicao com dados diferentes.'; end if;
 failed:=false; begin perform public.pf_create_third_party_purchase_v2(h,'Titular teste',null,'Compra na fatura paga','Loja',1,1,m+8,cat,d,null,false,gen_random_uuid()); exception when others then failed:=true; end;
 if not failed then raise exception 'TESTE: nova compra entrou em fatura paga.'; end if;

 -- Cartao proprio: parte sem detalhamento, previsao fora da fatura e limite pre-pago preservado.
 sid:=public.pf_reconcile_card_v1(own,m+9,100,0.86,'Fatura pre-paga conferida');
 perform public.pf_create_card_purchase_v2(h,own,'Item ja incluido','Loja',30,1,m+9,cat,null,d,true,false,null,null,false,gen_random_uuid());
 select version_token into version from public.pf_card_statement_dashboard where id=sid;
 request:=gen_random_uuid();
 before_balance:=(select balance from public.pf_accounts where id=bank);
 perform public.pf_pay_card_statement_v2(sid,bank,d,request,version);
 perform public.pf_pay_card_statement_v2(sid,bank,d,request,version);
 if (select balance from public.pf_accounts where id=bank)<>before_balance-100 then raise exception 'TESTE: saldo sem detalhamento foi cobrado duas vezes.'; end if;
 if (select available_credit from public.pf_accounts where id=own)<>0.86 then raise exception 'TESTE: inventou liberacao de credito no pre-pago.'; end if;
 if (select total_amount from public.pf_card_statement_positions where id=sid)<>100 or (select remaining_amount from public.pf_card_statement_positions where id=sid)<>0 then raise exception 'TESTE: fatura propria nao conservou o total.'; end if;
 sid:=public.pf_reconcile_card_v1(own,(m+interval '1 month')::date+9,5,0.86,'Fatura conferida para cliente antigo');
 request:=gen_random_uuid();before_balance:=(select balance from public.pf_accounts where id=bank);
 perform public.pf_pay_card_statement_v1(sid,bank,d,request);
 perform public.pf_pay_card_statement_v1(sid,bank,d,request);
 if (select balance from public.pf_accounts where id=bank)<>before_balance-5 or (select available_credit from public.pf_accounts where id=own)<>0.86 then raise exception 'TESTE: cliente antigo duplicou pagamento ou liberou credito.'; end if;

 -- Edicao de parcela de terceiro deve mover tambem o vinculo de fatura.
 select id into g from public.pf_transactions where installment_group_id=first_group and installment_number=2;
 perform public.pf_manage_installments_v1(h,first_group,jsonb_build_array(jsonb_build_object('id',g,'amount',3.34,'due_date',(m+interval '1 month')::date+8)),false,null);
 if exists(select 1 from public.pf_transactions t join public.pf_card_statements s on s.id=t.card_statement_id where t.id=g and t.due_date<>s.due_date) then raise exception 'TESTE: edicao deixou parcela em outra fatura.'; end if;
 if has_function_privilege('anon','public.pf_pay_card_statement_v2(uuid,uuid,date,uuid,text)','execute') or
    has_function_privilege('authenticated','public.pf_ensure_third_party_card_v1(uuid,text,text,date)','execute') then raise exception 'TESTE: funcao interna exposta.'; end if;
 raise notice 'OK: agrupamento, centavos, vencimentos, idempotencia, versao, permissoes, baixa e limites validados. Tudo sera desfeito.';
end $test$;
rollback;
