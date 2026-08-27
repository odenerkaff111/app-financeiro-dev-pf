export type FinancialActionType =
  | "none"
  | "create_transaction"
  | "create_transfer"
  | "register_debt_payment"
  | "register_debt_received"
  | "create_commitment"
  | "register_commitment_settlement"
  | "create_other_debt";

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
  commitment_id: string | null;
  commitment_direction: "payable" | "receivable" | null;
  counterparty: string | null;
  type: "income" | "expense" | null;
  amount: number | null;
  total_amount: number | null;
  initial_settlement_amount: number | null;
  description: string | null;
  merchant: string | null;
  occurred_on: string | null;
  due_date: string | null;
  notes: string | null;
  count_installment: boolean | null;
  debt_kind: string | null;
  debt_group: "personal" | "other" | null;
  interest_enabled: boolean | null;
  auto_accrue_interest: boolean | null;
  interest_rate: number | null;
  interest_period: "daily" | "monthly" | "yearly" | null;
  interest_method: "simple" | "compound" | null;
  penalty_rate: number | null;
  daily_late_interest_rate: number | null;
  grace_period_days: number | null;
  loan_received: boolean | null;
  result_id?: string | null;
  result_kind?: string | null;
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
    commitment_id: null,
    commitment_direction: null,
    counterparty: null,
    type: null,
    amount: null,
    total_amount: null,
    initial_settlement_amount: null,
    description: null,
    merchant: null,
    occurred_on: null,
    due_date: null,
    notes: null,
    count_installment: null,
    debt_kind: null,
    debt_group: null,
    interest_enabled: null,
    auto_accrue_interest: null,
    interest_rate: null,
    interest_period: null,
    interest_method: null,
    penalty_rate: null,
    daily_late_interest_rate: null,
    grace_period_days: null,
    loan_received: null,
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
  const direction = payload.commitment_direction;

  if (actionType === "create_commitment") {
    return direction === "receivable"
      ? "Registrar valor a receber"
      : "Registrar conta a pagar";
  }

  if (actionType === "register_commitment_settlement") {
    return direction === "receivable"
      ? "Registrar recebimento"
      : "Registrar pagamento de conta";
  }

  if (actionType === "create_other_debt") {
    return "Registrar nova dívida";
  }

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
  const amount = payload.amount !== null
    ? formatCurrency(payload.amount)
    : null;
  const party =
    payload.counterparty ?? payload.creditor ?? "a pessoa informada";

  if (actionType === "create_commitment") {
    return payload.commitment_direction === "receivable"
      ? `Entendi. Vou registrar ${amount ?? "esse valor"} para receber de ${party}. Revise antes de confirmar.`
      : `Entendi. Vou registrar uma conta de ${amount ?? "valor informado"} para pagar a ${party}. Revise antes de confirmar.`;
  }

  if (actionType === "register_commitment_settlement") {
    return payload.commitment_direction === "receivable"
      ? `Entendi. Vou registrar o recebimento de ${amount ?? "esse valor"} de ${party}. Revise antes de confirmar.`
      : `Entendi. Vou registrar o pagamento de ${amount ?? "esse valor"} para ${party}. Revise antes de confirmar.`;
  }

  if (actionType === "create_other_debt") {
    return `Entendi. Vou registrar uma nova dívida de ${amount ?? "valor informado"} com ${party}. Revise os dados antes de confirmar.`;
  }

  if (actionType === "register_debt_payment") {
    return `Entendi. Vou registrar um pagamento de ${amount ?? "valor informado"} para ${party}. Revise os dados abaixo antes de confirmar.`;
  }

  if (actionType === "register_debt_received") {
    return `Entendi. Vou registrar um empréstimo recebido de ${amount ?? "valor informado"} com ${party}. Revise os dados abaixo antes de confirmar.`;
  }

  if (actionType === "create_transfer") {
    const origin = payload.account_name ?? "a conta de origem";
    const destination =
      payload.destination_account_name ?? "a conta de destino";
    return `Entendi. Vou registrar uma transferência de ${amount ?? "valor informado"} de ${origin} para ${destination}. Revise antes de confirmar.`;
  }

  if (actionType === "create_transaction" && payload.type === "income") {
    return `Entendi. Vou registrar uma receita de ${amount ?? "valor informado"}. Revise antes de confirmar.`;
  }

  if (actionType === "create_transaction") {
    return `Entendi. Vou registrar uma despesa de ${amount ?? "valor informado"}. Revise antes de confirmar.`;
  }

  return "Como posso ajudar com suas finanças?";
}

