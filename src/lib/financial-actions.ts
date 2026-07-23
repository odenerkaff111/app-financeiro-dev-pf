export type FinancialActionType =
  | "none"
  | "create_transaction"
  | "create_transfer"
  | "register_debt_payment";

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
