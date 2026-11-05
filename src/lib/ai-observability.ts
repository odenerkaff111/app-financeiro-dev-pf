export type TraceMeta=Record<string,string|number|boolean|null|undefined>;
export type TraceLog=(stage:string,level:'info'|'warn'|'error',meta?:TraceMeta)=>void;
export type TraceEvent={id:string;request_id:string;stage:string;level:string;created_at:string;metadata:Record<string,unknown>};
const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export type PriceQuote={inputPerM:number;outputPerM:number;cachedPerM:number|null;source:string;checkedAt:string;status:string};
const snapshots:Record<string,[number,number,number]>={'openai/gpt-oss-120b':[.15,.60,.075],'openai/gpt-oss-20b':[.075,.30,.037]};
export function generationUsage(provider:string,model:string,usage:Record<string,unknown>={},free=false,quote?:PriceQuote|null){
 const input=number(usage.prompt_tokens),output=number(usage.completion_tokens),total=number(usage.total_tokens)??(input!==null&&output!==null?input+output:null);
 const details=usage.completion_tokens_details as Record<string,unknown>|undefined,cache=usage.prompt_tokens_details as Record<string,unknown>|undefined;
 const cached=number(cache?.cached_tokens),reported=number(usage.cost),rate=provider==='groq'?snapshots[model]:undefined;
 const price=quote??(rate?{inputPerM:rate[0],outputPerM:rate[1],cachedPerM:rate[2],source:'groq_official_snapshot',checkedAt:'2026-11-02',status:'snapshot'}:null);
 const cachedInput=input!==null?Math.min(input,cached??0):0;
 const estimatedInput=price&&input!==null?((input-cachedInput)*price.inputPerM+cachedInput*(price.cachedPerM??price.inputPerM))/1e6:null;
 const estimatedOutput=price&&output!==null?output*price.outputPerM/1e6:null;
 const cost=reported??(free?0:null),zero=cost===0;
 return {input_tokens:input,output_tokens:output,total_tokens:total,reasoning_tokens:number(details?.reasoning_tokens),cached_tokens:cached,cost_usd:cost,cost_source:reported!==null?'provider':free?'configured_free':'unknown',input_cost_usd:zero?0:null,output_cost_usd:zero?0:null,estimated_input_usd:estimatedInput,estimated_output_usd:estimatedOutput,list_price_usd:estimatedInput!==null&&estimatedOutput!==null?estimatedInput+estimatedOutput:null,pricing_version:price?.source==='groq_official_snapshot'?'groq_2026_11_02':price?.source??null,input_price_per_m:price?.inputPerM??null,output_price_per_m:price?.outputPerM??null,cached_input_price_per_m:price?.cachedPerM??null,price_source:price?.source??null,price_checked_at:price?.checkedAt??null,price_status:price?.status??'unavailable'};
}
export function messageCosts(calls:Record<string,unknown>[]){
 let input=0,output=0,total=0,known=0,splitKnown=0,estimated=false;
 for(const c of calls){
  const actual=number(c.cost_usd);let i=number(c.input_cost_usd),o=number(c.output_cost_usd),value=actual;
  if(actual===0){i=0;o=0;}
  if(actual===null){
   i=number(c.estimated_input_usd);o=number(c.estimated_output_usd);
   if((i===null||o===null)&&c.pricing_version==='groq_2026_11_02'){
    const legacy=generationUsage(String(c.provider),String(c.model),{prompt_tokens:c.input_tokens,completion_tokens:c.output_tokens,prompt_tokens_details:{cached_tokens:c.cached_tokens}});i=legacy.estimated_input_usd;o=legacy.estimated_output_usd;
   }
   value=i!==null&&o!==null?i+o:number(c.list_price_usd);if(value!==null)estimated=true;
  }
  if(value!==null){total+=value;known++;}if(i!==null&&o!==null){input+=i;output+=o;splitKnown++;}
 }
 return {inputUsd:splitKnown===calls.length?input:null,outputUsd:splitKnown===calls.length?output:null,totalUsd:known?total:calls.length?null:0,estimated,partial:known<calls.length,splitComplete:splitKnown===calls.length};
}
export async function traceTool<T>(log:TraceLog|undefined,name:string,source:'model'|'server',operation:()=>Promise<T>,parent?:string):Promise<T>{
 const span=crypto.randomUUID(),start=Date.now();log?.('tool_started','info',{span_id:span,parent_span_id:parent,tool_name:name,tool_source:source});
 try{const result=await operation(),failed=Boolean(result&&typeof result==='object'&&'error' in result&&result.error);log?.('tool_finished',failed?'error':'info',{span_id:span,parent_span_id:parent,tool_name:name,tool_source:source,span_status:failed?'error':'success',duration_ms:Date.now()-start});return result;}
 catch(e){log?.('tool_finished','error',{span_id:span,parent_span_id:parent,tool_name:name,tool_source:source,span_status:'error',duration_ms:Date.now()-start});throw e;}
}
export function summarizeTrace(events:TraceEvent[]){
 const attempts=new Map<string,TraceEvent>(),generations=new Map<string,TraceEvent>(),tools=new Map<string,TraceEvent>();
 for(const e of [...events].sort((a,b)=>a.created_at.localeCompare(b.created_at))){const id=e.request_id+':'+String(e.metadata.span_id||e.id);if(e.stage==='model_request')attempts.set(id,e);if(e.stage==='model_finished')generations.set(id,e);if(e.stage==='tool_started'||e.stage==='tool_finished')tools.set(id,e);}
 const calls:Record<string,unknown>[]=[...attempts].map(([id,start])=>{const end=generations.get(id);return {id,provider:start.metadata.provider,model:start.metadata.model,status:end?.metadata.span_status??'incomplete',...end?.metadata};});
 const sum=(key:string)=>calls.reduce((s,c)=>s+(number((c as Record<string,unknown>)[key])??0),0),complete=(key:string)=>calls.every(c=>number((c as Record<string,unknown>)[key])!==null);
 const latest=(name:string)=>[...events].reverse().find(e=>e.stage===name),ended=latest('turn_saved')??latest('turn_failed')??latest('connection_verified')??latest('connection_failed');
 const costComplete=events.length>0&&complete('cost_usd'),estimatedComplete=events.length>0&&calls.every(c=>number(c.cost_usd)!==null||number(c.list_price_usd)!==null);
 const costs=messageCosts(calls);if(!events.length){costs.totalUsd=null;costs.inputUsd=null;costs.outputUsd=null;costs.partial=true;}
 return {costs,status:latest('turn_failed')||latest('prepare_failed')||latest('connection_failed')?'error':ended?'success':'incomplete',modelCalls:calls.length,calls,inputTokens:sum('input_tokens'),outputTokens:sum('output_tokens'),totalTokens:sum('total_tokens'),tokensComplete:events.length>0&&complete('input_tokens')&&complete('output_tokens'),costUsd:costComplete?sum('cost_usd'):null,estimatedCostUsd:estimatedComplete?calls.reduce((s,c)=>s+(number(c.cost_usd)??number(c.list_price_usd)??0),0):null,costComplete,durationMs:number(ended?.metadata.elapsed_ms),confirmationMs:number(latest('confirm_saved')?.metadata.elapsed_ms),financialSaved:Boolean(latest('confirm_saved')),proposalSaved:Boolean(latest('preview_saved')),proposedOperations:number(latest('plan_validated')?.metadata.operations),tools:[...tools.values()].map(e=>({id:e.metadata.span_id,name:e.metadata.tool_name,source:e.metadata.tool_source,status:e.metadata.span_status??'incomplete',durationMs:number(e.metadata.duration_ms)})),partial:events.some(e=>e.stage==='trace_truncated')};
}

