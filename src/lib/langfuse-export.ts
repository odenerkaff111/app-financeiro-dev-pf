import 'server-only';
import {createHash} from 'node:crypto';

type Row={id:string;request_id:string;conversation_id?:string|null;stage:string;level:string;created_at:string;metadata:Record<string,unknown>};
type Attribute={key:string;value:{stringValue:string}};
const hash=(v:string,length:number)=>createHash('sha256').update(v).digest('hex').slice(0,length);
const numeric=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const attribute=(key:string,value:unknown):Attribute=>({key,value:{stringValue:String(value)}});
export function langfuseState(){
 const present=Boolean(process.env.LANGFUSE_PUBLIC_KEY||process.env.LANGFUSE_SECRET_KEY);
 return {enabled:Boolean(process.env.LANGFUSE_PUBLIC_KEY&&process.env.LANGFUSE_SECRET_KEY),configured:present};
}
// OTLP/HTTP JSON, complete spans only (Langfuse v4). Do not export prompts,
// financial context, attachments, tool arguments/results or user identities.
export function langfusePayload(rows:Row[]){
 const spans=rows.filter(r=>!['model_request','tool_started','langfuse_export'].includes(r.stage)).map(r=>{
  const m=r.metadata,model=r.stage==='model_finished',tool=r.stage==='tool_finished',root=['turn_saved','turn_failed','connection_verified','connection_failed'].includes(r.stage);
  const traceId=hash(r.request_id,32),rootId=hash(r.request_id+':turn',16),end=Date.parse(r.created_at),duration=numeric(root?m.elapsed_ms:m.duration_ms)??0;
  const attrs=[attribute('langfuse.trace.name','kyra-chat'),attribute('langfuse.observation.type',model?'generation':tool?'tool':root?'agent':'event'),attribute('langfuse.observation.level',r.level==='error'?'ERROR':r.level==='warn'?'WARNING':'DEFAULT'),attribute('langfuse.observation.metadata.request_id',JSON.stringify(r.request_id))];
  if(r.conversation_id)attrs.push(attribute('langfuse.session.id',hash(r.conversation_id,32)));
  for(const key of ['provider','requested_model','serving_provider','tool_name','tool_source','span_status','reason','http_status','provider_code','input_tokens_estimate','max_output_tokens','request_budget','cost_source','list_price_usd','pricing_version','finish_reason','input_price_per_m','output_price_per_m','cached_input_price_per_m','price_source','price_checked_at','price_status'])if(m[key]!==null&&m[key]!==undefined)attrs.push(attribute('langfuse.observation.metadata.'+key,JSON.stringify(m[key])));
  if(model){
   if(m.model)attrs.push(attribute('langfuse.observation.model.name',m.model));
   const usage:Record<string,number>={};for(const [key,source] of [['input','input_tokens'],['output','output_tokens'],['total','total_tokens']]){const v=numeric(m[source]);if(v!==null)usage[key]=v;}
   if(Object.keys(usage).length)attrs.push(attribute('langfuse.observation.usage_details',JSON.stringify(usage)));
   const cost=numeric(m.cost_usd);if(cost!==null)attrs.push(attribute('langfuse.observation.cost_details',JSON.stringify({total:cost})));
  }
  return {traceId,spanId:root?rootId:hash(String(m.span_id||r.id),16),...(root?{}:{parentSpanId:m.parent_span_id?hash(String(m.parent_span_id),16):rootId}),name:model?'llm_generation':tool?String(m.tool_name):root?'chat_turn':r.stage,kind:1,startTimeUnixNano:String(BigInt(Math.max(0,end-duration))*BigInt(1000000)),endTimeUnixNano:String(BigInt(end)*BigInt(1000000)),attributes:attrs,status:{code:r.level==='error'||m.span_status==='error'?2:1}};
 });
 return {resourceSpans:[{resource:{attributes:[attribute('service.name','kyra-financas')]},scopeSpans:[{scope:{name:'kyra-chat-observability',version:'1.2.0'},spans}]}]};
}
export async function exportLangfuse(rows:Row[]):Promise<'disabled'|'sent'|'error'|'misconfigured'>{
 const state=langfuseState();if(!state.configured)return 'disabled';if(!state.enabled)return 'misconfigured';
 try{
  const url=new URL(process.env.LANGFUSE_BASE_URL||'https://cloud.langfuse.com');
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)return 'misconfigured';
  url.pathname=url.pathname.replace(/\/$/,'')+'/api/public/otel/v1/traces';
  const payload=langfusePayload(rows);if(!payload.resourceSpans[0].scopeSpans[0].spans.length)return 'sent';
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(1500),headers:{Authorization:'Basic '+Buffer.from(process.env.LANGFUSE_PUBLIC_KEY+':'+process.env.LANGFUSE_SECRET_KEY).toString('base64'),'Content-Type':'application/json','x-langfuse-ingestion-version':'4'},body:JSON.stringify(payload)});
  if(!response.ok)return 'error';
  const result=await response.json().catch(()=>({}));return Number(result.partialSuccess?.rejectedSpans||0)>0?'error':'sent';
 }catch{return 'error';}
}
