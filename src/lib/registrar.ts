import {
  assertAiUsageAllowed,
  getAiRuntimeSettings,
  recordAiUsage,
} from "@/lib/ai-server";
import {
  familyAuthorize,
  familyFailure,
  FamilyError,
  familyJson,
  loadFamilyData,
  uuid,
} from "@/lib/family-server";
import {
  assessPurchase,
  brazilDay,
  buildFamilyOverview,
} from "@/lib/family-finance";
import {
  deterministicReply,
  familyAliases,
  FAMILY_SCHEMA,
  previewBalances,
  validateFamilyPlan,
  questionMonth,
} from "@/lib/family-operations";
import {aiTrace} from '@/lib/ai-diagnostics';
import {generationUsage,traceTool} from '@/lib/ai-observability';
import {plannerContext,registrarSystem} from '@/lib/groq-planner';
import {registrarPlan} from '@/lib/registrar-planner';
import {dateClarification,previewSummary,type ChatProgress} from '@/lib/chat-presentation';
type Turn = { role: "user" | "assistant"; content: string };
export async function prepareRegistrar(request: Request,onProgress?:(progress:ChatProgress)=>void) {
  let trace:ReturnType<typeof aiTrace>|undefined;
  let stage='authorize';
  let requestId=request.headers.get('x-kyra-request-id')||crypto.randomUUID();
  if(!uuid(requestId))requestId=crypto.randomUUID();
  try {
    const body = (await request.json()) as {
      householdId?: unknown;
      conversationId?: unknown;
      message?: unknown;
    };
    const { db, household, user, role } = await familyAuthorize(
      request,
      body.householdId,
    );
    trace=aiTrace(db,household,user.id,requestId,uuid(body.conversationId)?body.conversationId:null);
    trace.event('prepare_start','info');
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 65000 || !uuid(body.conversationId))
      throw new FamilyError(
        "Informe um pedido de até 65.000 caracteres em uma conversa válida.",
      );
    const conversationId = body.conversationId;
    const conversation = await db
      .from("pf_ai_conversations")
      .select("id,agent")
      .eq("id", conversationId)
      .eq("household_id", household)
      .eq("created_by", user.id)
      .maybeSingle();
    if (conversation.error || !conversation.data)
      throw new FamilyError("Conversa não autorizada.", 403);
    if (conversation.data.agent !== 'registrar')
      throw new FamilyError('Use o agente Registrar para preparar alterações financeiras.',403);
    onProgress?.({step:'checking_finances',phase:'prepare'});
    stage='load_finance';
    const data = await traceTool(trace.event,'load_financial_context','server',async()=>loadFamilyData(db, household)),
      today = brazilDay(),
      view = buildFamilyOverview(data, questionMonth(message, today), today);
    const dateQuestion=dateClarification(message,today);
    const local = dateQuestion?null:deterministicReply(message, view);
    if (local)
      return familyJson({
        reply: local,
        operations: [],
        batchId: null,
        model: "financial-read-model",
      });
    const normalized = message
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (
      /posso.*(comprar|pedir|gastar)|cabe.*(pizza|compra)|comprar.*posso/.test(
        normalized,
      ) &&
      !/(comprei|paguei|recebi|registre)/.test(normalized)
    ) {
      const match = normalized.match(
        /(?:r\$\s*|(?:de|valor de|gastar)\s+)(\d+(?:\.\d{3})*(?:,\d{1,2})?)(?:\s*(?:reais|no|na|hoje|amanha|\?|$))/,
      );
      const amount = match
        ? Math.round(
            Number(match[1].replace(/\./g, "").replace(",", ".")) * 100,
          )
        : 0;
      const explicitDay = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
      const shortDay = normalized.match(
        /(?:dia |em )?(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/,
      );
      const purchaseDay =
        explicitDay ??
        (shortDay
          ? `${shortDay[3] ?? today.slice(0, 4)}-${shortDay[2].padStart(2, "0")}-${shortDay[1].padStart(2, "0")}`
          : /amanha/.test(normalized)
            ? new Date(Date.parse(today + "T12:00:00Z") + 86400000)
                .toISOString()
                .slice(0, 10)
            : today);
      const reply =
        /semana|mes que vem|proximo mes/.test(normalized) &&
        !explicitDay &&
        !shortDay
          ? "Em que data você pretende fazer a compra e qual será a forma de pagamento?"
          : amount
            ? assessPurchase(
                view,
                amount,
                purchaseDay,
                /credito|cartao/.test(normalized) ? "credit" : "debit",
              ).reply
            : "Qual é o valor, a data e a forma de pagamento da compra?";
      return familyJson({
        reply,
        operations: [],
        batchId: null,
        model: "financial-read-model",
      });
    }
    if (!["owner", "member"].includes(role))
      return familyJson({
        reply:
          "Sua conta tem acesso de leitura. Consulte saldos e faturas; alterações exigem permissão de edição.",
        operations: [],
        batchId: null,
      });
    const draft = await db
      .from("pf_ai_drafts")
      .select("transcript")
      .eq("conversation_id", conversationId)
      .eq("household_id", household)
      .eq("created_by", user.id)
      .maybeSingle();
    if (draft.error)
      throw new FamilyError(
        "Instale a migração financeira v2 para usar a conversa com rascunhos persistentes.",
        503,
      );
    let turns: Turn[] = Array.isArray(draft.data?.transcript)
      ? draft.data.transcript
      : [];
    // Never silently truncate an unresolved multi-day request.
    if (JSON.stringify(turns).length + message.length > 65000)
      throw new FamilyError(
        "O rascunho ficou muito longo. Confirme ou descarte o pedido atual antes de começar outro.",
      );
    if (turns.at(-1)?.role !== "user" || turns.at(-1)?.content !== message)
      turns = [...turns, { role: "user", content: message }];
    const saved = await db.from("pf_ai_drafts").upsert({
      conversation_id: conversationId,
      household_id: household,
      created_by: user.id,
      transcript: turns,
      updated_at: new Date().toISOString(),
    });
    if (saved.error)
      throw new FamilyError(
        "Não consegui preservar o pedido. Nenhuma movimentação foi preparada.",
        503,
      );
    stage='model_settings';
    if(dateQuestion){
      await cancelPreviousPreviews(db,household,user.id,conversationId);
      const storedQuestion=await db.from('pf_ai_drafts').update({transcript:[...turns,{role:'assistant',content:dateQuestion}],updated_at:new Date().toISOString()}).eq('conversation_id',conversationId).eq('created_by',user.id);
      if(storedQuestion.error)throw new FamilyError('Não consegui guardar a pergunta de esclarecimento.',503);
      trace.event('clarification_required','info',{reason:'conflicting_date'});onProgress?.({step:'clarification',phase:'prepare'});
      return familyJson({reply:dateQuestion,operations:[],batchId:null,model:'date-validation'});
    }
    const settings = await getAiRuntimeSettings(db, household);
    await assertAiUsageAllowed(db, household, settings);
    const key = process.env.GROQ_API_KEY?.trim();
    if (!key || process.env.KYRA_GROQ_ZDR_ACKNOWLEDGED !== "true")
      throw new FamilyError(
        "Ative o assistente em Configurações → IA: configure GROQ_API_KEY e KYRA_GROQ_ZDR_ACKNOWLEDGED=true no servidor depois de habilitar Zero Data Retention na Groq. Seu pedido ficou salvo; você pode tentar novamente.",
        503,
      );
    const usage = await db
      .from("pf_ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("household_id", household)
      .eq("created_by", user.id)
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (usage.error)
      throw new FamilyError("Não consegui conferir o limite de análises.", 503);
    if ((usage.count ?? 0) >= 20)
      throw new FamilyError(
        "Limite de 20 análises por hora. Tente novamente depois.",
        429,
      );
    const claimed = await db.rpc("pf_claim_ai_model_request_v1", {
      p_household: household,
    });
    if (claimed.error)
      throw new FamilyError("Aguarde antes de fazer outra análise.", 429);
    const aliases = familyAliases(data),
      model = process.env.GROQ_BATCH_MODEL?.trim() || "openai/gpt-oss-120b";
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 65000);
    const system=(context:unknown)=>registrarSystem(today,context);
    let output;
    let modelAliases=aliases;
    try {
      stage='model_context';
      const fitted=plannerContext(aliases,view,turns,FAMILY_SCHEMA,system,trace.event);
      modelAliases=fitted.aliases;
      stage='model_call';
      onProgress?.({step:'understanding',phase:'prepare'});
      output=await registrarPlan({key,model,messages:fitted.messages,schema:FAMILY_SCHEMA,maxOutput:fitted.maxOutput,signal:controller.signal,log:trace.event},()=>onProgress?.({step:'fallback',phase:'prepare'}));
    } finally { clearTimeout(timer); }
    const content = output.choices?.[0]?.message?.content;
    if (!content)
      throw new FamilyError("A análise ficou incompleta. Tente novamente.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new FamilyError(
        "Resposta inválida da IA. Nenhum registro foi alterado.",
      );
    }
    let plan;
    try {
      stage='validate_plan';
      onProgress?.({step:'validating_plan',phase:'prepare'});
      plan = await traceTool(trace.event,'validate_financial_plan','server',async()=>validateFamilyPlan(parsed, modelAliases, today));
      trace.event('plan_validated','info',{operations:plan.operations.length});
    } catch (error) {
      throw new FamilyError(
        error instanceof Error ? error.message : "Plano inválido.",
      );
    }
    await recordAiUsage(db, {
      householdId: household,
      userId: user.id,
      provider: output.provider || "groq",
      model: output.model || model,
      requestKind: "family_plan_v2",
      status: "success",
      promptTokens: output.usage?.prompt_tokens ?? 0,
      completionTokens: output.usage?.completion_tokens ?? 0,
      totalTokens: output.usage?.total_tokens ?? 0,
      costUsd: generationUsage(output.provider||'groq',output.model||model,output.usage??{},output.provider==='groq'&&process.env.KYRA_GROQ_BILLING_MODE==='free').cost_usd??0,
      generationId: output.id ?? null,
    });
    const stored = await db
      .from("pf_ai_drafts")
      .update({
        transcript: [...turns, { role: "assistant", content: plan.reply }],
        updated_at: new Date().toISOString(),
      })
      .eq("conversation_id", conversationId)
      .eq("created_by", user.id);
    if (stored.error)
      throw new FamilyError(
        "Não consegui salvar o esclarecimento. Tente novamente.",
      );
    await cancelPreviousPreviews(db,household,user.id,conversationId);
    if (!plan.operations.length)
      return familyJson({
        reply: plan.reply,
        operations: [],
        batchId: null,
        model,
      });
    stage='save_preview';
    onProgress?.({step:'building_preview',phase:'prepare'});
    const prepared = await traceTool(trace.event,'pf_prepare_ai_finance_batch_v2','server',async()=>await db.rpc("pf_prepare_ai_finance_batch_v2", {
      p_household: household,
      p_operations: plan.operations,
    }));
    if (prepared.error || !prepared.data)
      throw new FamilyError(
        prepared.error?.message ?? "Não foi possível salvar a prévia.",
        409,
      );
    trace.event('preview_saved','info',{operations:plan.operations.length});
    onProgress?.({step:'review_ready',phase:'prepare'});
    return familyJson({
      reply: previewSummary(plan.preview),
      operations: plan.preview,
      balances: previewBalances(plan.operations, aliases),
      batchId: String(prepared.data),
      model,
    });
  } catch (error) {
    trace?.event('prepare_failed','error',{reason:stage});
    if (error instanceof Error && error.name === "AbortError")
      return familyJson(
        { error: "A análise demorou. Seu pedido está salvo; tente novamente." },
        504,
      );
    return familyFailure(error);
  } finally { await trace?.flush(); }
}

async function cancelPreviousPreviews(db:Awaited<ReturnType<typeof familyAuthorize>>["db"],household:string,userId:string,conversationId:string){
    // Supersede earlier proposals of this same unresolved draft. Confirmed batches stay immutable.
    const prior = await db
      .from("pf_ai_messages")
      .select("action_payload")
      .eq("conversation_id", conversationId)
      .eq("household_id", household)
      .eq("created_by", userId)
      .eq("action_type", "batch_update")
      .eq("action_status", "pending");
    if (prior.error)
      throw new FamilyError("Não consegui conferir a prévia anterior.", 503);
    for (const row of prior.data ?? []) {
      const id = (row.action_payload as { batch_id?: string })?.batch_id;
      if (uuid(id)) {
        const cancel = await db.rpc("pf_cancel_ai_finance_batch_v1", {
          p_batch: id,
        });
        if (cancel.error)
          throw new FamilyError(
            "Não consegui substituir a prévia anterior. Atualize a conversa.",
            409,
          );
      }
    }
    await db
      .from("pf_ai_messages")
      .update({ action_status: "cancelled" })
      .eq("conversation_id", conversationId)
      .eq("created_by", userId)
      .eq("action_type", "batch_update")
      .eq("action_status", "pending");
}
