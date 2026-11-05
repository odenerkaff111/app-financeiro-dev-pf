import 'server-only';
import { familyAuthorize, FamilyError, familyJson, uuid } from './family-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatAgent, ChatConversation } from './chat-workspace';
export { familyJson as chatJson };
export async function chatAccess(request:Request,household:unknown,conversationId?:unknown){
 const access=await familyAuthorize(request,household);
 if(conversationId!==undefined){
  if(!uuid(conversationId))throw new FamilyError('Conversa inválida.');
  const row=await access.db.from('pf_ai_conversations').select('id,title,agent,archived_at,last_message_at').eq('id',conversationId).eq('household_id',access.household).eq('created_by',access.user.id).maybeSingle();
  if(row.error)throw new FamilyError('A estrutura do novo chat ainda não está instalada. Rode o SQL do pacote e atualize esta página.',503);
  if(!row.data)throw new FamilyError('Conversa não autorizada.',403);
  return {...access,conversation:row.data as ChatConversation};
 }
 return {...access,conversation:null};
}
export function chatAgent(v:unknown):ChatAgent{if(v!=='registrar'&&v!=='consultor')throw new FamilyError('Escolha Registrar ou Consultor.');return v;}
export function requireId(v:unknown){if(!uuid(v))throw new FamilyError('Identificador inválido.');return v;}
export function safeCursor(value:string|null):{time:string;id:string}|null{
 if(!value)return null;const [time,id]=value.split('|');
 if(!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(time)||!uuid(id)||!Number.isFinite(Date.parse(time)))throw new FamilyError('Página inválida.');return {time,id};
}
export async function chatUsage(db:SupabaseClient,household:string,user:string){
 const result=await db.from('pf_ai_usage').select('id',{count:'exact',head:true}).eq('household_id',household).eq('created_by',user).gte('created_at',new Date(Date.now()-3600000).toISOString());
 if(result.error)throw new FamilyError('Não consegui verificar o limite de uso. Tente novamente.',503);
 if((result.count??0)>=40)throw new FamilyError('Limite de análises por hora atingido. Tente novamente depois.',429);
 const claim=await db.rpc('pf_claim_ai_model_request_v1',{p_household:household});
 if(claim.error)throw new FamilyError('Aguarde um pouco antes de fazer outra análise.',429);
}
