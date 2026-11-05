import {familyAuthorize,familyFailure,familyJson,FamilyError,uuid} from '@/lib/family-server';
import {aiTrace} from '@/lib/ai-diagnostics';
import {summarizeTrace,summarizeConversation,type TraceEvent} from '@/lib/ai-observability';
import {langfuseState} from '@/lib/langfuse-export';
import {chatUsage,chatAccess,safeCursor} from '@/lib/chat-server';
import {fallbackStatus} from '@/lib/llm-fallback';
import {openrouterPlan} from '@/lib/registrar-planner';
import {groqPlan} from '@/lib/groq-planner';
import {FAMILY_SCHEMA} from '@/lib/family-operations';
import {getAiRuntimeSettings,recordAiUsage} from '@/lib/ai-server';
export const runtime='nodejs';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams;
 if(q.get('scope')==='conversation'){
  const {db,household,user,conversation}=await chatAccess(request,q.get('householdId'),q.get('conversationId')),cursor=safeCursor(q.get('cursor'));
  let query=db.from('pf_chat_requests').select('id,status,created_at').eq('household_id',household).eq('created_by',user.id).eq('conversation_id',conversation!.id).order('created_at',{ascending:true}).order('id',{ascending:true}).limit(21);
  if(cursor)query=query.or(`created_at.gt.${cursor.time},and(created_at.eq.${cursor.time},id.gt.${cursor.id})`);
  const page=await query;if(page.error)throw new FamilyError('Não consegui carregar os pedidos desta conversa.',503);
  const requests=(page.data??[]).slice(0,20),ids=requests.map(r=>r.id),events:TraceEvent[]=[];let truncated=false;
  if(ids.length){
   for(let offset=0;offset<10000;offset+=1000){
    const rows=await db.from('pf_ai_diagnostics').select('id,request_id,stage,level,metadata,created_at').eq('household_id',household).eq('created_by',user.id).eq('conversation_id',conversation!.id).in('request_id',ids).order('created_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+999);
    if(rows.error)throw new FamilyError('Não consegui consultar as etapas da conversa.',503);
    events.push(...(rows.data??[]) as TraceEvent[]);if((rows.data?.length??0)<1000)break;if(offset===9000)truncated=true;
   }
  }
  const messages=ids.length?await db.from('pf_ai_messages').select('id,content').eq('household_id',household).eq('created_by',user.id).eq('role','user').in('id',ids):{data:[],error:null};
  if(messages.error)throw new FamilyError('Não consegui identificar as mensagens do histórico.',503);
  const hasMore=(page.data?.length??0)>20,last=requests.at(-1),processing=requests.some(r=>r.status==='processing'&&Date.now()-Date.parse(r.created_at)<125000);
  const items=requests.map(r=>({id:r.id,status:r.status,createdAt:r.created_at,label:messages.data?.find(m=>m.id===r.id)?.content.slice(0,180)||'Pedido com anexo',summary:summarizeTrace(events.filter(e=>e.request_id===r.id))}));
  return familyJson({storageReady:true,scope:'conversation',conversationId:conversation!.id,requests:items,events,summary:summarizeConversation(events,ids),hasMore,nextCursor:hasMore&&last?last.created_at+'|'+last.id:null,processing,partial:truncated,langfuse:langfuseState(),fallback:fallbackStatus()});
 }
 const {db,household,user}=await familyAuthorize(request,q.get('householdId'));
 let id=q.get('requestId');if(id&&!uuid(id))throw new FamilyError('Pedido inválido.');
 if(!id){const latest=await db.from('pf_ai_diagnostics').select('request_id').eq('household_id',household).eq('created_by',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();if(latest.error)return familyJson({storageReady:false,events:[],summary:null,message:'Não consegui consultar o histórico técnico.'});id=latest.data?.request_id??null;}
 if(!id)return familyJson({storageReady:true,events:[],summary:null,selectedRequestId:null});
 const rows=await db.from('pf_ai_diagnostics').select('id,request_id,stage,level,metadata,created_at').eq('household_id',household).eq('created_by',user.id).eq('request_id',id).order('created_at',{ascending:true}).order('id',{ascending:true}).limit(261);
 if(rows.error)return familyJson({storageReady:false,events:[],summary:null,message:'Não consegui consultar este rastreamento. Os eventos também são enviados ao terminal.'});
 const events=(rows.data??[]).slice(0,260) as TraceEvent[],summary=summarizeTrace(events);summary.partial=summary.partial||(rows.data?.length??0)>260;
 const state=await db.from('pf_chat_requests').select('status,created_at').eq('id',id).eq('household_id',household).eq('created_by',user.id).maybeSingle();
 const processing=state.data?.status==='processing'&&Date.now()-Date.parse(state.data.created_at)<125000;
 return familyJson({storageReady:true,events,summary,selectedRequestId:id,processing,requestStatus:state.data?.status??null,langfuse:langfuseState(),fallback:fallbackStatus()});
 }catch(e){return familyFailure(e);}}
export async function POST(request:Request){
 let trace:ReturnType<typeof aiTrace>|undefined;const requestId=crypto.randomUUID();
 try{
 const body=await request.json(),{db,household,user}=await familyAuthorize(request,body.householdId),settings=await getAiRuntimeSettings(db,household);
 trace=aiTrace(db,household,user.id,requestId);trace.event('connection_test','info');
 if(!settings.isEnabled)throw new FamilyError('Ative a IA nas configurações.',503);
 const key=process.env.GROQ_API_KEY,model=process.env.GROQ_BATCH_MODEL||'openai/gpt-oss-120b';
 if(body.target!=='fallback'&&(!key||process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED!=='true'))throw new FamilyError('Conclua a configuração da Groq e o aceite de ZDR no servidor.',503);
 await chatUsage(db,household,user.id);
 const result=await (body.target==='fallback'?openrouterPlan:groqPlan)({key:key||'',model,messages:[{role:'system',content:'Teste técnico com dados fictícios. Retorne exatamente {"reply":"Conexão verificada","operations":[]}. Não solicite nem execute ferramentas.'}],schema:FAMILY_SCHEMA,maxOutput:512,signal:AbortSignal.timeout(30000),log:trace.event});
 const parsed=JSON.parse(result.choices?.[0]?.message?.content||'null');
 if(!parsed||typeof parsed.reply!=='string'||!Array.isArray(parsed.operations)||parsed.operations.length)throw new FamilyError('O modelo respondeu fora do contrato do teste.',503);
 trace.event('connection_verified','info');
 await recordAiUsage(db,{householdId:household,userId:user.id,provider:result.provider||'groq',model:result.model||model,requestKind:'chat_connection_test',status:'success',promptTokens:result.usage?.prompt_tokens,completionTokens:result.usage?.completion_tokens,totalTokens:result.usage?.total_tokens});
 return familyJson({success:true,requestId,model:result.model||model,message:'Conexão e formato estruturado verificados. Nenhuma movimentação financeira foi criada.'});
 }catch(e){trace?.event('connection_failed','error');return familyJson({error:e instanceof FamilyError?e.message:'Não consegui concluir o teste de conexão.',requestId},e instanceof FamilyError?e.status:503);}
 finally{await trace?.flush();}
}
