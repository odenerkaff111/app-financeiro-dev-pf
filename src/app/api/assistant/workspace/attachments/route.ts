import {createHash} from 'node:crypto';
import {chatAccess,chatJson,requireId} from '@/lib/chat-server';
import {familyFailure,FamilyError,uuid} from '@/lib/family-server';
import {BUCKET,fileKind,MAX_FILE_BYTES} from '@/lib/chat-workspace';
export const runtime='nodejs';
export async function POST(request:Request){try{
 const body=await request.json(),{db,household,user,conversation}=await chatAccess(request,body.householdId,body.conversationId),id=requireId(body.id);
 if(typeof body.name!=='string'||body.name.length>180||typeof body.mime!=='string')throw new FamilyError('Arquivo inválido.');
 fileKind(body.name,body.mime);
 if(typeof body.path!=='string'||!body.path.startsWith(`${household}/${user.id}/`)||!new RegExp(`^${household}/${user.id}/${id}\\.[a-z0-9]{2,5}$`).test(body.path))throw new FamilyError('Caminho de arquivo inválido.');
 const blob=await db.storage.from(BUCKET).download(body.path);if(blob.error||!blob.data)throw new FamilyError('Não consegui conferir o arquivo enviado.',503);
 if(blob.data.size>MAX_FILE_BYTES||!blob.data.size)throw new FamilyError('Cada arquivo deve ter até 8 MB.');
 const bytes=Buffer.from(await blob.data.arrayBuffer());
 if(body.mime==='application/pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new FamilyError('O arquivo não parece ser um PDF válido.');
 if(body.mime==='image/png'&&bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new FamilyError('Imagem PNG inválida.');
 if(body.mime==='image/jpeg'&&bytes.subarray(0,3).toString('hex')!=='ffd8ff')throw new FamilyError('Imagem JPEG inválida.');
 if(body.mime==='image/webp'&&(bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP'))throw new FamilyError('Imagem WebP inválida.');
 const item={id,household_id:household,conversation_id:conversation!.id,created_by:user.id,path:body.path,name:body.name,mime:body.mime,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const row=await db.from('pf_chat_attachments').upsert(item,{onConflict:'id'}).select('id,name,mime,size,path,sha256').single();
 if(row.error)throw new FamilyError('Não consegui guardar o anexo nesta conversa.',503);return chatJson({attachment:row.data});
 }catch(e){return familyFailure(e);}}
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams,{db,user}=await chatAccess(request,q.get('householdId')),id=requireId(q.get('id'));
 const item=await db.from('pf_chat_attachments').select('path,name').eq('id',id).eq('created_by',user.id).maybeSingle();if(item.error||!item.data)throw new FamilyError('Anexo não encontrado.',404);
 const url=await db.storage.from(BUCKET).createSignedUrl(item.data.path,60);if(url.error)throw new FamilyError('Não consegui abrir o anexo.',503);return chatJson({url:url.data.signedUrl,name:item.data.name});
 }catch(e){return familyFailure(e);}}
export async function DELETE(request:Request){try{
 const body=await request.json(),{db,user}=await chatAccess(request,body.householdId),id=requireId(body.id);
 const row=await db.from('pf_chat_attachments').delete().eq('id',id).eq('created_by',user.id).is('message_id',null).select('path').maybeSingle();if(row.error)throw new FamilyError('Não consegui remover o anexo.',503);
 if(row.data)await db.storage.from(BUCKET).remove([row.data.path]);return chatJson({removed:Boolean(row.data)});
 }catch(e){return familyFailure(e);}}
