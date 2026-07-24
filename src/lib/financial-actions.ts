export type FinancialActionType =
  | "none"
  | "create_transaction"
  | "create_transfer"
  | "register_debt_payment"
  | "register_debt_received";

export type FinancialActionStatus =
  | "none"
  | "pending"
  | "confirmed"
  | "cancelled"
  | "failed";

export type FinancialActionPayload = {
  account_id: string | null;
  account_name: string | null;
  destination_account_id: string | null;
  destination_account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  debt_id: string | null;
  creditor: string | null;
  type: "income" | "expense" | null;
  amount: number | null;
  description: string | null;
  merchant: string | null;
  occurred_on: string | null;
  notes: string | null;
  count_installment: boolean | null;
};

export type AssistantContext = {
  accounts: Array<{
    id: string;
    name: string;
    institution_name: string | null;
    type: string;
  }>;
  categories: Array<{
    id: string;
    name: string;
    kind: string;
  }>;
  debts: Array<{
    id: string;
    creditor: string;
    installment_amount: number;
    current_balance: number;
    status: string;
  }>;
};

export type AssistantApiResponse = {
  reply: string;
  action_type: FinancialActionType;
  action_payload: FinancialActionPayload;
  model?: string;
};

export type StatementPreviewRow = {
  fingerprint: string;
  external_id: string | null;
  occurred_on: string;
  description: string;
  amount: number;
  signed_amount: number;
  type: "income" | "expense";
  category_id: string | null;
  category_name: string | null;
  duplicate: boolean;
};

export type StatementPreview = {
  file_name: string;
  account_id: string;
  account_name: string;
  rows: StatementPreviewRow[];
  total_rows: number;
  new_rows: number;
  duplicate_rows: number;
  total_income: number;
  total_expense: number;
};

export function emptyPayload(): FinancialActionPayload {
  return {
    account_id: null,
    account_name: null,
    destination_account_id: null,
    destination_account_name: null,
    category_id: null,
    category_name: null,
    debt_id: null,
    creditor: null,
    type: null,
    amount: null,
    description: null,
    merchant: null,
    occurred_on: null,
    notes: null,
    count_installment: null,
  };
}

export const createEmptyActionPayload = emptyPayload;

export function formatCurrency(value: number | string | null) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function actionTitle(
  actionType: FinancialActionType,
  payload: FinancialActionPayload,
) {
  if (actionType === "register_debt_payment") {
    return "Registrar pagamento de dívida";
  }

  if (actionType === "register_debt_received") {
    return "Registrar empréstimo recebido";
  }

  if (actionType === "create_transfer") {
    return "Registrar transferência";
  }

  if (payload.type === "income") {
    return "Registrar receita";
  }

  return "Registrar despesa";
}

export const getActionTitle = actionTitle;

export function getActionProposalText(
  actionType: FinancialActionType,
  payload: FinancialActionPayload,
) {
  const amount =
    payload.amount !== null
      ? formatCurrency(payload.amount)
      : null;

  if (actionType === "register_debt_payment") {
    const creditor = payload.creditor ?? "o credor informado";

    return amount
      ? `Entendi. Vou registrar um pagamento de ${amount} para ${creditor}. Revise os dados abaixo antes de confirmar.`
      : `Entendi. Vou preparar o pagamento para ${creditor}. Revise os dados abaixo antes de confirmar.`;
  }

  if (actionType === "register_debt_received") {
    const creditor = payload.creditor ?? "o credor informado";

    return amount
      ? `Entendi. Vou registrar um empréstimo recebido de ${amount} com ${creditor}. Revise os dados abaixo antes de confirmar.`
      : `Entendi. Vou preparar o empréstimo recebido de ${creditor}. Revise os dados abaixo antes de confirmar.`;
  }

  if (actionType === "create_transfer") {
    const origin = payload.account_name ?? "a conta de origem";
    const destination =
      payload.destination_account_name ?? "a conta de destino";

    return amount
      ? `Entendi. Vou registrar uma transferência de ${amount} de ${origin} para ${destination}. Revise os dados abaixo antes de confirmar.`
      : `Entendi. Vou preparar a transferência de ${origin} para ${destination}. Revise os dados abaixo antes de confirmar.`;
  }

  if (
    actionType === "create_transaction" &&
    payload.type === "income"
  ) {
    return amount
      ? `Entendi. Vou registrar uma receita de ${amount}. Revise os dados abaixo antes de confirmar.`
      : "Entendi. Vou preparar o registro da receita. Revise os dados abaixo antes de confirmar.";
  }

  if (actionType === "create_transaction") {
    return amount
      ? `Entendi. Vou registrar uma despesa de ${amount}. Revise os dados abaixo antes de confirmar.`
      : "Entendi. Vou preparar o registro da despesa. Revise os dados abaixo antes de confirmar.";
  }

  return "Como posso ajudar com suas finanças?";
}

