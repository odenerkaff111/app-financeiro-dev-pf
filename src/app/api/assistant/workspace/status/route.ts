import {chatAccess,chatJson} from '@/lib/chat-server';
import {familyFailure} from '@/lib/family-server';
import {getAiRuntimeSettings} from '@/lib/ai-server';
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams,{db,household}=await chatAccess(request,q.get('householdId')),settings=await getAiRuntimeSettings(db,household);
 const provider=process.env.KYRA_CHAT_PROVIDER||(process.env.GROQ_API_KEY&&process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED==='true'?'groq':'openrouter');
 const schema=await db.from('pf_chat_requests').select('id',{head:true,count:'exact'}).limit(1);
 const consultor=provider==='groq'?Boolean(process.env.GROQ_API_KEY)&&process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED==='true':provider==='openrouter'&&Boolean(process.env.OPENROUTER_API_KEY);
 return chatJson({schemaReady:!schema.error,isEnabled:settings.isEnabled,registrar:{provider:'groq',configured:Boolean(process.env.GROQ_API_KEY)&&process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED==='true',model:process.env.GROQ_BATCH_MODEL||'openai/gpt-oss-120b'},consultor:{provider,configured:consultor,model:process.env.KYRA_COACH_MODEL||(provider==='groq'?(process.env.GROQ_BATCH_MODEL||'openai/gpt-oss-120b'):settings.model)},vision:{provider:process.env.KYRA_VISION_PROVIDER||null,configured:process.env.KYRA_VISION_PROVIDER==='openrouter'&&Boolean(process.env.KYRA_VISION_MODEL)&&Boolean(process.env.OPENROUTER_API_KEY),model:process.env.KYRA_VISION_MODEL||null}});
 }catch(e){return familyFailure(e);}}
