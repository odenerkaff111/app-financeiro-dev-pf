process.env.KYRA_LIVE_PRICING='false';
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import assert from 'node:assert/strict';
class FamilyError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const usage=[];const module={exports:{}};
const code=ts.transpileModule(fs.readFileSync('src/lib/chat-model.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const metrics={exports:{}};new Function('exports','module',ts.transpileModule(fs.readFileSync('src/lib/ai-observability.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(metrics.exports,metrics);
const mocks={'./ai-observability':metrics.exports,'server-only':{},'./family-server':{FamilyError},'./ai-server':{getAiRuntimeSettings:async()=>({isEnabled:true,model:'fake-model',monthlyBudgetUsd:0}),recordAiUsage:async(_db,row)=>usage.push(row)}};
const localCache=new Map();
function dependency(id){if(id in mocks)return mocks[id];if(id==='./ai-pricing')return {modelPricing:async()=>null};if(localCache.has(id))return localCache.get(id);const m={exports:{}};localCache.set(id,m.exports);new Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.join('src/lib',id+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,m,dependency);return m.exports;}
new Function('exports','module','require',code)(module.exports,module,dependency);
const {modelCompletion}=module.exports;const oldFetch=globalThis.fetch,old={...process.env};let count=0;
const test=async(name,fn)=>{await fn();count++;console.log('OK '+name);};
const input={db:{},household:'test',user:'test',messages:[{role:'user',content:'Mensagem fictícia'}]};
try{
 process.env.KYRA_CHAT_PROVIDER='openrouter';process.env.OPENROUTER_API_KEY='fake-key-for-test-only';
 await test('Streaming trata comentários, CRLF cortado e texto progressivo',async()=>{const raw=': heartbeat\r\n\r\ndata: '+JSON.stringify({choices:[{delta:{content:'Olá '}}]})+'\r\n\r\ndata: '+JSON.stringify({choices:[{delta:{content:'Dener'}}],usage:{prompt_tokens:10,total_tokens:13}})+'\r\n\r\ndata: [DONE]\r\n\r\n';const chunks=[...new TextEncoder().encode(raw)].map(x=>new Uint8Array([x]));globalThis.fetch=async()=>new Response(new ReadableStream({start(c){for(const b of chunks)c.enqueue(b);c.close();}}));let text='';const result=await modelCompletion({...input,onDelta:t=>text+=t});assert.equal(result.text,'Olá Dener');assert.equal(text,'Olá Dener');assert.equal(usage.at(-1).totalTokens,13);});
 await test('Chamada de ferramenta pode chegar em vários fragmentos',async()=>{const events=[{choices:[{delta:{tool_calls:[{index:0,id:'tool-1',function:{name:'financial_view',arguments:'{"kind":'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"invoices"}'}}]}}]}];globalThis.fetch=async()=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n');const r=await modelCompletion(input);assert.equal(r.toolCalls[0].function.name,'financial_view');assert.deepEqual(JSON.parse(r.toolCalls[0].function.arguments),{kind:'invoices'});});
 await test('Fluxo incompleto não é apresentado como sucesso',async()=>{globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"Parcial"}}]}\n\n');await assert.rejects(modelCompletion(input),/antes da resposta completa/);});
 await test('Erro no meio da resposta é recuperável',async()=>{globalThis.fetch=async()=>new Response('data: {"error":{"message":"provider-error"}}\n\n');await assert.rejects(modelCompletion(input),/interrompeu/);});
 await test('Cota atingida não aciona outro provedor',async()=>{let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:429});};await assert.rejects(modelCompletion(input),e=>e.status===429);assert.equal(calls,1);});
 await test('Imagem exige provedor de visão explicitamente configurado',async()=>{delete process.env.KYRA_VISION_PROVIDER;await assert.rejects(modelCompletion({...input,vision:true,json:true}),/precisa ser configurada/);});
 await test('Groq exige aceite de ZDR no caminho do Consultor',async()=>{process.env.KYRA_CHAT_PROVIDER='groq';process.env.GROQ_API_KEY='fake-groq-key';delete process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED;await assert.rejects(modelCompletion(input),/ainda não está configurado/);});
 console.log(`${count} testes de integração com provedor simulado passaram.`);
}finally{globalThis.fetch=oldFetch;for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);}

await import('./run-chat-reliability-tests.mjs');

await import('./run-ai-observability-tests.mjs');

await import('./run-langfuse-tests.mjs');

await import('./run-chat-upgrade-tests.mjs');
