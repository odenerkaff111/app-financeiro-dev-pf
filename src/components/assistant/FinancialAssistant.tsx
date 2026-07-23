"use client";

import Link from "next/link";
import {
  Bot,
  ExternalLink,
  Loader2,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";
import type {
  AssistantApiResponse,
  AssistantContext,
  FinancialActionPayload,
  FinancialActionStatus,
  FinancialActionType,
} from "@/lib/financial-actions";
import {
  emptyPayload,
  getActionCorrectionText,
  getActionProposalText,
} from "@/lib/financial-actions";
import { ProposedActionCard } from "./ProposedActionCard";

type Props = {
  variant?: "page" | "drawer";
  onClose?: () => void;
};

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actionType: FinancialActionType;
  actionStatus: FinancialActionStatus;
  actionPayload: FinancialActionPayload;
  errorMessage: string | null;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  action_type: FinancialActionType | null;
  action_status: FinancialActionStatus;
  action_payload: FinancialActionPayload;
  error_message: string | null;
};

const EMPTY_CONTEXT: AssistantContext = {
  accounts: [],
  categories: [],
  debts: [],
};

function mapMessage(row: MessageRow): UiMessage {
  const actionType = row.action_type ?? "none";
  const actionPayload =
    row.action_payload ?? emptyPayload();

  return {
    id: row.id,
    role: row.role,
    content:
      row.role === "assistant" &&
      actionType !== "none"
        ? getActionProposalText(
            actionType,
            actionPayload,
          )
        : row.content,
    actionType,
    actionStatus: row.action_status ?? "none",
    actionPayload,
    errorMessage: row.error_message,
  };
}

