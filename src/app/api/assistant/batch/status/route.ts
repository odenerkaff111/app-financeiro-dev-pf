import {fallbackStatus} from "@/lib/llm-fallback";
import {langfuseState} from "@/lib/langfuse-export";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(request:Request) {
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"").trim();
  if (!token) return NextResponse.json({error:"Sessão obrigatória."},{status:401});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key=(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url||!key) return NextResponse.json({error:"Supabase não configurado."},{status:503});
  const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},
    auth:{autoRefreshToken:false,persistSession:false}});
  const {data,error}=await db.auth.getUser();
  if (error||!data.user) return NextResponse.json({error:"Sessão inválida."},{status:401});
  return NextResponse.json({
    fallback:fallbackStatus(),
    langfuse:langfuseState(),
    provider:"groq",
    model:process.env.GROQ_BATCH_MODEL?.trim()||"openai/gpt-oss-120b",
    apiKeyConfigured:Boolean(process.env.GROQ_API_KEY?.trim()),
    zdrAcknowledged:process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED==="true",
    ready:Boolean(process.env.GROQ_API_KEY?.trim())&&process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED==="true",
  });
}
