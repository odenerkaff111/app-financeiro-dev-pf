import {chatAccess,chatJson,requireId} from '@/lib/chat-server';
import {familyFailure,FamilyError} from '@/lib/family-server';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams,{db,household,user}=await chatAccess(request,q.get('householdId'));
 const rows=await db.from('pf_chat_plans').select('id,title,card,conversation_id,created_at').eq('household_id',household).eq('created_by',user.id).order('created_at',{ascending:false}).limit(30);
 if(rows.error)throw new FamilyError('Não consegui carregar seus planos.',503);return chatJson({plans:rows.data});
 }catch(e){return familyFailure(e);}}
export async function POST(request:Request){try{
 const body=await request.json(),{db,user,household,conversation}=await chatAccess(request,body.householdId,body.conversationId);
 const message=await db.from('pf_ai_messages').select('parts').eq('id',requireId(body.messageId)).eq('conversation_id',conversation!.id).eq('created_by',user.id).maybeSingle();
 const cards=(message.data?.parts as {cards?:Record<string,unknown>[]} | null)?.cards;
 const index=body.cardIndex;if(!Number.isInteger(index)||index<0||!cards?.[index]||cards[index].kind!=='goal')throw new FamilyError('Escolha uma meta presente nesta conversa.');
 const card=cards[index];
 const row=await db.from('pf_chat_plans').upsert({created_by:user.id,household_id:household,conversation_id:conversation!.id,message_id:body.messageId,card_index:index,title:String(card.title).slice(0,100),card},{onConflict:'message_id,card_index'}).select('id').single();
 if(row.error)throw new FamilyError('Não consegui salvar o plano.',503);return chatJson({saved:true,id:row.data.id});
 }catch(e){return familyFailure(e);}}
export async function DELETE(request:Request){try{
 const body=await request.json(),{db,user}=await chatAccess(request,body.householdId);
 const row=await db.from('pf_chat_plans').delete().eq('id',requireId(body.id)).eq('created_by',user.id);if(row.error)throw new FamilyError('Não consegui remover o plano.',503);return chatJson({removed:true});
 }catch(e){return familyFailure(e);}}
