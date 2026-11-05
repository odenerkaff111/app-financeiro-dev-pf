import { chatAccess, chatAgent, chatJson, requireId } from '@/lib/chat-server';
import { familyFailure, FamilyError } from '@/lib/family-server';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams,{db,household,user}=await chatAccess(request,q.get('householdId'));
 let query=db.from('pf_ai_conversations').select('id,title,agent,archived_at,last_message_at').eq('household_id',household).eq('created_by',user.id).order('last_message_at',{ascending:false}).order('id',{ascending:false}).limit(100);
 query=q.get('archived')==='true'?query.not('archived_at','is',null):query.is('archived_at',null);
 if(q.get('agent'))query=query.eq('agent',chatAgent(q.get('agent')));
 if(q.get('search'))query=query.ilike('title','%'+q.get('search')!.slice(0,80).replace(/[%_]/g,'')+'%');
 const rows=await query;if(rows.error)throw new FamilyError('Instale o SQL do novo chat para carregar as conversas.',503);
 return chatJson({conversations:rows.data});
 }catch(e){return familyFailure(e);}}
export async function POST(request:Request){try{
 const body=await request.json(),agent=chatAgent(body.agent),{db,household,user}=await chatAccess(request,body.householdId);
 const row=await db.from('pf_ai_conversations').insert({household_id:household,created_by:user.id,agent,title:'Nova conversa'}).select('id,title,agent,archived_at,last_message_at').single();
 if(row.error)throw new FamilyError('Não consegui criar a conversa. Confira o SQL do novo chat.',503);return chatJson({conversation:row.data});
 }catch(e){return familyFailure(e);}}
export async function PATCH(request:Request){try{
 const body=await request.json(),id=requireId(body.id),{db,user}=await chatAccess(request,body.householdId,id);
 const patch:{title?:string;archived_at?:string|null;updated_at:string}={updated_at:new Date().toISOString()};
 if(typeof body.title==='string'){if(!body.title.trim()||body.title.length>100)throw new FamilyError('Use um título de até 100 caracteres.');patch.title=body.title.trim();}
 if(typeof body.archived==='boolean')patch.archived_at=body.archived?new Date().toISOString():null;
 const row=await db.from('pf_ai_conversations').update(patch).eq('id',id).eq('created_by',user.id).select('id,title,agent,archived_at,last_message_at').single();
 if(row.error)throw new FamilyError('Não consegui atualizar a conversa.',503);return chatJson({conversation:row.data});
 }catch(e){return familyFailure(e);}}