export function getActionCorrectionText(
  actionType: FinancialActionType,
  payload: FinancialActionPayload,
) {
  return [
    `Corrija esta proposta: ${actionTitle(actionType, payload)}.`,
    payload.amount
      ? `Valor atual: ${formatCurrency(payload.amount)}.`
      : null,
    payload.account_name
      ? `Conta atual: ${payload.account_name}.`
      : null,
    payload.category_name
      ? `Categoria atual: ${payload.category_name}.`
      : null,
    payload.creditor
      ? `Credor atual: ${payload.creditor}.`
      : null,
    "A correção é:",
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeFinancialText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsWholeFinancialPhrase(
  normalizedText: string,
  normalizedPhrase: string,
) {
  if (!normalizedPhrase) return false;

  return (` ${normalizedText} `).includes(
    ` ${normalizedPhrase} `,
  );
}

function parseFinancialAmount(message: string) {
  const patterns = [
    /r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i,
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*reais?/i,
    /(?:peguei|recebi|emprestou|emprestado|empr[eé]stimo)\s+(?:de\s+)?(\d+(?:[.,]\d{1,2})?)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;

    const normalized = match[1].includes(",")
      ? match[1].replace(/\./g, "").replace(",", ".")
      : match[1];

    const amount = Number(normalized);

    if (Number.isFinite(amount) && amount > 0) {
      return amount;
    }
  }

  return null;
}

function todayInBrazil() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function tryParseDebtReceived(
  message: string,
  context: AssistantContext,
): AssistantApiResponse | null {
  const normalizedMessage = normalizeFinancialText(message);

  const loanSignals = [
    "peguei emprestado",
    "peguei um emprestimo",
    "peguei emprestimo",
    "recebi emprestado",
    "me emprestou",
    "dinheiro emprestado",
    "emprestado da",
    "emprestado do",
    "emprestimo da",
    "emprestimo do",
  ];

  const looksLikeLoan = loanSignals.some((signal) =>
    normalizedMessage.includes(signal),
  );

  if (!looksLikeLoan) return null;

  const amount = parseFinancialAmount(message);

  const debt = [...context.debts]
    .sort(
      (first, second) =>
        normalizeFinancialText(second.creditor).length -
        normalizeFinancialText(first.creditor).length,
    )
    .find((item) =>
      containsWholeFinancialPhrase(
        normalizedMessage,
        normalizeFinancialText(item.creditor),
      ),
    );

  const account = context.accounts.find((item) => {
    const accountName = normalizeFinancialText(item.name);
    const institutionName = item.institution_name
      ? normalizeFinancialText(item.institution_name)
      : "";

    return (
      containsWholeFinancialPhrase(
        normalizedMessage,
        accountName,
      ) ||
      (institutionName.length >= 3 &&
        containsWholeFinancialPhrase(
          normalizedMessage,
          institutionName,
        ))
    );
  });

  if (!amount) {
    return {
      reply: "Qual foi o valor que você pegou emprestado?",
      action_type: "none",
      action_payload: emptyPayload(),
      model: "deterministic-parser",
    };
  }

  if (!debt) {
    return {
      reply: `De quem você pegou ${formatCurrency(amount)} emprestado?`,
      action_type: "none",
      action_payload: emptyPayload(),
      model: "deterministic-parser",
    };
  }

  if (!account) {
    return {
      reply: `Em qual conta entraram os ${formatCurrency(amount)} emprestados por ${debt.creditor}?`,
      action_type: "none",
      action_payload: emptyPayload(),
      model: "deterministic-parser",
    };
  }

  return {
    reply: `Entendi. Vou registrar um empréstimo recebido de ${formatCurrency(amount)} com ${debt.creditor}. Revise os dados abaixo antes de confirmar.`,
    action_type: "register_debt_received",
    action_payload: {
      account_id: account.id,
      account_name: account.name,
      destination_account_id: null,
      destination_account_name: null,
      category_id: null,
      category_name: null,
      debt_id: debt.id,
      creditor: debt.creditor,
      type: null,
      amount,
      description: `Empréstimo recebido - ${debt.creditor}`,
      merchant: debt.creditor,
      occurred_on: todayInBrazil(),
      notes: "Empréstimo recebido informado no chat.",
      count_installment: null,
    },
    model: "deterministic-parser",
  };
}

