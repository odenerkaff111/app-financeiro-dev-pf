import {
  familyAuthorize,
  familyFailure,
  FamilyError,
  familyJson,
  uuid,
} from "@/lib/family-server";
export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as {
      householdId?: unknown;
      conversationId?: unknown;
    };
    const { db, household, user } = await familyAuthorize(
      request,
      body.householdId,
      true,
    );
    if (!uuid(body.conversationId)) throw new FamilyError("Conversa inválida.");
    const conversation = await db
      .from("pf_ai_conversations")
      .select("id")
      .eq("id", body.conversationId)
      .eq("household_id", household)
      .eq("created_by", user.id)
      .maybeSingle();
    if (conversation.error || !conversation.data)
      throw new FamilyError("Conversa não autorizada.", 403);
    const pending = await db
      .from("pf_ai_messages")
      .select("action_payload")
      .eq("conversation_id", body.conversationId)
      .eq("created_by", user.id)
      .eq("action_type", "batch_update")
      .eq("action_status", "pending");
    if (pending.error)
      throw new FamilyError("Não consegui consultar as propostas.", 503);
    for (const row of pending.data ?? []) {
      const batch = (row.action_payload as { batch_id?: string })?.batch_id;
      if (uuid(batch)) {
        const r = await db.rpc("pf_cancel_ai_finance_batch_v1", {
          p_batch: batch,
        });
        if (r.error)
          throw new FamilyError("Não consegui cancelar a proposta.", 409);
      }
    }
    const updated = await db
      .from("pf_ai_messages")
      .update({ action_status: "cancelled" })
      .eq("conversation_id", body.conversationId)
      .eq("created_by", user.id)
      .eq("action_type", "batch_update")
      .eq("action_status", "pending");
    if (updated.error)
      throw new FamilyError("Não consegui atualizar a conversa.", 503);
    const discarded = await db
      .from("pf_ai_drafts")
      .delete()
      .eq("conversation_id", body.conversationId)
      .eq("household_id", household)
      .eq("created_by", user.id);
    if (discarded.error)
      throw new FamilyError("Não consegui descartar o rascunho.", 503);
    return familyJson({ success: true });
  } catch (error) {
    return familyFailure(error);
  }
}
