import { supabase } from '@/lib/supabase';

export const money = (value: number | string | null | undefined) => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(Number(value ?? 0));
export function amount(value: string): number {
  const clean=value.trim().replace(/R\$/g,'').replace(/\s/g,'');
  const parsed=Number(clean.includes(',') ? clean.replace(/\./g,'').replace(',','.') : clean);
  if (!clean || !Number.isFinite(parsed)) throw new Error('Informe um valor valido.');
  return Math.round(parsed*100)/100;
}
export function today(): string { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export function dateLabel(value: string | null | undefined): string {return value ? value.slice(0,10).split('-').reverse().join('/') : 'Nao informado';}
export function errorText(error: unknown): string {return typeof error==='object' && error!==null && 'message' in error ? String(error.message) : 'Nao foi possivel concluir. Tente novamente.';}
export function changed(): void {
 window.dispatchEvent(new Event('pf:financial-data-changed'));
 try {localStorage.setItem('pf:financial-data-version',String(Date.now()));} catch { /* Events still work in restricted storage. */ }
}
export async function rows<T>(table:string, household:string, columns='*', order='id'):Promise<T[]> {
 const result:T[]=[];
 for(let offset=0;;offset+=500){
  const page=await supabase.from(table).select(columns).eq('household_id',household).order(order,{ascending:true}).range(offset,offset+499);
  if(page.error)throw page.error;
  const values=(page.data??[]) as unknown as T[];result.push(...values);
  if(values.length<500)return result;
 }
}
const pendingRequests=new Map<string,string>();
export async function rpc<T=unknown>(name:string, args:Record<string,unknown>):Promise<T>{
 let requestKey:string|undefined;
 if(typeof window!=='undefined'&&typeof args.p_request==='string'){
  const stable={...args};delete stable.p_request;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable)));
  requestKey='pf:pending-rpc:'+name+':'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  let previous=pendingRequests.get(requestKey);
  try {previous=previous??sessionStorage.getItem(requestKey)??undefined;}catch{/* In-memory retry protection remains active. */}
  if(previous)args={...args,p_request:previous};
  pendingRequests.set(requestKey,String(args.p_request));
  try {sessionStorage.setItem(requestKey,String(args.p_request));}catch{}
 }
 const result=await supabase.rpc(name,args);
 if(result.error){
  // Postgres errors are known rollbacks; transport failures retain the same id.
  if(requestKey&&/^[0-9A-Z]{5}$/.test(result.error.code??'')){pendingRequests.delete(requestKey);try{sessionStorage.removeItem(requestKey);}catch{}}
  throw result.error;
 }
 if(requestKey){pendingRequests.delete(requestKey);try{sessionStorage.removeItem(requestKey);}catch{}}
 return result.data as T;
}
export async function serverJson<T>(path:string, household:string, body?:Record<string,unknown>):Promise<T>{
 const {data:{session}}=await supabase.auth.getSession();
 if(!session)throw new Error('Entre novamente na sua conta.');
 const response=await fetch(`${path}?household=${encodeURIComponent(household)}`,{
  method:body?'POST':'GET',
  headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
  body:body?JSON.stringify(body):undefined,
  cache:'no-store'
 });
 const result=await response.json();if(!response.ok)throw new Error(result.error??'Falha no servidor.');return result as T;
}
export async function server<T>(path:string, household:string, action?:string):Promise<T>{
 return serverJson<T>(path,household,action?{action}:undefined);
}
export type Account={id:string;name:string;type:string;balance:number|string;available_credit:number|string|null;credit_limit:number|string|null;is_active:boolean;account_scope:'personal'|'business';reconciliation_required:boolean;institution_name:string|null};
export const bankAccounts=(accounts:Account[])=>accounts.filter(a=>a.is_active&&['checking','savings','cash','wallet'].includes(a.type));

export async function rowResult<T>(table:string,household:string,columns="*"){try{return{data:await rows<T>(table,household,columns),error:null};}catch(e){return{data:null,error:{message:errorText(e)}};}}
