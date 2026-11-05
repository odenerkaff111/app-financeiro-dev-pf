import 'server-only';
import {exportLangfuse} from './langfuse-export';
import type {SupabaseClient} from '@supabase/supabase-js';
export type DiagnosticMeta=Record<string,string|number|boolean|null|undefined>;
const allowed=new Set(['provider','model','http_status','provider_code','provider_request_id','elapsed_ms','input_tokens_estimate','max_output_tokens','transactions_in_context','transactions_omitted','operations','attempt','reason','request_characters','span_id','parent_span_id','tool_name','tool_source','span_status','duration_ms','input_tokens','output_tokens','total_tokens','reasoning_tokens','cached_tokens','cost_usd','cost_source','list_price_usd','pricing_version','finish_reason','request_budget','context_characters','requested_model','serving_provider','export_status','input_cost_usd','output_cost_usd','estimated_input_usd','estimated_output_usd','input_price_per_m','output_price_per_m','cached_input_price_per_m','price_source','price_checked_at','price_status','from_provider','to_provider','phase','step']);
export function safeDiagnosticMeta(meta:DiagnosticMeta={}){
 const out:Record<string,string|number|boolean|null>={};
 for(const [key,value] of Object.entries(meta)){
  if(!allowed.has(key)||value===undefined)continue;
  if(typeof value==='number'){if(Number.isFinite(value))out[key]=value;}
  else if(typeof value==='boolean'||value===null)out[key]=value;
  else if(typeof value==='string')out[key]=(/(?:gsk_|sk-|bearer\s|eyJ[a-zA-Z0-9_-]{12})/i.test(value)?'redacted':value).replace(/[^a-zA-Z0-9_./:\-]/g,'_').slice(0,120);
 }
 return out;
}
export function aiTrace(db:SupabaseClient,household:string,user:string,requestId:string,conversationId:string|null=null){
 const started=Date.now(),rows:Record<string,unknown>[]=[];
 let count=0,lastCreated=0,timer:ReturnType<typeof setTimeout>|undefined,chain=Promise.resolve();
 const makeRow=(stage:string,level:string,meta:DiagnosticMeta)=>({id:crypto.randomUUID(),request_id:requestId,conversation_id:conversationId,household_id:household,created_by:user,stage,level,created_at:new Date(lastCreated=Math.max(Date.now(),lastCreated+1)).toISOString(),metadata:safeDiagnosticMeta({...meta,elapsed_ms:Date.now()-started})});
 async function persist(batch:Record<string,unknown>[]){try{const query=db.from('pf_ai_diagnostics').insert(batch);const result=await (typeof query.abortSignal==='function'?query.abortSignal(AbortSignal.timeout(1500)):query);if(result.error)console.warn(JSON.stringify({event:'kyra_ai_log_storage_unavailable',request_id:requestId,code:String(result.error.code||'unknown').slice(0,40)}));}catch{console.warn(JSON.stringify({event:'kyra_ai_log_storage_unavailable',request_id:requestId}));}}
 async function flush(){
  if(timer){clearTimeout(timer);timer=undefined;}
  const batch=rows.splice(0);
  if(batch.length)chain=chain.then(async()=>{
   // Both destinations are bounded and independent. Telemetry failures never
   // fail a financial request. Final flush also awaits every live flush.
   await persist(batch);
   const state=await exportLangfuse(batch as Parameters<typeof exportLangfuse>[0]);
   if(state!=='disabled'){
    const level=state==='sent'?'info':'warn',row=makeRow('langfuse_export',level,{export_status:state});
    if(level==='warn')console.warn(JSON.stringify({event:'kyra_langfuse_export',request_id:requestId,status:state}));
    await persist([row]);
   }
  }).catch(()=>{console.warn(JSON.stringify({event:'kyra_ai_trace_flush_failed',request_id:requestId}));});
  await chain;
 }
 const event=(stage:string,level:'info'|'warn'|'error'='info',meta:DiagnosticMeta={})=>{
  const row=makeRow(stage.replace(/[^a-z_]/g,'').slice(0,40),level,meta);
  if(count<240)rows.push(row);else if(count===240)rows.push(makeRow('trace_truncated','warn',{reason:'event_limit'}));count++;
  if(rows.length&&!timer)timer=setTimeout(()=>{timer=undefined;void flush();},200);
  const entry=JSON.stringify({event:'kyra_ai',request_id:requestId,stage:row.stage,level,...row.metadata});
  if(level==='error')console.error(entry);else console.info(entry);
 };
 return {event,flush};
}
