import 'server-only';
import {groqPlan} from './groq-planner';
import {generationUsage} from './ai-observability';
import {modelPricing} from './ai-pricing';
import {attemptSignal,canFallback,fallbackConfiguration,fallbackOptions,ModelRequestError} from './llm-fallback';
export async function openrouterPlan(input:Parameters<typeof groqPlan>[0]){
 const c=fallbackConfiguration();if(!c.ready||!c.key)throw new ModelRequestError('Configure a chave do provedor alternativo em Ajustes → IA.',503);
 const quote=await modelPricing('openrouter',c.model);
 const span=crypto.randomUUID(),started=Date.now();let usage:Record<string,unknown>={},status='error',model=c.model,finish='';
 input.log('model_request','info',{span_id:span,provider:'openrouter',model:c.model,max_output_tokens:input.maxOutput,attempt:2});
 try{
  const response=await fetch(c.url,{method:'POST',signal:attemptSignal(input.signal),headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json'},body:JSON.stringify({model:c.model,messages:input.messages,max_tokens:input.maxOutput,response_format:{type:'json_schema',json_schema:{name:'family_plan',strict:true,schema:input.schema}},provider:fallbackOptions(),usage:{include:true},reasoning:{effort:'low'}})});
  if(!response.ok){input.log('model_rejected','error',{span_id:span,provider:'openrouter',model:c.model,http_status:response.status});throw new ModelRequestError('O provedor alternativo não concluiu a análise. Seu pedido está salvo; consulte os detalhes da IA.',503);}
  const body=await response.json();usage=body.usage??{};model=body.model||c.model;finish=body.choices?.[0]?.finish_reason||'';
  if(!body.choices?.[0]?.message?.content||finish==='length')throw new ModelRequestError('A rota alternativa retornou uma resposta incompleta. Nenhuma movimentação foi preparada.',503);
  try{JSON.parse(body.choices[0].message.content);}catch{throw new ModelRequestError('O provedor alternativo não retornou o formato esperado. Seu rascunho está salvo.',503);}
  status='success';return {...body,provider:'openrouter'} as Awaited<ReturnType<typeof groqPlan>>;
 }finally{input.log('model_finished',status==='success'?'info':'error',{span_id:span,provider:'openrouter',model,requested_model:c.model,span_status:status,duration_ms:Date.now()-started,finish_reason:finish,...generationUsage('openrouter',model,usage,false,quote)});}
}
export async function registrarPlan(input:Parameters<typeof groqPlan>[0],onFallback?:()=>void){
 try{return await groqPlan({...input,signal:attemptSignal(input.signal)});}
 catch(error){if(!canFallback(error,'groq',input.signal))throw error;input.log('model_fallback','warn',{from_provider:'groq',to_provider:'openrouter',model:fallbackConfiguration().model,reason:'primary_unavailable'});onFallback?.();return openrouterPlan(input);}
}
