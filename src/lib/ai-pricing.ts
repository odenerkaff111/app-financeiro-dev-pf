import 'server-only';
import type {PriceQuote} from './ai-observability';
const cache=new Map<string,{at:number;quote:PriceQuote|null}>();
const finite=(x:unknown)=>(typeof x==='number'||typeof x==='string'&&/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(x))&&Number.isFinite(Number(x))&&Number(x)>=0;
// Fetch public provider quotes only. These are estimates, not account charges.
export async function modelPricing(provider:string,model:string):Promise<PriceQuote|null>{
 const key=provider+':'+model,old=cache.get(key);if(old&&Date.now()-old.at<15*60*1000)return old.quote;
 if(process.env.KYRA_LIVE_PRICING==='false')return null;
 // Cache failures briefly as well; an unavailable public quote must not slow
 // down each model call in a conversation.
 const miss=()=>{cache.set(key,{at:Date.now()-14*60*1000,quote:null});return null;};
 try{
  const id=provider==='groq'?model:model.replace(/:free$/,'')===model?model:model;
  if(!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+$/.test(id))return null;
  const response=await fetch('https://openrouter.ai/api/v1/models/'+id+'/endpoints',{signal:AbortSignal.timeout(1800),cache:'no-store'});if(!response.ok)return miss();
  const body=await response.json();const endpoints=body.data?.endpoints;
  if(!Array.isArray(endpoints))return miss();
  const eligible=endpoints.filter((e:Record<string,unknown>)=>provider!=='groq'||String(e.provider_name).toLowerCase()==='groq');
  // Variable-price OpenRouter routes use the price of the actual response;
  // a public minimum cannot stand in for the provider that really served it.
  const e=provider==='groq'?eligible[0]:model.endsWith(':free')?eligible.find((e:Record<string,unknown>)=>{const p=e.pricing as Record<string,unknown>;return p&&Number(p.prompt)===0&&Number(p.completion)===0;}):null;
  const p=e?.pricing;if(!p||!finite(p.prompt)||!finite(p.completion))return miss();
  const quote:PriceQuote={inputPerM:Number(p.prompt)*1e6,outputPerM:Number(p.completion)*1e6,cachedPerM:finite(p.input_cache_read)?Number(p.input_cache_read)*1e6:null,source:provider==='groq'?'openrouter_groq_public_quote':'openrouter_free_quote',checkedAt:new Date().toISOString(),status:'live_quote'};
  cache.set(key,{at:Date.now(),quote});return quote;
 }catch{return miss();}
}