export function summarizeConversation(events:TraceEvent[],requestIds:string[]=[]){
 const groups=new Map<string,TraceEvent[]>();for(const e of events)groups.set(e.request_id,[...(groups.get(e.request_id)??[]),e]);
 for(const id of requestIds)if(!groups.has(id))groups.set(id,[]);
 const messages=[...groups].map(([id,rows])=>({id,summary:summarizeTrace(rows)}));const calls=messages.flatMap(m=>m.summary.calls),sum=(key:'inputTokens'|'outputTokens'|'totalTokens')=>messages.reduce((n,m)=>n+m.summary[key],0);
 const costs=messageCosts(calls),missing=messages.some(m=>!(groups.get(m.id)?.length));if(missing){costs.partial=true;if(!events.length)costs.totalUsd=null;}
 return {messages:messages.length,costs,calls,modelCalls:calls.length,inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),totalTokens:sum('totalTokens'),tokensComplete:messages.every(m=>m.summary.tokensComplete),durationMs:messages.reduce((n,m)=>n+(m.summary.durationMs??0),0),status:messages.some(m=>m.summary.status==='incomplete')?'incomplete':'success',partial:missing||messages.some(m=>m.summary.partial),tools:messages.flatMap(m=>m.summary.tools),financialSaved:messages.some(m=>m.summary.financialSaved)};
}