export function getActionCorrectionText(
  actionType: FinancialActionType,
  payload: FinancialActionPayload,
) {
  return [
    `Corrija esta proposta: ${actionTitle(actionType, payload)}.`,
    payload.amount ? `Valor atual: ${formatCurrency(payload.amount)}.` : null,
    payload.account_name ? `Conta atual: ${payload.account_name}.` : null,
    payload.category_name ? `Categoria atual: ${payload.category_name}.` : null,
    payload.counterparty ? `Pessoa ou empresa atual: ${payload.counterparty}.` : null,
    payload.creditor ? `Credor atual: ${payload.creditor}.` : null,
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
  return (` ${normalizedText} `).includes(` ${normalizedPhrase} `);
}

function parseFinancialAmount(message: string) {
  const patterns = [
    /r\$\s*([\d.]+(?:,\d{1,2})?)/i,
    /([\d.]+(?:,\d{1,2})?)\s*reais?/i,
    /(?:paguei|mandei|enviei|transferi|fiz\s+um\s+pix|pix)\b.*?([\d.]+(?:,\d{1,2})?)(?=\s|$|[.,;:])/i,
    /(?:peguei|recebi|emprestou|emprestado|empr[eé]stimo)\s+(?:de\s+)?([\d.]+(?:,\d{1,2})?)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;
    const raw = match[1].replace(/\.+$/, "");
    const normalized = raw.includes(",")
      ? raw.replace(/\./g, "").replace(",", ".")
      : /^\d{1,3}(?:\.\d{3})+$/.test(raw)
        ? raw.replace(/\./g, "")
        : raw;
    const amount = Number(normalized);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }

  return null;
}

function parseRate(message: string) {
  const match = message.match(/(\d+(?:[.,]\d+)?)\s*%/i);
  if (!match?.[1]) return null;
  const rate = Number(match[1].replace(",", "."));
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

function parseDate(message: string) {
  const iso = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = message.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (br) {
    return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
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

function cleanParty(value: string | undefined | null) {
  if (!value) return null;
  const cleaned = value
    .replace(/^(?:o|a)\s+/i, "")
    .replace(/\b(?:pelo|pela|no|na|em|com juros|juros|vence|vencendo)\b.*$/i, "")
    .replace(/[.,;:]+$/g, "")
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

function extractCounterparty(message: string, kind: string) {
  const patterns: RegExp[] = [];

  if (kind === "payable") {
    patterns.push(
      /conta\s+(?:da|do|de)\s+(.+?)\s+(?:de|no valor de)\s+r\$/i,
      /devo\s+r\$\s*[^\s]+\s+(?:para|a)\s+(.+)$/i,
      /conta\s+(?:para|com)\s+(.+?)\s+(?:de|no valor de)\s+r\$/i,
    );
  }

  if (kind === "receivable") {
    patterns.push(
      /para\s+receber\s+(?:da|do|de)\s+(.+)$/i,
      /^(.+?)\s+me\s+deve\s+r\$/i,
      /receber\s+r\$\s*[^\s]+\s+(?:da|do|de)\s+(.+)$/i,
    );
  }

  if (kind === "settle_payable") {
    patterns.push(
      /conta\s+(?:da|do|de)\s+(.+?)(?:\s+pelo|\s+pela|\s+no|\s+na|$)/i,
      /paguei\s+r\$\s*[^\s]+\s+(?:para|a)\s+(.+?)(?:\s+pelo|\s+pela|\s+no|\s+na|$)/i,
    );
  }

  if (kind === "settle_receivable") {
    patterns.push(
      /(?:valor|conta)\s+a\s+receber\s+(?:da|do|de)\s+(.+)$/i,
      /^(.+?)\s+pagou\s+r\$\s*[^\s]+\s+do\s+que\s+me\s+devia/i,
      /recebi\s+r\$\s*[^\s]+\s+(?:da|do|de)\s+(.+?)\s+do\s+que\s+me\s+devia/i,
    );
  }

  let searchableMessage = message;

  if (kind === "debt") {
    searchableMessage = message.replace(
      /r\$\s*[\d.]+(?:,\d{1,2})?/gi,
      "VALOR",
    );

    patterns.push(
      /(?:empr[eé]stimo|financiamento|d[ií]vida).*?(?:com|do|da)\s+(?:o|a)?\s*(.+?)(?:,?\s*(?:com\s+)?juros|,?\s+no\s+|,?\s+na\s+|$)/i,
    );
  }

  for (const pattern of patterns) {
    const match = searchableMessage.match(pattern);
    const party = cleanParty(match?.[1]);
    if (party) return party;
  }

  return null;
}

function findAccount(message: string, context: AssistantContext) {
  const normalizedMessage = normalizeFinancialText(message);
  return context.accounts.find((item) => {
    const accountName = normalizeFinancialText(item.name);
    const institutionName = item.institution_name
      ? normalizeFinancialText(item.institution_name)
      : "";
    return (
      containsWholeFinancialPhrase(normalizedMessage, accountName) ||
      (institutionName.length >= 3 &&
        containsWholeFinancialPhrase(normalizedMessage, institutionName))
    );
  });
}

function findDebt(message: string, context: AssistantContext) {
  const normalizedMessage = normalizeFinancialText(message);
  return [...context.debts]
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
}

function basePayload(): FinancialActionPayload {
  return {
    ...emptyPayload(),
    occurred_on: todayInBrazil(),
  };
}

export function tryParseUnifiedFinancialAction(
  message: string,
  context: AssistantContext,
): AssistantApiResponse | null {
  const normalized = normalizeFinancialText(message);
  const amount = parseFinancialAmount(message);
  const account = findAccount(message, context);
  const debt = findDebt(message, context);

  const paymentSignals = [
    "paguei",
    "pagamento",
    "mandei",
    "enviei",
    "transferi",
    "fiz um pix",
    "pix para",
    "pix pra",
  ];
  const looksLikePayment = paymentSignals.some((item) => normalized.includes(item));

  if (looksLikePayment && debt) {
    if (!amount) {
      return {
        reply: `Qual foi o valor pago para ${debt.creditor}?`,
        action_type: "none",
        action_payload: emptyPayload(),
        model: "deterministic-financial-engine",
      };
    }
    if (!account) {
      return {
        reply: `Por qual conta você pagou ${debt.creditor}?`,
        action_type: "none",
        action_payload: emptyPayload(),
        model: "deterministic-financial-engine",
      };
    }

    const installment = Number(debt.installment_amount || 0);
    const explicitInstallment = [
      "parcela completa",
      "parcela inteira",
      "parcela cheia",
      "paguei a parcela",
    ].some((item) => normalized.includes(item));

    return {
      reply: "",
      action_type: "register_debt_payment",
      action_payload: {
        ...basePayload(),
        account_id: account.id,
        account_name: account.name,
        debt_id: debt.id,
        creditor: debt.creditor,
        counterparty: debt.creditor,
        amount,
        total_amount: amount,
        description: `Pagamento de dívida - ${debt.creditor}`,
        merchant: debt.creditor,
        count_installment:
          explicitInstallment && installment > 0 && Math.abs(installment - amount) <= 0.01,
        notes: "Pagamento informado no chat.",
      },
      model: "deterministic-financial-engine",
    };
  }

  const explicitReceivableSettlement =
    normalized.includes("do que me devia") ||
    normalized.includes("valor a receber") && normalized.includes("recebi");

  if (explicitReceivableSettlement) {
    const party = extractCounterparty(message, "settle_receivable");
    if (!amount || !party || !account) return null;
    return {
      reply: "",
      action_type: "register_commitment_settlement",
      action_payload: {
        ...basePayload(),
        account_id: account.id,
        account_name: account.name,
        commitment_direction: "receivable",
        counterparty: party,
        amount,
        total_amount: amount,
        description: `Recebimento de ${party}`,
        merchant: party,
        notes: "Recebimento parcial informado no chat.",
      },
      model: "deterministic-financial-engine",
    };
  }

  const explicitPayableSettlement =
    looksLikePayment &&
    (normalized.includes("conta da") ||
      normalized.includes("conta do") ||
      normalized.includes("conta de"));

  if (explicitPayableSettlement) {
    const party = extractCounterparty(message, "settle_payable");
    if (!amount || !party || !account) return null;
    return {
      reply: "",
      action_type: "register_commitment_settlement",
      action_payload: {
        ...basePayload(),
        account_id: account.id,
        account_name: account.name,
        commitment_direction: "payable",
        counterparty: party,
        amount,
        total_amount: amount,
        description: `Pagamento de conta - ${party}`,
        merchant: party,
        notes: "Pagamento parcial informado no chat.",
      },
      model: "deterministic-financial-engine",
    };
  }

  const newReceivable =
    normalized.includes("para receber") || normalized.includes("me deve");

  if (newReceivable) {
    const party = extractCounterparty(message, "receivable");
    if (!amount || !party) return null;
    return {
      reply: "",
      action_type: "create_commitment",
      action_payload: {
        ...basePayload(),
        commitment_direction: "receivable",
        counterparty: party,
        creditor: party,
        amount,
        total_amount: amount,
        initial_settlement_amount: 0,
        description: `Valor a receber de ${party}`,
        merchant: party,
        due_date: parseDate(message),
        notes: "Valor a receber informado no chat.",
      },
      model: "deterministic-financial-engine",
    };
  }

  const newPayable =
    normalized.includes("conta a pagar") ||
    normalized.includes("tenho uma conta") ||
    normalized.startsWith("conta da") ||
    normalized.startsWith("conta do");

  if (newPayable && !looksLikePayment) {
    const party = extractCounterparty(message, "payable");
    if (!amount || !party) return null;
    return {
      reply: "",
      action_type: "create_commitment",
      action_payload: {
        ...basePayload(),
        commitment_direction: "payable",
        counterparty: party,
        creditor: party,
        amount,
        total_amount: amount,
        initial_settlement_amount: 0,
        description: `Conta a pagar - ${party}`,
        merchant: party,
        due_date: parseDate(message),
        notes: "Conta a pagar informada no chat.",
      },
      model: "deterministic-financial-engine",
    };
  }

  const loanSignals = [
    "peguei emprestado",
    "peguei um emprestimo",
    "peguei emprestimo",
    "novo emprestimo",
    "nova divida",
    "financiamento",
  ];
  const looksLikeLoan = loanSignals.some((item) => normalized.includes(item));

  if (looksLikeLoan && !debt) {
    const party = extractCounterparty(message, "debt");
    if (!amount || !party) return null;
    const rate = parseRate(message) ?? 0;
    const interestPeriod = normalized.includes("ao dia") || normalized.includes("por dia")
      ? "daily"
      : normalized.includes("ao ano") || normalized.includes("por ano")
        ? "yearly"
        : "monthly";
    const interestMethod = normalized.includes("compost") ? "compound" : "simple";
    const personalDebtSignals = [
      "amigo",
      "amiga",
      "familia",
      "familiar",
      "parente",
      "minha mae",
      "meu pai",
      "irmao",
      "irma",
      "esposa",
      "marido",
    ];
    const debtGroup = personalDebtSignals.some((signal) =>
      normalized.includes(signal),
    )
      ? "personal"
      : "other";

    return {
      reply: "",
      action_type: "create_other_debt",
      action_payload: {
        ...basePayload(),
        account_id: account?.id ?? null,
        account_name: account?.name ?? null,
        creditor: party,
        counterparty: party,
        amount,
        total_amount: amount,
        description: `Empréstimo com ${party}`,
        merchant: party,
        due_date: parseDate(message),
        debt_kind: "other",
        debt_group: debtGroup,
        interest_enabled: rate > 0,
        auto_accrue_interest: rate > 0,
        interest_rate: rate,
        interest_period: interestPeriod,
        interest_method: interestMethod,
        penalty_rate: 0,
        daily_late_interest_rate: 0,
        grace_period_days: 0,
        loan_received: Boolean(account),
        notes: "Dívida informada no chat.",
      },
      model: "deterministic-financial-engine",
    };
  }

  if (looksLikeLoan && debt) {
    if (!amount) {
      return {
        reply: "Qual foi o valor que você pegou emprestado?",
        action_type: "none",
        action_payload: emptyPayload(),
        model: "deterministic-financial-engine",
      };
    }
    if (!account) {
      return {
        reply: `Em qual conta entraram os ${formatCurrency(amount)} emprestados por ${debt.creditor}?`,
        action_type: "none",
        action_payload: emptyPayload(),
        model: "deterministic-financial-engine",
      };
    }

    return {
      reply: "",
      action_type: "register_debt_received",
      action_payload: {
        ...basePayload(),
        account_id: account.id,
        account_name: account.name,
        debt_id: debt.id,
        creditor: debt.creditor,
        counterparty: debt.creditor,
        amount,
        total_amount: amount,
        description: `Empréstimo recebido - ${debt.creditor}`,
        merchant: debt.creditor,
        notes: "Empréstimo recebido informado no chat.",
      },
      model: "deterministic-financial-engine",
    };
  }

  return null;
}

// Mantém compatibilidade com o componente atual do assistente.
export function tryParseDebtReceived(
  message: string,
  context: AssistantContext,
): AssistantApiResponse | null {
  const result = tryParseUnifiedFinancialAction(message, context);
  if (!result) return null;
  return {
    ...result,
    reply: result.reply || getActionProposalText(result.action_type, result.action_payload),
  };
}
