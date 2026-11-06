import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const cache=new Map();
function load(file){
  const absolute=path.resolve(file);if(cache.has(absolute))return cache.get(absolute).exports;
  const module={exports:{}};cache.set(absolute,module);
  const code=ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('module','exports','require',code)(module,module.exports,id=>{
    if(!id.startsWith('@/'))throw new Error('Unexpected dependency '+id);
    return load(path.join('src',id.slice(2))+'.ts');
  });return module.exports;
}
const {realizedDashboard,buildModernDashboard,annualDashboard}=load('src/lib/dashboard/modern-model.ts');
const empty=()=>({accounts:[{id:'bank',type:'checking',name:'Banco',balance:20,is_active:true}],transactions:[],statements:[],categories:[],debts:[],loans:[],budgets:[],preferences:[],recurring:[],investmentPositions:[],essentialMonths:[]});
const t=(amount,extra={})=>({id:Math.random().toString(),amount,type:'expense',status:'paid',occurred_on:'2026-09-10',account_id:null,metadata:{},...extra});
let n=0;const test=(name,fn)=>{fn();n++;console.log('OK '+name);};
const flow=d=>realizedDashboard(d,'2026-09');
test('Histórico pago sem conta entra sem reduzir de novo o saldo atual',()=>{const d=empty();d.transactions=[t(100,{metadata:{skip_balance_update:true}})];const m=buildModernDashboard(d,'2026-09','2026-11-06');assert.equal(m.view.cash,2000);assert.equal(m.view.cashOut,10000);assert.equal(m.realized.unlinkedPaid,1);});
test('Conta arquivada não apaga pagamento realizado',()=>{const d=empty();d.accounts.push({id:'old',name:'Banco antigo',type:'checking',balance:999,is_active:false});d.transactions=[t(15,{account_id:'old'})];assert.equal(flow(d).cashOut,1500);assert.equal(buildModernDashboard(d,'2026-09','2026-11-06').view.cash,2000);});
test('Receita PJ e receita histórica sem conta são reconhecidas',()=>{const d=empty();d.transactions=[t(10000,{type:'income',account_id:'bank',financial_scope:'business'}),t(120,{type:'income'})];assert.equal(flow(d).income,1012000);});
test('Previsões e cancelamentos não são pagamentos realizados',()=>{const d=empty();d.transactions=[t(99,{status:'planned'}),t(99,{status:'cancelled'}),t(99,{metadata:{settlement_completed:true}})];assert.equal(flow(d).cashOut,0);});
test('Itens quitados de fatura não somam com o pagamento da fatura',()=>{const d=empty();d.transactions=[t(100,{card_statement_id:'s'}),t(100,{type:'transfer',account_id:'bank',metadata:{origin:'card_statement_payment'}})];assert.equal(flow(d).cashOut,10000);});
test('Item de crédito legado sem vínculo de fatura também não vira débito bancário',()=>{const d=empty();d.transactions=[t(100,{metadata:{payment_method:'credit_card'}}),t(100,{metadata:{purchase_accounting:'inside_card_invoice_only'}}),t(100,{card_forecast:true})];assert.equal(flow(d).cashOut,0);});
test('Transferência interna e alocação sem classificação no limite não são faturas pagas',()=>{const d=empty();d.transactions=[t(31.87,{type:'transfer',metadata:{origin:'internal_transfer'}}),t(31.87,{type:'transfer',metadata:{origin:'card_limit_allocation_unclassified',bill_payment_confirmed:false}})];assert.equal(flow(d).cashOut,0);assert.equal(flow(d).cashIn,0);});
test('Empréstimo tomado e devolução entram no caixa sem virar salário',()=>{const d=empty();d.transactions=[t(200,{type:'debt_received'}),t(50,{type:'loan_repayment'})];assert.equal(flow(d).cashIn,25000);assert.equal(flow(d).income,0);});
test('Empréstimo concedido é saída, sem alterar o direito a receber',()=>{const d=empty();d.transactions=[t(500,{type:'loan_given'})];d.loans=[{id:'loan',remaining_amount:500,due_date:'2026-12-01'}];const m=buildModernDashboard(d,'2026-09','2026-11-06');assert.equal(m.view.cashOut,50000);assert.equal(m.lent,50000);});
test('Aporte e resgate são fluxos separados da renda ganha',()=>{const d=empty();d.transactions=[t(300,{type:'investment_contribution'}),t(100,{type:'investment_withdrawal'})];const f=flow(d);assert.equal(f.cashOut,30000);assert.equal(f.cashIn,10000);assert.equal(f.investmentOut,30000);assert.equal(f.investmentIn,10000);assert.equal(f.income,0);});
test('Pagamento próximo da meia-noite respeita o mês no Brasil',()=>{const d=empty();d.transactions=[t(25,{occurred_on:'2026-10-01',paid_at:'2026-10-01T01:30:00Z'})];assert.equal(flow(d).cashOut,2500);assert.equal(realizedDashboard(d,'2026-10').cashOut,0);});
test('Estimativas já cadastradas ficam identificadas no detalhamento',()=>{const d=empty();d.transactions=[t(101.17,{metadata:{estimated:true,skip_balance_update:true}}),t(10)];assert.equal(flow(d).estimatedOut,10117);assert.equal(flow(d).cashOut,11117);});
test('Pagamentos históricos não são descontados outra vez na projeção atual',()=>{const d=empty();d.transactions=[t(100,{occurred_on:'2026-11-01'}),t(10,{status:'planned',due_date:'2026-11-10'})];assert.equal(buildModernDashboard(d,'2026-11','2026-11-06').view.forecast.end,1000);});
test('Histórico pago sem conta separa realizado de pendente no ano',()=>{const d=empty();d.transactions=[t(10000,{type:'income',account_id:'bank'}),t(120,{type:'income'}),t(4900.31,{account_id:'bank'}),t(4700.16),t(419.52,{metadata:{estimated:true}}),t(13.57,{type:'transfer',metadata:{origin:'card_limit_allocation_unclassified'}}),t(2.03,{type:'transfer',metadata:{origin:'card_limit_allocation_unclassified'}}),t(500.01,{status:'planned',due_date:'2026-09-20'})];const p=annualDashboard(d,2026,'2026-11-06')[8];assert.equal(p.incoming,10120);assert.equal(p.paid,1001999);assert.equal(p.expectedOut,50001);assert.equal(p.outgoing,10520);assert.equal(p.estimatedOut,41952);assert.equal(buildModernDashboard(d,'2026-09','2026-11-06').result,10001);});
console.log(`${n} testes do histórico e gráfico anual aprovados.`);
