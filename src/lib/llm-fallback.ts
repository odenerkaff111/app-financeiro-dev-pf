import 'server-only';
import {FamilyError} from './family-server';
export class ModelRequestError extends FamilyError{
 constructor(message:string,status=503,public retryable=false){super(message,status);}
}
export function fallbackConfiguration(){
 const model=process.env.KYRA_FALLBACK_MODEL?.trim()||'nvidia/nemotron-3.5-super-vl:free';
 const paid=process.env.KYRA_FALLBACK_ALLOW_PAID==='true';
 const enabled=process.env.KYRA_AI_FALLBACK!=='off';
 const key=process.env.OPENROUTER_API_KEY?.trim();
 const valid=/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+$/.test(model)&&(paid||model.endsWith(':free'));
 return {provider:'openrouter' as const,model,key,paid,enabled,ready:Boolean(enabled&&key&&valid),url:'https://openrouter.ai/api/v1/chat/completions'};
}
export function fallbackStatus(){const c=fallbackConfiguration();return {provider:c.provider,model:c.model,configured:Boolean(c.key),enabled:c.enabled,ready:c.ready,freeOnly:!c.paid};}
export function fallbackOptions(){
 const c=fallbackConfiguration();
 return {data_collection:'deny',ignore:['groq'],require_parameters:true,...(process.env.KYRA_FALLBACK_REQUIRE_ZDR==='true'?{zdr:true}:{}),...(!c.paid?{max_price:{prompt:0,completion:0}}:{})};
}
export function canFallback(error:unknown,provider:string,signal:AbortSignal|undefined,emitted=false){
 return provider==='groq'&&!emitted&&!signal?.aborted&&fallbackConfiguration().ready&&(error instanceof ModelRequestError?error.retryable:error instanceof TypeError||error instanceof Error&&['TimeoutError','AbortError'].includes(error.name));
}
export function attemptSignal(parent?:AbortSignal){return parent?AbortSignal.any([parent,AbortSignal.timeout(22000)]):AbortSignal.timeout(22000);}