export function FinancialAssistant({
  variant = "page",
  onClose,
}: Props) {
  const { household } = useHousehold();
  const [context, setContext] =
    useState<AssistantContext>(EMPTY_CONTEXT);
  const [conversationId, setConversationId] =
    useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirmingId, setConfirmingId] =
    useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadAssistant = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [accountsResult, categoriesResult, debtsResult] =
      await Promise.all([
        supabase
          .from("pf_accounts")
          .select("id, name, institution_name, type")
          .eq("household_id", household.id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("pf_categories")
          .select("id, name, kind")
          .eq("household_id", household.id)
          .order("name"),
        supabase
          .from("pf_debt_progress")
          .select(
            "id, creditor, installment_amount, current_balance, status",
          )
          .eq("household_id", household.id)
          .neq("status", "cancelled")
          .order("creditor"),
      ]);

    const firstError =
      accountsResult.error ??
      categoriesResult.error ??
      debtsResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setContext({
      accounts: (accountsResult.data ?? []).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        institution_name: item.institution_name
          ? String(item.institution_name)
          : null,
        type: String(item.type),
      })),
      categories: (categoriesResult.data ?? []).map((item) => ({
        id: String(item.id),
        name: String(item.name),
        kind: String(item.kind),
      })),
      debts: (debtsResult.data ?? []).map((item) => ({
        id: String(item.id),
        creditor: String(item.creditor),
        installment_amount: Number(item.installment_amount ?? 0),
        current_balance: Number(item.current_balance ?? 0),
        status: String(item.status),
      })),
    });

    const conversationResult = await supabase
      .from("pf_ai_conversations")
      .select("id")
      .eq("household_id", household.id)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conversationResult.error) {
      setError(conversationResult.error.message);
      setLoading(false);
      return;
    }

    let id = conversationResult.data?.id
      ? String(conversationResult.data.id)
      : null;

    if (!id) {
      const createResult = await supabase
        .from("pf_ai_conversations")
        .insert({
          household_id: household.id,
          title: "Assistente financeiro",
        })
        .select("id")
        .single();

      if (createResult.error) {
        setError(createResult.error.message);
        setLoading(false);
        return;
      }

      id = String(createResult.data.id);
    }

    setConversationId(id);

    const messagesResult = await supabase
      .from("pf_ai_messages")
      .select(
        "id, role, content, action_type, action_status, action_payload, error_message",
      )
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(100);

    if (messagesResult.error) {
      setError(messagesResult.error.message);
      setLoading(false);
      return;
    }

    setMessages(
      (messagesResult.data ?? []).map((item) =>
        mapMessage(item as unknown as MessageRow),
      ),
    );
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadAssistant();
  }, [loadAssistant]);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, sending]);

  const history = useMemo(
    () =>
      messages.slice(-8).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    [messages],
  );

  async function accessToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      throw new Error("Sua sessão expirou. Entre novamente.");
    }

    return token;
  }

  async function sendMessage() {
    const text = input.trim();

    if (!text || !conversationId || sending) return;

    setSending(true);
    setError(null);
    setInput("");

    const temporaryId = `temp-${crypto.randomUUID()}`;
    const optimistic: UiMessage = {
      id: temporaryId,
      role: "user",
      content: text,
      actionType: "none",
      actionStatus: "none",
      actionPayload: emptyPayload(),
      errorMessage: null,
    };

    setMessages((current) => [...current, optimistic]);

    try {
      const saveUser = await supabase
        .from("pf_ai_messages")
        .insert({
          conversation_id: conversationId,
          household_id: household.id,
          role: "user",
          content: text,
          action_status: "none",
          action_payload: {},
        })
        .select("id")
        .single();

      if (saveUser.error) throw saveUser.error;

      setMessages((current) =>
        current.map((message) =>
          message.id === temporaryId
            ? { ...message, id: String(saveUser.data.id) }
            : message,
        ),
      );

      await supabase
        .from("pf_ai_conversations")
        .update({
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);

      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify({
          message: text,
          householdId: household.id,
          history,
          context,
        }),
      });

      const body = (await response.json()) as
        | AssistantApiResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in body
            ? body.error || "A IA não conseguiu responder."
            : "A IA não conseguiu responder.",
        );
      }

      const assistant = body as AssistantApiResponse;
      const hasAction = assistant.action_type !== "none";

      const saveAssistant = await supabase
        .from("pf_ai_messages")
        .insert({
          conversation_id: conversationId,
          household_id: household.id,
          role: "assistant",
          content: assistant.reply,
          action_type: hasAction ? assistant.action_type : null,
          action_status: hasAction ? "pending" : "none",
          action_payload: assistant.action_payload,
        })
        .select(
          "id, role, content, action_type, action_status, action_payload, error_message",
        )
        .single();

      if (saveAssistant.error) throw saveAssistant.error;

      setMessages((current) => [
        ...current,
        mapMessage(saveAssistant.data as unknown as MessageRow),
      ]);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Não foi possível enviar a mensagem.";

      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: `error-${crypto.randomUUID()}`,
          role: "assistant",
          content: `Não consegui processar: ${message}`,
          actionType: "none",
          actionStatus: "none",
          actionPayload: emptyPayload(),
          errorMessage: null,
        },
      ]);
    } finally {
      setSending(false);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function confirm(message: UiMessage) {
    if (confirmingId) return;

    setConfirmingId(message.id);
    setError(null);

    try {
      const response = await fetch("/api/assistant/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify({ messageId: message.id }),
      });

      const body = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Não foi possível confirmar.");
      }

      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                actionStatus: "confirmed",
                errorMessage: null,
              }
            : item,
        ),
      );

      const confirmationText =
        body.message || "Pronto. Registrei a movimentação.";

      const saveConfirmation = await supabase
        .from("pf_ai_messages")
        .insert({
          conversation_id: conversationId,
          household_id: household.id,
          role: "assistant",
          content: confirmationText,
          action_status: "none",
          action_payload: {},
        })
        .select(
          "id, role, content, action_type, action_status, action_payload, error_message",
        )
        .single();

      if (!saveConfirmation.error) {
        setMessages((current) => [
          ...current,
          mapMessage(saveConfirmation.data as unknown as MessageRow),
        ]);
      }
    } catch (caught) {
      const messageText =
        caught instanceof Error
          ? caught.message
          : "Não foi possível confirmar.";

      setError(messageText);
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                actionStatus: "failed",
                errorMessage: messageText,
              }
            : item,
        ),
      );
    } finally {
      setConfirmingId(null);
    }
  }

  async function correct(message: UiMessage) {
    await supabase
      .from("pf_ai_messages")
      .update({
        action_status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", message.id);

    setMessages((current) =>
      current.map((item) =>
        item.id === message.id
          ? { ...item, actionStatus: "cancelled" }
          : item,
      ),
    );

    setInput(
      getActionCorrectionText(
        message.actionType,
        message.actionPayload,
      ),
    );
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const drawer = variant === "drawer";

  return (
    <section
      className={[
        "flex min-h-0 flex-col overflow-hidden bg-white",
        drawer
          ? "h-full"
          : "min-h-[calc(100vh-12rem)] rounded-3xl border border-[#0D1B2A]/10 shadow-sm",
      ].join(" ")}
    >
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#0D1B2A]/8 bg-[#F7F5EF] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0D1B2A] text-[#C8A15A]">
            <Sparkles size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-[#0D1B2A]">
              Assistente financeiro
            </h2>
            <p className="truncate text-xs text-[#3A3A3C]/55">
              Só salva depois da sua confirmação
            </p>
          </div>
        </div>

        {drawer && (
          <div className="flex items-center gap-1">
            <Link
              href="/assistente"
              className="rounded-lg p-2 text-[#3A3A3C]/55 hover:bg-white hover:text-[#0D1B2A]"
              title="Abrir em tela cheia"
            >
              <ExternalLink size={17} />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-[#3A3A3C]/55 hover:bg-white hover:text-[#0D1B2A]"
              aria-label="Fechar"
            >
              <X size={19} />
            </button>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
        {loading ? (
          <div className="flex min-h-64 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-5">
            {messages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#C8A15A]/40 bg-[#F7F5EF] p-5 text-sm leading-6 text-[#3A3A3C]/65">
                <p className="font-semibold text-[#0D1B2A]">
                  Pode falar naturalmente
                </p>
                <p className="mt-2">
                  “Paguei R$ 100 para a Vanda pelo Santander.”
                </p>
                <p>“Gastei R$ 84 no supermercado pelo Nubank.”</p>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={[
                  "flex items-start gap-3",
                  message.role === "user"
                    ? "justify-end"
                    : "justify-start",
                ].join(" ")}
              >
                {message.role === "assistant" && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0D1B2A] text-[#C8A15A]">
                    <Bot size={16} />
                  </div>
                )}

                <div className="min-w-0 max-w-[86%]">
                  <div
                    className={[
                      "rounded-2xl px-4 py-3 text-sm leading-6",
                      message.role === "user"
                        ? "rounded-br-md bg-[#0D1B2A] text-white"
                        : "rounded-bl-md bg-[#F7F5EF] text-[#0D1B2A]",
                    ].join(" ")}
                  >
                    {message.content}
                  </div>

                  {message.role === "assistant" &&
                    message.actionType !== "none" && (
                      <ProposedActionCard
                        actionType={message.actionType}
                        actionStatus={message.actionStatus}
                        payload={message.actionPayload}
                        context={context}
                        errorMessage={message.errorMessage}
                        saving={confirmingId === message.id}
                        onConfirm={() => void confirm(message)}
                        onCorrect={() => void correct(message)}
                      />
                    )}
                </div>

                {message.role === "user" && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#C8A15A]/20 text-[#0D1B2A]">
                    <UserRound size={16} />
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0D1B2A] text-[#C8A15A]">
                  <Bot size={16} />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-[#F7F5EF] px-4 py-3 text-sm text-[#3A3A3C]/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analisando...
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-[#0D1B2A]/8 bg-white px-4 py-4 sm:px-5">
        <div className="mx-auto w-full max-w-3xl">
          {error && (
            <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-end gap-2 rounded-2xl border border-[#0D1B2A]/12 bg-[#F7F5EF] p-2 focus-within:border-[#C8A15A] focus-within:ring-2 focus-within:ring-[#C8A15A]/15">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ex.: Paguei R$ 100 para a Vanda pelo Santander..."
              disabled={loading || sending}
              className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-[#0D1B2A] outline-none placeholder:text-[#3A3A3C]/40 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={loading || sending || !input.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0D1B2A] text-white hover:bg-[#172D43] disabled:opacity-40"
              aria-label="Enviar"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send size={17} />
              )}
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-[#3A3A3C]/40">
            Revise o card antes de confirmar.
          </p>
        </div>
      </footer>
    </section>
  );
}
