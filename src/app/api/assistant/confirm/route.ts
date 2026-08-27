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

type ResultKind = "transaction" | "commitment" | "debt";

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

function optionalNumber(value: number | null, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function firstRpcRow(data: unknown) {
  if (Array.isArray(data)) {
    return (data[0] ?? null) as Record<string, unknown> | null;
  }

  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }

  return null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
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

    const { data: membership, error: membershipError } =
      await supabase
        .from("pf_household_members")
        .select("role")
        .eq("household_id", message.household_id)
        .eq("user_id", userData.user.id)
        .maybeSingle();

    if (
      membershipError ||
      !membership ||
      !["owner", "member"].includes(String(membership.role))
    ) {
      return NextResponse.json(
        {
          error:
            "Seu acesso é somente leitura. Você não pode confirmar movimentações.",
        },
        { status: 403 },
      );
    }

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

    const amount = requiredAmount(
      payload.total_amount ?? payload.amount,
    );
    const occurredOn = payload.occurred_on || today();
    const paidAt = new Date(
      `${occurredOn}T12:00:00-03:00`,
    ).toISOString();

    let resultId: string | null = null;
    let transactionId: string | null = null;
    let resultKind: ResultKind = "transaction";
    let successMessage = "Ação registrada com sucesso.";

    if (actionType === "create_transaction") {
      const accountId = requiredText(payload.account_id, "Conta");
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

      if (result.error) throw result.error;

      transactionId = String(result.data.id);
      resultId = transactionId;
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

      if (result.error) throw result.error;

      transactionId = String(result.data.id);
      resultId = transactionId;
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

      if (result.error) throw result.error;

      transactionId = stringValue(result.data);
      if (!transactionId) {
        throw new Error(
          "O pagamento da dívida não retornou a movimentação criada.",
        );
      }

      resultId = transactionId;
      successMessage =
        "Pagamento da dívida registrado com sucesso.";
    }

    if (actionType === "register_debt_received") {
      const debtId = requiredText(payload.debt_id, "Dívida");
      const accountId = requiredText(
        payload.account_id,
        "Conta de recebimento",
      );

      const result = await supabase.rpc(
        "pf_register_debt_received",
        {
          target_debt_id: debtId,
          target_account_id: accountId,
          received_amount: amount,
          received_date: occurredOn,
          received_notes:
            payload.notes ||
            "Registrado pelo assistente financeiro",
        },
      );

      if (result.error) throw result.error;

      transactionId = stringValue(result.data);
      if (!transactionId) {
        throw new Error(
          "O empréstimo recebido não retornou a movimentação criada.",
        );
      }

      resultId = transactionId;
      successMessage =
        "Empréstimo recebido registrado com sucesso.";
    }

    if (actionType === "create_commitment") {
      const direction = payload.commitment_direction;
      if (direction !== "payable" && direction !== "receivable") {
        throw new Error("Tipo de compromisso inválido.");
      }

      const counterparty = requiredText(
        payload.counterparty ?? payload.creditor,
        "Pessoa ou empresa",
      );
      const description =
        payload.description?.trim() ||
        (direction === "payable"
          ? `Conta a pagar - ${counterparty}`
          : `Valor a receber de ${counterparty}`);
      const initialAmount = optionalNumber(
        payload.initial_settlement_amount,
        0,
      );

      if (initialAmount > amount) {
        throw new Error(
          "O valor já liquidado não pode ser maior que o total.",
        );
      }

      const result = await supabase.rpc(
        "pf_create_commitment_with_initial_settlement",
        {
          target_household_id: message.household_id,
          commitment_direction: direction,
          commitment_counterparty: counterparty,
          commitment_description: description,
          commitment_total_amount: amount,
          commitment_due_date: payload.due_date,
          commitment_category_id: payload.category_id,
          commitment_default_account_id:
            payload.account_id,
          commitment_responsible_user_id:
            userData.user.id,
          commitment_visibility_scope: "family",
          commitment_notes: payload.notes,
          commitment_source: "ai",
          initial_settlement_amount: initialAmount,
          initial_settlement_account_id:
            initialAmount > 0 ? payload.account_id : null,
          initial_settlement_date: occurredOn,
          initial_settlement_notes:
            payload.notes ||
            "Liquidação inicial registrada pelo assistente",
        },
      );

      if (result.error) throw result.error;

      const row = firstRpcRow(result.data);
      const commitmentId = stringValue(row?.commitment_id);
      transactionId = stringValue(row?.transaction_id);

      if (!commitmentId) {
        throw new Error(
          "O compromisso não retornou o identificador criado.",
        );
      }

      resultId = commitmentId;
      resultKind = "commitment";
      successMessage =
        direction === "receivable"
          ? "Valor a receber registrado com sucesso."
          : "Conta a pagar registrada com sucesso.";
    }

    if (actionType === "register_commitment_settlement") {
      const direction = payload.commitment_direction;
      if (direction !== "payable" && direction !== "receivable") {
        throw new Error("Tipo de compromisso inválido.");
      }

      const accountId = requiredText(
        payload.account_id,
        direction === "receivable"
          ? "Conta de recebimento"
          : "Conta de pagamento",
      );

      let commitmentId = payload.commitment_id?.trim() || null;

      if (!commitmentId) {
        const counterparty = requiredText(
          payload.counterparty ?? payload.creditor,
          "Pessoa ou empresa",
        );

        const matches = await supabase
          .from("pf_commitment_progress")
          .select(
            "id, counterparty, description, remaining_amount, computed_status",
          )
          .eq("household_id", message.household_id)
          .eq("direction", direction)
          .in("computed_status", ["pending", "partial", "overdue"])
          .ilike("counterparty", `%${counterparty}%`)
          .limit(3);

        if (matches.error) throw matches.error;

        if (!matches.data?.length) {
          throw new Error(
            `Não encontrei um compromisso aberto com ${counterparty}. Cadastre-o primeiro em Movimentações.`,
          );
        }

        if (matches.data.length > 1) {
          throw new Error(
            `Existe mais de um compromisso aberto com ${counterparty}. Use Movimentações para escolher o correto.`,
          );
        }

        commitmentId = String(matches.data[0].id);
      }

      const result = await supabase.rpc(
        "pf_register_commitment_settlement",
        {
          target_commitment_id: commitmentId,
          target_account_id: accountId,
          settlement_amount: amount,
          settlement_date: occurredOn,
          settlement_notes:
            payload.notes ||
            "Liquidação registrada pelo assistente financeiro",
          settlement_source: "ai",
        },
      );

      if (result.error) throw result.error;

      transactionId = stringValue(result.data);
      if (!transactionId) {
        throw new Error(
          "A liquidação não retornou a movimentação criada.",
        );
      }

      resultId = transactionId;
      successMessage =
        direction === "receivable"
          ? "Recebimento registrado com sucesso."
          : "Pagamento da conta registrado com sucesso.";
    }

    if (actionType === "create_other_debt") {
      const creditor = requiredText(
        payload.creditor ?? payload.counterparty,
        "Credor",
      );
      const description =
        payload.description?.trim() || `Dívida com ${creditor}`;

      const result = await supabase.rpc(
        "pf_create_debt_with_initial_payment_v2",
        {
          target_household_id: message.household_id,
          debt_creditor: creditor,
          debt_description: description,
          debt_original_amount: amount,
          target_debt_group: payload.debt_group || "other",
          debt_start_date: occurredOn,
          debt_due_date: payload.due_date,
          debt_installment_amount: null,
          debt_total_installments: null,
          debt_interest_enabled:
            payload.interest_enabled ?? false,
          debt_auto_accrue_interest:
            payload.auto_accrue_interest ?? false,
          debt_interest_rate: optionalNumber(
            payload.interest_rate,
            0,
          ),
          debt_interest_period:
            payload.interest_period || "monthly",
          debt_interest_method:
            payload.interest_method || "simple",
          debt_penalty_rate: optionalNumber(
            payload.penalty_rate,
            0,
          ),
          debt_daily_late_interest_rate: optionalNumber(
            payload.daily_late_interest_rate,
            0,
          ),
          debt_grace_period_days: optionalNumber(
            payload.grace_period_days,
            0,
          ),
          debt_responsible_user_id: userData.user.id,
          debt_visibility_scope: "family",
          initial_payment_amount: 0,
          initial_payment_account_id: null,
          initial_payment_date: occurredOn,
          initial_payment_count_installment: false,
          initial_payment_notes: null,
        },
      );

      if (result.error) throw result.error;

      const row = firstRpcRow(result.data);
      const debtId = stringValue(row?.debt_id);

      if (!debtId) {
        throw new Error(
          "A dívida não retornou o identificador criado.",
        );
      }

      resultId = debtId;
      resultKind = "debt";

      if (payload.loan_received && payload.account_id) {
        const receivedResult = await supabase
          .from("pf_transactions")
          .insert({
            household_id: message.household_id,
            account_id: payload.account_id,
            destination_account_id: null,
            category_id: null,
            debt_id: debtId,
            created_by: userData.user.id,
            responsible_user_id: userData.user.id,
            type: "debt_received",
            status: "paid",
            description: `Empréstimo recebido - ${creditor}`,
            merchant: creditor,
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
              debt_id: debtId,
              principal_already_created: true,
            },
          })
          .select("id")
          .single();

        if (receivedResult.error) throw receivedResult.error;
        transactionId = String(receivedResult.data.id);
      }

      successMessage = "Nova dívida registrada com sucesso.";
    }

    if (!resultId) {
      throw new Error(
        "A ação não retornou o identificador do registro.",
      );
    }

    let verification: Record<string, unknown> | null = null;

    if (transactionId || resultKind === "transaction") {
      const targetTransactionId = transactionId ?? resultId;
      const verificationResult = await supabase
        .from("pf_transactions")
        .select(
          "id, household_id, type, status, amount, occurred_on, source",
        )
        .eq("id", targetTransactionId)
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

      verification = verificationResult.data;
    } else if (resultKind === "commitment") {
      const verificationResult = await supabase
        .from("pf_commitment_progress")
        .select(
          "id, household_id, direction, counterparty, total_amount, remaining_amount, computed_status",
        )
        .eq("id", resultId)
        .eq("household_id", message.household_id)
        .maybeSingle();

      if (verificationResult.error || !verificationResult.data) {
        throw new Error(
          verificationResult.error?.message ||
            "O compromisso não foi encontrado depois de ser criado.",
        );
      }

      verification = verificationResult.data;
    } else {
      const verificationResult = await supabase
        .from("pf_debt_positions")
        .select(
          "id, household_id, creditor, projected_balance, daily_growth, status",
        )
        .eq("id", resultId)
        .eq("household_id", message.household_id)
        .maybeSingle();

      if (verificationResult.error || !verificationResult.data) {
        throw new Error(
          verificationResult.error?.message ||
            "A dívida não foi encontrada depois de ser criada.",
        );
      }

      verification = verificationResult.data;
    }

    const updateResult = await supabase
      .from("pf_ai_messages")
      .update({
        action_status: "confirmed",
        action_payload: {
          ...payload,
          result_id: resultId,
          result_kind: resultKind,
          transaction_id: transactionId,
        },
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", message.id);

    if (updateResult.error) throw updateResult.error;

    return NextResponse.json({
      success: true,
      resultId,
      resultKind,
      transactionId,
      record: verification,
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
