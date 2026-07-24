import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type {
  FinancialActionPayload,
  FinancialActionType,
} from "@/lib/financial-actions";

type MessageRow = {
  id: string;
  household_id: string;
  action_type: FinancialActionType | null;
  action_status: string;
  action_payload: FinancialActionPayload;
};

function tokenFrom(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ")
    ? value.slice(7).trim()
    : null;
}

function authorizedClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !key) {
    throw new Error("Supabase não configurado.");
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function requiredText(value: string | null, label: string) {
  if (!value?.trim()) {
    throw new Error(`${label} não informado.`);
  }

  return value.trim();
}

function requiredAmount(value: number | null) {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("O valor precisa ser maior que zero.");
  }

  return amount;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function POST(request: Request) {
  const accessToken = tokenFrom(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sessão não informada." },
      { status: 401 },
    );
  }

  const supabase = authorizedClient(accessToken);
  let messageId: string | null = null;

  try {
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Sua sessão expirou." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as {
      messageId?: string;
    };

    messageId = body.messageId?.trim() ?? null;

    if (!messageId) {
      throw new Error("Mensagem não informada.");
    }

    const { data, error } = await supabase
      .from("pf_ai_messages")
      .select(
        "id, household_id, action_type, action_status, action_payload",
      )
      .eq("id", messageId)
      .maybeSingle();

    if (error || !data) {
      throw new Error("Proposta não encontrada.");
    }

    const message = data as unknown as MessageRow;

    if (message.action_status === "confirmed") {
      return NextResponse.json({
        success: true,
        message: "Esta ação já foi registrada.",
      });
    }

    if (
      message.action_status !== "pending" &&
      message.action_status !== "failed"
    ) {
      throw new Error("Esta proposta não está mais pendente.");
    }

    const actionType = message.action_type;
    const payload = message.action_payload;

    if (!actionType || actionType === "none") {
      throw new Error("A proposta não possui ação válida.");
    }

    const amount = requiredAmount(payload.amount);
    const occurredOn = payload.occurred_on || today();
    const paidAt = new Date(
      `${occurredOn}T12:00:00-03:00`,
    ).toISOString();

    let resultId: string | null = null;
    let successMessage = "Ação registrada com sucesso.";

    if (actionType === "create_transaction") {
      const accountId = requiredText(
        payload.account_id,
        "Conta",
      );
      const description = requiredText(
        payload.description,
        "Descrição",
      );

      if (
        payload.type !== "income" &&
        payload.type !== "expense"
      ) {
        throw new Error("Tipo de movimentação inválido.");
      }

      const result = await supabase
        .from("pf_transactions")
        .insert({
          household_id: message.household_id,
          account_id: accountId,
          destination_account_id: null,
          category_id: payload.category_id,
          created_by: userData.user.id,
          responsible_user_id: userData.user.id,
          type: payload.type,
          status: "paid",
          description,
          merchant: payload.merchant,
          amount,
          original_amount: amount,
          occurred_on: occurredOn,
          due_date: occurredOn,
          paid_at: paidAt,
          source: "ai",
          notes: payload.notes,
          metadata: {
            origin: "financial_assistant",
            assistant_message_id: message.id,
          },
        })
        .select("id")
        .single();

      if (result.error) {
        throw result.error;
      }

      resultId = String(result.data.id);
      successMessage =
        payload.type === "income"
          ? "Receita registrada com sucesso."
          : "Despesa registrada com sucesso.";
    }

    if (actionType === "create_transfer") {
      const accountId = requiredText(
        payload.account_id,
        "Conta de origem",
      );
      const destinationAccountId = requiredText(
        payload.destination_account_id,
        "Conta de destino",
      );

      if (accountId === destinationAccountId) {
        throw new Error("Origem e destino precisam ser diferentes.");
      }

      const result = await supabase
        .from("pf_transactions")
        .insert({
          household_id: message.household_id,
          account_id: accountId,
          destination_account_id: destinationAccountId,
          category_id: null,
          created_by: userData.user.id,
          responsible_user_id: userData.user.id,
          type: "transfer",
          status: "paid",
          description:
            payload.description || "Transferência entre contas",
          merchant: null,
          amount,
          original_amount: amount,
          occurred_on: occurredOn,
          due_date: occurredOn,
          paid_at: paidAt,
          source: "ai",
          notes: payload.notes,
          metadata: {
            origin: "financial_assistant",
            assistant_message_id: message.id,
          },
        })
        .select("id")
        .single();

      if (result.error) {
        throw result.error;
      }

      resultId = String(result.data.id);
      successMessage = "Transferência registrada com sucesso.";
    }

    if (actionType === "register_debt_payment") {
      const debtId = requiredText(payload.debt_id, "Dívida");
      const accountId = requiredText(
        payload.account_id,
        "Conta de pagamento",
      );

      const result = await supabase.rpc(
        "pf_register_debt_payment",
        {
          target_debt_id: debtId,
          target_account_id: accountId,
          payment_amount: amount,
          payment_date: occurredOn,
          count_installment:
            payload.count_installment ?? false,
          payment_notes:
            payload.notes ||
            "Registrado pelo assistente financeiro",
        },
      );

      if (result.error) {
        throw result.error;
      }

      resultId =
        typeof result.data === "string"
          ? result.data
          : null;
      successMessage =
        "Pagamento da dívida registrado com sucesso.";
    }

    if (!resultId) {
      throw new Error(
        "A ação não retornou o identificador da movimentação.",
      );
    }

    const verificationResult = await supabase
      .from("pf_transactions")
      .select(
        "id, household_id, type, status, amount, occurred_on, source",
      )
      .eq("id", resultId)
      .eq("household_id", message.household_id)
      .maybeSingle();

    if (
      verificationResult.error ||
      !verificationResult.data
    ) {
      throw new Error(
        verificationResult.error?.message ||
          "A movimentação não foi encontrada depois de ser criada.",
      );
    }

    const updateResult = await supabase
      .from("pf_ai_messages")
      .update({
        action_status: "confirmed",
        action_payload: {
          ...payload,
          result_id: resultId,
        },
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", message.id);

    if (updateResult.error) {
      throw updateResult.error;
    }

    return NextResponse.json({
      success: true,
      resultId,
      transaction: verificationResult.data,
      message: successMessage,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Não foi possível registrar a ação.";

    if (messageId) {
      await supabase
        .from("pf_ai_messages")
        .update({
          action_status: "failed",
          error_message: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", messageId);
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 400 },
    );
  }
}
