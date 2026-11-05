import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import assert from "node:assert/strict";

const target=resolve("src/lib/ai-finance-batch.ts");
const transpiled=ts.transpileModule(readFileSync(target,"utf8"), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const module={exports:{}};
new Function("exports","module","require",transpiled)(module.exports,module,createRequire(import.meta.url));
const {validateModelBatch,publicBatchContext,MODEL_BATCH_SCHEMA}=module.exports;
let count=0;
function test(name,run) {run();count++;console.log(`OK ${name}`);}
function fail(name,run,pattern) {assert.throws(run,pattern);count++;console.log(`OK ${name}`);}
const ctx={
  accounts:[
    {ref:"A1",id:"00000000-0000-4000-8000-000000000001",name:"Itaú Camila",institution_name:"Itau",type:"checking",scope:"personal",balance:400,available_credit:null},
    {ref:"A2",id:"00000000-0000-4000-8000-000000000002",name:"Santander",institution_name:"Santander",type:"checking",scope:"personal",balance:300,available_credit:null},
    {ref:"A3",id:"00000000-0000-4000-8000-000000000003",name:"Nubank Cartão",institution_name:"Nubank",type:"credit_card",scope:"personal",balance:80,available_credit:500},
    {ref:"A4",id:"00000000-0000-4000-8000-000000000004",name:"Caixinha",institution_name:"Nubank",type:"investment",scope:"personal",balance:300,available_credit:null},
  ],
  categories:[{ref:"C1",id:"00000000-0000-4000-8000-000000000011",name:"Alimentação",kind:"expense"},
    {ref:"C2",id:"00000000-0000-4000-8000-000000000012",name:"Salário",kind:"income"}],
  statements:[{ref:"F1",id:"00000000-0000-4000-8000-000000000021",account_id:"00000000-0000-4000-8000-000000000003",account_name:"Nubank Cartão",due_date:"2026-11-10",remaining_amount:75.99}],
  debts:[{ref:"D1",id:"00000000-0000-4000-8000-000000000031",creditor:"Vanda",remaining_amount:600,installment_amount:300,status:"open"}],
  loans:[{ref:"L1",id:"00000000-0000-4000-8000-000000000041",borrower:"Pai",remaining_amount:100,due_date:"2026-10-10"}],
  obligations:[{ref:"O1",id:"00000000-0000-4000-8000-000000000051",description:"Aluguel",merchant:"Jurandir",amount:2600,due_date:"2026-10-10"}],
  recurring:[],
};
const today="2026-10-10";
const base={kind:"expense",account_ref:"A1",destination_ref:null,category_ref:"C1",statement_ref:null,
  debt_ref:null,loan_ref:null,obligation_ref:null,amount:25.75,description:"Pães",merchant:"Padaria",
  occurred_on:today,due_on:null,installments:1,monthly:false,count_installment:false,notes:null};
const parse=(...ops)=>validateModelBatch({reply:"Revise antes de confirmar",operations:ops},ctx,today);

test("Planos de despesas usam UUIDs resolvidos somente no servidor",()=>{
  const r=parse(base);assert.equal(r.operations[0].account_id,ctx.accounts[0].id);assert.equal(r.preview[0].account_name,"Itaú Camila");
});
test("Lote com vários lançamentos e transferência",()=>{
  const r=parse(base,{...base,kind:"transfer",account_ref:"A2",destination_ref:"A1",amount:100,description:"PIX interno",category_ref:null});
  assert.equal(r.operations.length,2);assert.equal(r.operations[1].kind,"transfer");
});
test("Receita real tem categoria de entrada",()=>{
  const r=parse({...base,kind:"income",category_ref:"C2",amount:10000});assert.equal(r.operations[0].category_id,ctx.categories[1].id);
});
test("Pagamento integral exige valor exato da fatura",()=>{
  const r=parse({...base,kind:"pay_card_statement",account_ref:"A2",statement_ref:"F1",amount:75.99});assert.equal(r.operations[0].card_statement_id,ctx.statements[0].id);
});
test("Aporte só pode ter destino de investimento",()=>{
  const r=parse({...base,kind:"investment_contribution",account_ref:"A1",destination_ref:"A4",amount:300,description:"Caixinha",category_ref:null});assert.equal(r.operations[0].destination_account_id,ctx.accounts[3].id);
});
test("Compra no cartão exige categoria e fatura futura",()=>{
  const r=parse({...base,kind:"card_purchase",account_ref:"A3",due_on:"2026-11-10",installments:3,amount:231});assert.equal(r.operations[0].installments,3);
});
test("Pagamento de dívida é distinto de despesa avulsa",()=>{
  const r=parse({...base,kind:"debt_payment",account_ref:"A2",debt_ref:"D1",amount:100,category_ref:null});assert.equal(r.operations[0].debt_id,ctx.debts[0].id);
});
test("Conciliação a zero é permitida",()=>{
  const r=parse({...base,kind:"reconcile_account",amount:0,description:"Saldo confirmado pelo banco",category_ref:null});assert.equal(r.operations[0].amount,0);
});
test("Perguntas sem ação não geram plano",()=>{assert.equal(parse().operations.length,0);});
test("Contexto do modelo não expõe saldos nem UUIDs",()=>{
  const s=JSON.stringify(publicBatchContext(ctx));assert.ok(!s.includes(ctx.accounts[0].id));assert.ok(!s.includes('"balance"'));
});
test("Esquema de resposta exige chaves e objetos estritos",()=>{
  assert.equal(MODEL_BATCH_SCHEMA.additionalProperties,false);assert.equal(MODEL_BATCH_SCHEMA.properties.operations.items.additionalProperties,false);
});
fail("ID falso, fora do contexto do servidor",()=>parse({...base,account_ref:"00000000-0000-4000-8000-000000000001"}),/Conta/);
fail("Não permite valor negativo",()=>parse({...base,amount:-10}),/valor/);
fail("Não permite valor com três casas",()=>parse({...base,amount:10.999}),/valor/);
fail("Despesa não aceita categoria receita",()=>parse({...base,category_ref:"C2"}),/Categoria/);
fail("Receita não aceita categoria despesa",()=>parse({...base,kind:"income"}),/Categoria/);
fail("Não permite transferir para a mesma conta",()=>parse({...base,kind:"transfer",destination_ref:"A1"}),/Transferência/);
fail("Aporte sem conta de investimento",()=>parse({...base,kind:"investment_contribution",destination_ref:"A2"}),/investimento/);
fail("Compra no cartão não pode sair de conta débito",()=>parse({...base,kind:"card_purchase",due_on:"2026-11-10"}),/cartão/);
fail("Não trata cartão emprestado como cartão próprio",()=>{
  const copy=structuredClone(ctx);
  copy.accounts[2].name="Vanda - Cartão emprestado";
  return validateModelBatch({reply:"",operations:[{...base,kind:"card_purchase",account_ref:"A3",due_on:"2026-11-10"}]},copy,today);
},/Cartões de terceiros/);
fail("Despesa debitada no cartão é proibida",()=>parse({...base,account_ref:"A3"}),/conta válida/);
fail("Fatura parcialmente paga não se passa por quitação total",()=>parse({...base,kind:"pay_card_statement",statement_ref:"F1",amount:35.90}),/saldo restante/);
fail("Dívida não pode ser paga acima do saldo",()=>parse({...base,kind:"debt_payment",debt_ref:"D1",amount:1000}),/dívida/);
fail("Parcela marcada completa exige valor certo",()=>parse({...base,kind:"debt_payment",debt_ref:"D1",amount:100,count_installment:true}),/parcela completa/);
fail("Obrigação precisa do valor exato",()=>parse({...base,kind:"settle_obligation",obligation_ref:"O1",amount:2000}),/obrigação/);
fail("Data inexistente é rejeitada",()=>parse({...base,occurred_on:"2026-02-30"}),/Data/);
fail("Data futura é rejeitada",()=>parse({...base,occurred_on:"2026-10-20"}),/data/);
fail("Não duplica a mesma compra em um lote",()=>parse(base,{...base}),/repetiu/);
fail("Assinatura não pode ser 21 vezes e também recorrente",()=>parse({...base,kind:"card_purchase",account_ref:"A3",due_on:"2026-11-10",installments:21,monthly:true}),/Assinaturas/);
fail("Parcela exige primeiro vencimento",()=>parse({...base,kind:"card_purchase",account_ref:"A3",due_on:null}),/exige/);
fail("Mais de 20 operações não são permitidas",()=>parse(...Array.from({length:21},(_,i)=>({...base,description:`Pães ${i}`}))),/limite/);

const migration=readFileSync("supabase/migrations/043_ai_finance_batch_v1.sql","utf8");
test("Banco só confirma após permissão de escrita",()=>assert.match(migration,/not public\.pf_can_write\(b\.household_id\)/));
test("Conferência transacional guarda resultado idempotente",()=>assert.match(migration,/if b\.status='confirmed' then return b\.result/));
test("Banco protege planos desatualizados",()=>assert.match(migration,/Saldo ou limite alterado depois da previa/));
test("Banco utiliza commit atômico",()=>assert.match(migration,/commit;\s*notify pgrst/));
test("Limite por janela persiste no banco",()=>assert.match(migration,/pf_ai_model_request_buckets/));
const prepare=readFileSync("src/app/api/assistant/batch/prepare/route.ts","utf8");
test("Groq exige aceite explícito de ZDR",()=>assert.match(prepare,/KYRA_GROQ_ZDR_ACKNOWLEDGED!=="true"/));
test("API usa getUser em vez de confiar no token",()=>assert.match(prepare,/db\.auth\.getUser\(\)/));
const confirm=readFileSync("src/app/api/assistant/batch/confirm/route.ts","utf8");
test("Confirmacao usa RPC atomica, não SQL de IA",()=>assert.match(confirm,/pf_confirm_ai_finance_batch_v1/));
console.log(`\n${count} testes do assistente financeiro em lote passaram.`);
