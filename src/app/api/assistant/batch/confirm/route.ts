import {traceTool} from "@/lib/ai-observability";
import {aiTrace} from "@/lib/ai-diagnostics";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function confirmBatch(request:Request,progress?:(step:string)=>void) {
  progress?.('checking_confirmation');
  let trace:ReturnType<typeof aiTrace>|undefined;
  try {
    const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"").trim();
    if (!token) return NextResponse.json({error:"Faça login novamente."},{status:401});
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key=(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
    if (!url||!key) throw new Error("Supabase não configurado.");
    const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},
      auth:{autoRefreshToken:false,persistSession:false}});
    const user=await db.auth.getUser();
    if (user.error||!user.data.user) return NextResponse.json({error:"Sessão expirada."},{status:401});
    const body=await request.json() as {batchId?:unknown;messageId?:unknown};
    if (!isUuid(body.batchId)||!isUuid(body.messageId)) {
      return NextResponse.json({error:"Proposta inválida."},{status:400});
    }
    // Vinculo entre proposta exibida, lote e criador. A RPC de confirmação
    // revalida permissoes, estado e snapshot, com bloqueio transacional.
    const [msg,batch]=await Promise.all([
      db.from("pf_ai_messages").select("id,household_id,created_by,conversation_id,action_type,action_payload,action_status,parts")
        .eq("id",body.messageId).maybeSingle(),
      db.from("pf_ai_finance_batches").select("id,household_id,created_by,status,operation_version")
        .eq("id",body.batchId).maybeSingle(),
    ]);
    if (msg.error||batch.error||!msg.data||!batch.data ||
        msg.data.household_id!==batch.data.household_id ||
        msg.data.created_by!==user.data.user.id ||
        batch.data.created_by!==user.data.user.id ||
        msg.data.action_type!=="batch_update" ||
        (msg.data.action_payload as {batch_id?:string}|null)?.batch_id!==body.batchId) {
      return NextResponse.json({error:"Plano não pertence a esta mensagem."},{status:403});
    }
    if (!["pending","confirmed"].includes(String(msg.data.action_status))) {
      return NextResponse.json({error:"Esta proposta foi cancelada."},{status:409});
    }
    const conversation=await db.from('pf_ai_conversations').select('agent,created_by').eq('id',msg.data.conversation_id).maybeSingle();
    if(conversation.error||!conversation.data||conversation.data.created_by!==user.data.user.id||conversation.data.agent!=='registrar') {
      return NextResponse.json({error:'Use o agente Registrar para confirmar alterações.'},{status:403});
    }
    const origin=(msg.data.parts as {requestId?:string}|null)?.requestId;
    trace=aiTrace(db,batch.data.household_id,user.data.user.id,isUuid(origin)?origin:msg.data.id,msg.data.conversation_id);
    trace.event('confirm_start','info');
    progress?.('saving_finances');
    const rpc=batch.data.operation_version===2?"pf_confirm_ai_finance_batch_v2":"pf_confirm_ai_finance_batch_v1";
    const confirmed=await traceTool(trace.event,rpc,'server',async()=>await db.rpc(rpc,{p_batch:body.batchId}));
    if (confirmed.error) {trace.event("confirm_rejected","error",{provider_code:confirmed.error.code});return NextResponse.json({error:confirmed.error.message},{status:409});}
    progress?.('updating_chat');
    if(batch.data.operation_version===2){await db.from('pf_ai_drafts').delete().eq('conversation_id',msg.data.conversation_id).eq('created_by',user.data.user.id).eq('household_id',batch.data.household_id);}
    const update=await db.from("pf_ai_messages")
      .update({action_status:"confirmed",updated_at:new Date().toISOString(),error_message:null})
      .eq("id",body.messageId).eq("household_id",batch.data.household_id);
    // A operacao no banco JA foi confirmada mesmo se o marcador do chat falhar.
    trace.event("confirm_saved","info");
    progress?.('confirmed');
    return NextResponse.json({success:true,results:confirmed.data,chatSynced:!update.error,
      message:"Atualização financeira registrada. Confira os saldos e faturas no Painel."});
  } catch(error) {
    trace?.event("confirm_failed","error");
    const msg=error instanceof Error?error.message:"Falha de confirmação.";
    return NextResponse.json({error:msg},{status:500});
  } finally {await trace?.flush();}
}

export const maxDuration=90;
export async function POST(request:Request){
 if(!request.headers.get('accept')?.includes('application/x-ndjson'))return confirmBatch(request);
 const encoder=new TextEncoder();let closed=false;
 const stream=new ReadableStream({async start(controller){
  const emit=(type:string,data:unknown)=>{if(!closed)try{controller.enqueue(encoder.encode(JSON.stringify({type,data})+'\n'));}catch{closed=true;}};
  try{const response=await confirmBatch(request,step=>emit('progress',{step,phase:'confirm'})),body=await response.json();if(!response.ok)emit('error',{message:body.error||'Não consegui confirmar.',status:response.status});else emit('done',body);}
  catch{emit('error',{message:'A conexão terminou sem confirmação. Confira o estado do registro antes de tentar novamente.',status:503});}
  finally{if(!closed){closed=true;try{controller.close();}catch{}}}
 }});
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store, no-transform'}});
}
