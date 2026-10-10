import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled=ts.transpileModule(fs.readFileSync('src/lib/dashboard/summary.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(compiled,{module,exports:module.exports,Intl,Date,Set,Math,Number,Error});
const {summarizeBalances,summarizePeriod,uncommittedBudget,closingFigures,transactionDay}=module.exports;
let count=0;
const test=(name,fn)=>{fn();count++;console.log('OK '+name);};
const sep={start:'2026-09-01',end:'2026-09-30'},oct={start:'2026-10-01',end:'2026-10-31'};
const today='2026-09-17';
const tx=(overrides={})=>({id:'t1',type:'expense',status:'paid',amount:100,occurred_on:'2026-09-17',metadata:{},...overrides});
const sum=(t=[],s=[],l=[],r=sep)=>summarizePeriod(t,s,l,r,today);
const loan={id:'l1',borrower:'Pessoa',remaining_amount:500,due_date:'2026-10-06',cancelled_at:null};
const accounts=[
 {id:'a1',name:'Banco A',type:'checking',balance:'94.44',is_active:true,reconciliation_required:true},
 {id:'a2',name:'Banco B',type:'checking',balance:0.97,is_active:true},
 {id:'a3',name:'Banco C',type:'checking',balance:0,is_active:true},
 {id:'pj',name:'Empresa',type:'checking',balance:0,is_active:true,account_scope:'business'},
 {id:'cc',name:'Cartao',type:'credit_card',balance:360.05,available_credit:113.11,is_active:true},
 {id:'r1',name:'Reserva 1',type:'investment',balance:300.37,is_active:true},
 {id:'r2',name:'Reserva 2',type:'investment',balance:220.19,is_active:true},
 {id:'old',name:'Inativa',type:'investment',balance:300,is_active:false},
];
test('Saldo inclui todas as contas ativas, sem excluir flag antiga',()=>assert.equal(summarizeBalances(accounts).cash,95.41));
test('Limite nao usa fatura e nao se mistura a dinheiro',()=>assert.equal(summarizeBalances(accounts).credit,113.11));
test('Reservas separadas, centavos exatos, conta inativa fora',()=>assert.equal(summarizeBalances(accounts).invested,520.56));
test('Nao adivinha credito quando limite disponivel e nulo',()=>{const s=summarizeBalances([{...accounts[4],available_credit:null}]);assert.equal(s.credit,0);assert.equal(s.unknownCredit,1);});
test('Saldo empresarial ativo nao desaparece',()=>assert.equal(summarizeBalances([{...accounts[3],balance:25000}]).cash,25000));
test('Receita PJ entra no consolidado uma vez',()=>assert.equal(sum([tx({type:'income',financial_scope:'business',amount:25000})]).income,25000));
test('Previsao cancelada nao duplica o recebimento',()=>assert.equal(sum([tx({type:'income',amount:25000}),tx({type:'income',amount:25000,status:'cancelled'})]).income,25000));
test('PIX entre contas e resgate nao viram renda nem despesa',()=>{const s=sum([tx({type:'transfer'}),tx({type:'investment_withdrawal'}),tx({type:'investment_contribution'})]);assert.equal(s.income,0);assert.equal(s.expense,0);});
test('Compra nova realizada entra em saidas uma vez',()=>assert.equal(sum([tx({amount:31.98}),tx({id:'b',amount:155.72}),tx({id:'c',amount:150})]).expense,337.70));
test('Emprestimo dado e saida de caixa, devolucao e entrada',()=>{const s=sum([tx({type:'loan_given',amount:500}),tx({type:'loan_repayment',amount:80})]);assert.equal(s.expense,500);assert.equal(s.income,80);});
test('Pai aparece em A receber mesmo com filtro setembro',()=>assert.equal(sum([],[],[loan]).receivable,500));
test('Devolucao em outubro nao financia previsao de setembro',()=>assert.equal(sum([],[],[loan]).receivableInPeriod,0));
test('Devolucao em outubro entra na previsao de outubro',()=>assert.equal(sum([],[],[loan],oct).receivableInPeriod,500));
test('Emprestimo parcialmente devolvido usa somente saldo restante',()=>assert.equal(sum([],[],[{...loan,remaining_amount:320}]).receivable,320));
test('Emprestimo cancelado ou quitado nao soma',()=>assert.equal(sum([],[],[{...loan,cancelled_at:'2026-09-17'},{...loan,id:'b',remaining_amount:0}]).receivable,0));
test('Receita futura e emprestimo somados uma unica vez',()=>assert.equal(sum([tx({type:'income',status:'planned',amount:100,due_date:'2026-10-10'})],[],[loan]).receivable,600));
test('Pagamento integral de fatura conta uma vez, nao por item e pagamento',()=>{const s=sum([tx({type:'transfer',amount:300,metadata:{origin:'card_statement_payment'}}),tx({card_statement_id:'bill',amount:100}),tx({card_statement_id:'bill',amount:200})]);assert.equal(s.expense,300);});
test('Fatura pendente usa remaining, itens nao duplicam',()=>assert.equal(sum([tx({status:'planned',card_statement_id:'bill',amount:300})],[{id:'bill',remaining_amount:100,due_date:today}]).payable,100));
test('Compra nao cobrada nao altera fluxo realizado',()=>{const s=sum([tx({status:'planned',card_forecast:true})]);assert.equal(s.expense,0);assert.equal(s.payable,100);});
test('Previsao antiga nao duplica ciclo ja cobrado',()=>{const s=sum([tx({status:'planned',card_forecast:true,recurrence_key:'r',metadata:{recurrence_charge_month:'2026-09'}}),tx({id:'b',status:'planned',card_statement_id:'bill',recurrence_key:'r',metadata:{recurrence_charge_month:'2026-09'}})],[{id:'bill',due_date:today,remaining_amount:100}]);assert.equal(s.payable,100);});
test('Obrigacao de outro mes nao entra em setembro',()=>assert.equal(sum([tx({status:'planned',due_date:'2026-10-10'})]).payable,0));
test('Divida parcialmente encerrada nao volta para pendencias',()=>{const s=sum([tx({type:'debt_payment',amount:50}),tx({type:'debt_payment',status:'planned',amount:150,metadata:{settlement_completed:true}})]);assert.equal(s.expense,50);assert.equal(s.payable,0);});
test('Atraso e subconjunto de contas a pagar',()=>{const s=sum([tx({status:'planned',due_date:'2026-09-01'}),tx({id:'b',status:'planned',due_date:'2026-09-20'})]);assert.equal(s.payable,200);assert.equal(s.overdue,100);});
test('Planejamento com pendencia vinculada nao desconta duas vezes',()=>assert.equal(uncommittedBudget([{id:'b',month:'2026-09-01',amount:200}],[tx({budget_id:'b',amount:50}),tx({id:'p',budget_id:'b',amount:100,status:'planned'})],new Set(['2026-09-01'])),50));
test('Categoria nao cria vinculo de planejamento',()=>assert.equal(uncommittedBudget([{id:'b',month:'2026-09-01',amount:200}],[tx({amount:100})],new Set(['2026-09-01'])),200));
test('Cancelamento nao consome planejamento',()=>assert.equal(uncommittedBudget([{id:'b',month:'2026-09-01',amount:200}],[tx({budget_id:'b',status:'cancelled'})],new Set(['2026-09-01'])),200));
test('Resultado realizado distinto de previsao com dividas',()=>{const s=closingFigures(25000,23343.73,0,1447,845.42);assert.equal(s.realized,1656.27);assert.equal(s.projected,-636.15);});
test('Timestamp de meia-noite UTC permanece no dia correto no Brasil',()=>assert.equal(transactionDay(tx({paid_at:'2026-10-01T01:30:00Z'})),'2026-09-30'));
test('Pendencia agrupa por vencimento, nao criacao',()=>assert.equal(transactionDay(tx({status:'planned',due_date:'2026-10-10'})),'2026-10-10'));
test('Valores invalidos nao sao silenciosamente zerados',()=>assert.throws(()=>summarizeBalances([{...accounts[0],balance:'NaN'}])));
test('Dashboard nao filtra mais receitas empresariais',()=>{const s=fs.readFileSync('src/app/page.tsx','utf8');assert.equal(s.includes('filter(t => t.financial_scope !== "business")'),false);assert.equal(s.includes('Disponivel PF confirmado'),false);assert.equal(s.includes('Existem saldos aguardando confirmacao'),false);assert.equal(s.includes('<UpcomingObligations'),false);});
test('Conciliacao nao e uma aba e obrigacoes continuam em Movimentacoes',()=>{const s=fs.readFileSync('src/app/registros/layout.tsx','utf8');assert.equal(s.includes('/registros/conciliacao'),false);assert.ok(s.includes('/registros/obrigacoes'));});
test('Controle diario e lembrete, nao trava de navegacao',()=>{assert.ok(fs.readFileSync('src/app/registros/conciliacao/page.tsx','utf8').includes('redirect("/contas")'));const gate=fs.readFileSync('src/components/control/DailyFinanceGate.tsx','utf8');assert.equal(gate.includes('As outras telas continuam bloqueadas'),false);assert.ok(gate.includes('Ele nao bloqueia nenhuma tela do app'));assert.ok(gate.includes('Agora nao'));const sql=fs.readFileSync('supabase/migrations/042_daily_control_non_blocking.sql','utf8');assert.ok(sql.includes("elsif p_answer='registered'"));assert.equal(sql.includes('Nenhum lancamento ou conferencia de saldo foi salvo'),false);assert.ok(sql.includes("v_payload->>'created_by'"));});
console.log(`\n${count} testes do dashboard aprovados.`);
