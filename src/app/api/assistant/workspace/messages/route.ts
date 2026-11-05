import { chatAccess, chatJson, safeCursor } from '@/lib/chat-server';
import { familyFailure, FamilyError } from '@/lib/family-server';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams,{db,user,conversation}=await chatAccess(request,q.get('householdId'),q.get('conversationId'));
 let query=db.from('pf_ai_messages').select('id,role,content,created_at,parts,action_type,action_status,action_payload,error_message').eq('conversation_id',conversation!.id).eq('created_by',user.id).in('role',['user','assistant']).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(41);
 const cursor=safeCursor(q.get('before'));if(cursor)query=query.or(`created_at.lt.${cursor.time},and(created_at.eq.${cursor.time},id.lt.${cursor.id})`);
 const rows=await query;if(rows.error)throw new FamilyError('Não consegui carregar as mensagens.',503);
 const page=(rows.data??[]).slice(0,40),oldest=page.at(-1);
 const state=await db.from('pf_chat_requests').select('id,status,created_at,error_message').eq('conversation_id',conversation!.id).eq('created_by',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(state.error)throw new FamilyError('Não consegui recuperar o estado da conversa. Confira o SQL do novo chat.',503);
 return chatJson({messages:page.reverse(),hasMore:(rows.data?.length??0)>40,cursor:oldest?`${oldest.created_at}|${oldest.id}`:null,request:state.data});
 }catch(e){return familyFailure(e);}}
