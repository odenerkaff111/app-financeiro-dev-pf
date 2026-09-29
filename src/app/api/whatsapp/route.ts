import { applicationUrl,authorize,connectionState,ControlError,evolutionConfigured,handled,instanceName,json,provider,qrFrom,sendText } from '@/lib/control/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){try{const{household,user}=await authorize(request);if(!evolutionConfigured())return json({configured:false,connected:false});const state=await connectionState(instanceName(household,user));return json({configured:true,connected:state.connected});}catch(e){return handled(e);}}
export async function POST(request:Request){try{
 const{admin,household,user}=await authorize(request);
 const raw=await request.text();if(raw.length>256)throw new ControlError('Solicitacao invalida.');
 let action:string;try{action=JSON.parse(raw).action;}catch{throw new ControlError('Solicitacao invalida.');}
 if(!['connect','test','logout'].includes(action))throw new ControlError('Acao invalida.');
 if(!evolutionConfigured())throw new ControlError('Configure a Evolution API no servidor primeiro.',503);
 const limited=await admin.rpc('pf_claim_whatsapp_action_v1',{p_household:household,p_user:user,p_action:action});if(limited.error)throw limited.error;if(!limited.data)throw new ControlError('Aguarde 60 segundos antes de repetir esta acao.',429);
 const name=instanceName(household,user);let state=await connectionState(name);
 if(action==='logout'){if(state.exists)await provider(`/instance/logout/${name}`,'DELETE');return json({configured:true,connected:false,message:'Sessao desconectada. Desative os lembretes nas preferencias para interromper tentativas.'});}
 if(action==='connect'){
  if(state.connected)return json({configured:true,connected:true,message:'WhatsApp ja conectado.'});
  let result:Record<string,unknown>={};
  if(!state.exists){result=await provider('/instance/create','POST',{instanceName:name,integration:'WHATSAPP-BAILEYS',qrcode:true,rejectCall:true,msgCall:'',groupsIgnore:true,alwaysOnline:false,readMessages:false,readStatus:false,syncFullHistory:false});}
  let qr=qrFrom(result);if(!qr)qr=qrFrom(await provider(`/instance/connect/${name}`));
  state=await connectionState(name);
  return json({configured:true,connected:state.connected,qr,message:qr?'Leia o QR code no seu WhatsApp.':'QR ainda indisponivel. Aguarde alguns segundos e tente gerar novamente.'});
 }
 const settings=await admin.from('pf_reminder_settings').select('phone,whatsapp_enabled,consented_at').eq('household_id',household).eq('user_id',user).single();if(settings.error)throw settings.error;
 if(!settings.data.whatsapp_enabled||!settings.data.consented_at||!settings.data.phone)throw new ControlError('Salve o telefone e a autorizacao nas preferencias primeiro.');
 if(!state.connected)throw new ControlError('Conecte o WhatsApp pelo QR code primeiro.');
 await sendText(name,settings.data.phone,`Lembrete de teste: confira e registre suas movimentacoes financeiras. ${applicationUrl()}`);
 return json({configured:true,connected:true,message:'Lembrete de teste enviado para o telefone salvo.'});
 }catch(e){return handled(e);}}
