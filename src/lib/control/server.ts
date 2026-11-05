import 'server-only';
import { createHash,timingSafeEqual } from 'node:crypto';
import { createSupabaseAdmin } from '@/lib/supabase-admin';
import { isPhone,isUuid,safeQr } from './core';
export class ControlError extends Error {constructor(message:string,public status=400){super(message);}}
export class ProviderError extends Error {constructor(public code:string,public httpStatus=502){super('Falha na conexao com o WhatsApp.');}}
export const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, max-age=0','Pragma':'no-cache'}});
export function handled(error:unknown):Response{
 if(error instanceof ControlError)return json({error:error.message},error.status);
 if(error instanceof ProviderError)return json({error:`WhatsApp indisponivel (${error.code}). Confira o servidor e a conexao.`},502);
 // Never expose Supabase credentials, provider response bodies or stack traces.
 console.error('[finance-control]',error instanceof Error?error.name:'UnknownError');
 return json({error:'Nao foi possivel concluir. Confira a configuracao do servidor e os SQLs da atualizacao.'},503);
}
export async function authorize(request:Request){
 const household=new URL(request.url).searchParams.get('household')??'';
 if(!isUuid(household))throw new ControlError('Grupo invalido.');
 const authorization=request.headers.get('authorization')??'';
 if(!authorization.startsWith('Bearer ')||authorization.length>9000)throw new ControlError('Sessao obrigatoria.',401);
 const admin=createSupabaseAdmin();const result=await admin.auth.getUser(authorization.slice(7));
 if(result.error||!result.data.user)throw new ControlError('Sessao invalida.',401);
 const user=result.data.user.id;
 const membership=await admin.from('pf_household_members').select('role').eq('household_id',household).eq('user_id',user).maybeSingle();
 if(membership.error||!membership.data||!['owner','member'].includes(membership.data.role))throw new ControlError('Sem permissao para configurar este grupo.',403);
 return{admin,household,user};
}
export function evolutionConfigured(){return Boolean(process.env.EVOLUTION_API_URL?.trim()&&process.env.EVOLUTION_API_KEY?.trim());}
export function instanceName(household:string,user:string){return 'pf-'+createHash('sha256').update(`${household}:${user}`).digest('hex').slice(0,28);}
export async function provider(path:string,method='GET',body?:unknown):Promise<Record<string,unknown>>{
 if(!evolutionConfigured())throw new ControlError('Evolution API ainda nao foi configurada no servidor.',503);
 const base=new URL(process.env.EVOLUTION_API_URL!.trim());
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new ControlError('EVOLUTION_API_URL precisa ser uma URL HTTPS sem credenciais.',503);
 const url=new URL(base.toString().replace(/\/$/,'')+path);
 let response:Response;
 try{response=await fetch(url,{method,headers:{apikey:process.env.EVOLUTION_API_KEY!.trim(),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new ProviderError('RESULTADO_DESCONHECIDO');}
 if(!response.ok)throw new ProviderError(`HTTP_${response.status}`,response.status);
 try{return await response.json() as Record<string,unknown>;}catch{throw new ProviderError('RESPOSTA_INVALIDA');}
}
export async function connectionState(name:string){
 try{const value=await provider(`/instance/connectionState/${encodeURIComponent(name)}`);const instance=value.instance as {state?:string}|undefined;return{exists:true,connected:instance?.state==='open'||instance?.state==='connected'};}catch(e){if(e instanceof ProviderError&&e.httpStatus===404)return{exists:false,connected:false};throw e;}
}
export function qrFrom(value:Record<string,unknown>){return safeQr(value.base64)??safeQr((value.qrcode as Record<string,unknown>|undefined)?.base64);}
export async function sendText(name:string,phone:string,text:string){
 if(!isPhone(phone))throw new ControlError('Telefone invalido.');
 // Contract pinned to Evolution API 2.3.7 SendTextDto: number + text.
 const response=await provider(`/message/sendText/${encodeURIComponent(name)}`,'POST',{number:phone,text,linkPreview:false,delay:0});
 const key=response.key as {id?:unknown}|undefined;
 if(typeof key?.id!=='string')throw new ProviderError('SEM_CONFIRMACAO_DE_ENVIO');
 return key.id;
}
export function applicationUrl(){const value=process.env.APP_PUBLIC_URL?.trim();if(!value)throw new ControlError('APP_PUBLIC_URL nao foi configurada.',503);const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new ControlError('APP_PUBLIC_URL invalida.',503);return url.origin+'/registros';}
export function dispatchAuthorized(request:Request){const secret=process.env.REMINDER_DISPATCH_SECRET??'';const received=request.headers.get('authorization')??'';if(secret.length<32)return false;const expected=Buffer.from(`Bearer ${secret}`);const actual=Buffer.from(received);return actual.length===expected.length&&timingSafeEqual(expected,actual);}
