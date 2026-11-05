import { createSupabaseAdmin } from '@/lib/supabase-admin';
import { applicationUrl,connectionState,dispatchAuthorized,evolutionConfigured,handled,instanceName,json,ProviderError,sendText } from '@/lib/control/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Delivery={id:string;household_id:string;user_id:string;phone:string;day:string;slot:string};
export async function POST(request:Request){
 if(!dispatchAuthorized(request))return json({error:'Nao autorizado.'},401);
 if(!evolutionConfigured())return json({error:'Evolution API nao configurada.'},503);
 try{
 const target=applicationUrl();const admin=createSupabaseAdmin();const claimed=await admin.rpc('pf_claim_reminders_v1');if(claimed.error)throw claimed.error;
 const jobs=(claimed.data??[]) as Delivery[];
 const outcomes=await Promise.all(jobs.map(async(job)=>{
  let status='sent',error_code:string|null=null,provider_id:string|null=null;
  try{
   // Recheck consent after claiming; a disabled setting must not send from a stale job.
   const setting=await admin.from('pf_reminder_settings').select('whatsapp_enabled,phone,consented_at').eq('household_id',job.household_id).eq('user_id',job.user_id).single();
   if(setting.error)throw setting.error;
   if(!setting.data.whatsapp_enabled||!setting.data.consented_at||setting.data.phone!==job.phone){status='skipped';}
   else{
    const name=instanceName(job.household_id,job.user_id);const connected=await connectionState(name);
    if(!connected.connected){status='failed';error_code='WHATSAPP_DESCONECTADO';}
    else provider_id=await sendText(name,job.phone,`Hora de conferir seu controle financeiro (${job.slot}). Registre o que aconteceu e confirme na ferramenta: ${target}`);
   }
  }catch(e){status=e instanceof ProviderError&&['RESULTADO_DESCONHECIDO','SEM_CONFIRMACAO_DE_ENVIO','RESPOSTA_INVALIDA'].includes(e.code)?'unknown':'failed';error_code=e instanceof ProviderError?e.code:'ERRO_INTERNO';}
  const saved=await admin.from('pf_reminder_outbox').update({status,error_code,provider_id,finished_at:new Date().toISOString()}).eq('id',job.id).eq('status','sending');
  if(saved.error)return{status:'unknown'};return{status};
 }));
 return json({processed:jobs.length,sent:outcomes.filter(o=>o.status==='sent').length,unconfirmed:outcomes.filter(o=>o.status==='unknown').length});
 }catch(e){return handled(e);}
}
