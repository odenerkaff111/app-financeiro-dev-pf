import 'server-only';
import {getAiRuntimeSettings,recordAiUsage} from './ai-server';
import {FamilyError} from './family-server';
import {generationUsage,type TraceLog} from './ai-observability';
import {modelPricing} from './ai-pricing';
import {attemptSignal,canFallback,fallbackConfiguration,fallbackOptions,ModelRequestError} from './llm-fallback';
import type {SupabaseClient} from '@supabase/supabase-js';
export type ModelMessage={role:string;content:unknown;tool_call_id?:string;tool_calls?:unknown[]};
export type ModelTool={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export async function modelConfiguration(db:SupabaseClient,household:string,vision=false){
 const settings=await getAiRuntimeSettings(db,household);if(!settings.isEnabled)throw new FamilyError('O assistente está desativado em Ajustes → IA.',503);
 const provider=vision?process.env.KYRA_VISION_PROVIDER:(process.env.KYRA_CHAT_PROVIDER||(process.env.GROQ_API_KEY&&process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED==='true'?'groq':'openrouter'));
 if(provider!=='groq'&&provider!=='openrouter')throw new FamilyError(vision?'A leitura de fotos e PDFs precisa ser configurada no servidor. Você pode continuar pelo texto enquanto isso.':'Configure o provedor de IA do chat no servidor.',503);
 if(vision&&provider!=='openrouter')throw new FamilyError('Configure um modelo de visão compatível no servidor para analisar fotos e PDFs.',503);
 const key=provider==='groq'?process.env.GROQ_API_KEY:process.env.OPENROUTER_API_KEY;
 if(!key||(provider==='groq'&&process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED!=='true'))throw new FamilyError('O provedor de IA selecionado ainda não está configurado. Seu pedido permanece na conversa.',503);
 const model=vision?process.env.KYRA_VISION_MODEL:(process.env.KYRA_COACH_MODEL||(provider==='groq'?(process.env.GROQ_BATCH_MODEL||'openai/gpt-oss-120b'):settings.model));
 if(!model)throw new FamilyError('Defina o modelo de visão no servidor antes de enviar comprovantes.',503);
 if(settings.monthlyBudgetUsd>0){const sum=await db.rpc('pf_chat_usage_total',{p_household:household});if(sum.error)throw new FamilyError('Não consegui verificar o orçamento de IA.',503);if(Number(sum.data)>=settings.monthlyBudgetUsd)throw new FamilyError('O orçamento mensal de IA foi atingido.',429);}
 return {provider,key,model,url:provider==='groq'?'https://api.groq.com/openai/v1/chat/completions':'https://openrouter.ai/api/v1/chat/completions'};
}
export type ModelInput={db:SupabaseClient;household:string;user:string;messages:ModelMessage[];tools?:ModelTool[];onDelta?:(s:string)=>void;signal?:AbortSignal;vision?:boolean;json?:boolean;trace?:TraceLog};
export async function modelCompletion(input:ModelInput){
 const config=await modelConfiguration(input.db,input.household,input.vision);let emitted=false;
 const turn={...input,onDelta:(part:string)=>{emitted=true;input.onDelta?.(part);}};
 try{return await attemptCompletion(config,turn);}
 catch(error){
  if(input.vision||!canFallback(error,config.provider,input.signal,emitted))throw error;
  const c=fallbackConfiguration();input.trace?.('model_fallback','warn',{from_provider:'groq',to_provider:c.provider,model:c.model,reason:'primary_unavailable'});
  return attemptCompletion({provider:c.provider,model:c.model,key:c.key!,url:c.url},turn,true);
 }
}
async function attemptCompletion(config:{provider:string;model:string;key:string;url:string},input:ModelInput,fallback=false){
 const quote=await modelPricing(config.provider,config.model),calls=new Map<number,ToolCall>();let text='',usage:Record<string,unknown>={},generation:string|undefined;const span=crypto.randomUUID(),started=Date.now();let status='error',finish='',servedModel=config.model,servingProvider='';
 input.trace?.('model_request','info',{span_id:span,provider:config.provider,model:config.model});
 try{
 const response=await fetch(config.url,{method:'POST',signal:attemptSignal(input.signal),headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,messages:input.messages,...(config.provider==='groq'?{max_completion_tokens:input.vision?2200:3200}:{max_tokens:input.vision?2200:3200}),stream:!input.json,...(!input.json?{stream_options:{include_usage:true}}:{}),...(input.tools?{tools:input.tools,tool_choice:'auto'}:{}),...(input.json?{response_format:{type:'json_object'}}:{}),...(config.provider==='openrouter'?{usage:{include:true},provider:fallback?fallbackOptions():{data_collection:'deny',zdr:true},...(input.vision?{plugins:[{id:'file-parser',pdf:{engine:process.env.KYRA_PDF_ENGINE||'native'}}]}:{})}:{})})});
 if(!response.ok){input.trace?.('model_rejected','error',{span_id:span,provider:config.provider,model:config.model,http_status:response.status});throw new ModelRequestError(response.status===429?'A cota do provedor de IA foi atingida. Tente novamente depois.':'O modelo não conseguiu atender este pedido. Confira a configuração do modelo e tente novamente.',response.status===429?429:503,[408,429,500,502,503,504,404].includes(response.status));}
 if(input.json){const r=await response.json();text=r.choices?.[0]?.message?.content||'';usage=r.usage??r.x_groq?.usage??{};generation=r.id;if(typeof r.model==='string')servedModel=r.model;if(typeof r.provider==='string')servingProvider=r.provider;finish=r.choices?.[0]?.finish_reason||'';}
 else{
  const reader=response.body?.getReader();if(!reader)throw new FamilyError('O provedor não enviou uma resposta.',503);
  let buffer='';const decoder=new TextDecoder();let completed=false;
  const event=(block:string)=>{const lines=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart());if(!lines.length)return;const raw=lines.join('\n');if(raw==='[DONE]'){completed=true;return;}const value=JSON.parse(raw);if(value.error)throw new FamilyError('O modelo interrompeu a resposta. Você pode tentar novamente.',503);generation=value.id??generation;if(typeof value.model==='string')servedModel=value.model;if(typeof value.provider==='string')servingProvider=value.provider;if(value.usage||value.x_groq?.usage)usage=value.usage??value.x_groq.usage;if(value.choices?.[0]?.finish_reason)finish=value.choices[0].finish_reason;const delta=value.choices?.[0]?.delta;if(delta?.content){text+=delta.content;input.onDelta?.(delta.content);}for(const item of delta?.tool_calls??[]){const old=calls.get(item.index)??{id:'',type:'function' as const,function:{name:'',arguments:''}};if(item.id)old.id=item.id;if(item.function?.name)old.function.name+=item.function.name;if(item.function?.arguments)old.function.arguments+=item.function.arguments;calls.set(item.index,old);}};
  while(true){const r=await reader.read();buffer=(buffer+decoder.decode(r.value??new Uint8Array(),{stream:!r.done})).replace(/\r\n/g,'\n');let at;while((at=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,at);buffer=buffer.slice(at+2);event(block);}if(r.done)break;}
  if(buffer.trim())event(buffer);if(!completed)throw new FamilyError('A conexão com o modelo terminou antes da resposta completa. Tente novamente.',503);
 }
 if(finish==='length')throw new FamilyError('A resposta atingiu o limite antes de terminar. Tente um pedido menor.',413);
 const measured=generationUsage(config.provider,servedModel,usage,config.provider==='groq'&&process.env.KYRA_GROQ_BILLING_MODE==='free',quote);
 await recordAiUsage(input.db,{householdId:input.household,userId:input.user,provider:config.provider,model:servedModel,requestKind:input.vision?'chat_attachment':'chat_consultor',status:'success',generationId:generation,promptTokens:measured.input_tokens??0,completionTokens:measured.output_tokens??0,totalTokens:measured.total_tokens??0,costUsd:measured.cost_usd??0});
 status='success';return {text,toolCalls:[...calls.values()],model:servedModel,callId:span};
 }finally{input.trace?.('model_finished',status==='success'?'info':'error',{span_id:span,provider:config.provider,model:servedModel,requested_model:config.model,serving_provider:servingProvider,span_status:status,duration_ms:Date.now()-started,finish_reason:finish,...generationUsage(config.provider,servedModel,usage,config.provider==='groq'&&process.env.KYRA_GROQ_BILLING_MODE==='free',quote)});}
}
