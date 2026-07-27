export type DebtGroup =
  | "personal"
  | "other";

export type DebtKind =
  | "bank_loan"
  | "financing"
  | "retail"
  | "credit_card"
  | "tax"
  | "bill"
  | "other";

export type InterestPeriod =
  | "daily"
  | "monthly"
  | "yearly";

export type InterestMethod =
  | "simple"
  | "compound";

export type CommitmentDirection =
  | "payable"
  | "receivable";

export type CommitmentStatus =
  | "pending"
  | "partial"
  | "settled"
  | "overdue"
  | "cancelled";

export type DebtPosition = {
  id: string;
  household_id: string;
  creditor: string;
  description: string | null;
  debt_group: DebtGroup;
  debt_kind: DebtKind;

  original_amount: number | string;
  current_balance: number | string;
  ledger_balance: number | string;
  accrued_interest: number | string;
  projected_penalty: number | string;
  projected_late_interest: number | string;
  projected_balance: number | string;
  daily_growth: number | string;
  overdue_days: number;

  installment_amount: number | string | null;
  total_installments: number | null;
  paid_installments: number;

  interest_enabled: boolean;
  auto_accrue_interest: boolean;
  interest_rate: number | string;
  interest_period: InterestPeriod;
  interest_method: InterestMethod;
  interest_start_date: string | null;
  interest_accrued_through: string | null;
  penalty_rate: number | string;
  penalty_applied: boolean;
  daily_late_interest_rate: number | string;
  grace_period_days: number;

  start_date: string | null;
  due_date: string | null;
  status: string;
};

export type CommitmentProgress = {
  id: string;
  household_id: string;
  direction: CommitmentDirection;
  counterparty: string;
  description: string;
  category_id: string | null;
  default_account_id: string | null;
  total_amount: number | string;
  settled_amount: number | string;
  remaining_amount: number | string;
  computed_status: CommitmentStatus;
  progress_percentage: number | string;
  issued_on: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
};

export function toNumber(
  value: number | string | null | undefined,
) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCurrency(
  value: number | string | null | undefined,
) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(toNumber(value));
}

export function parsePtBrAmount(value: string) {
  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Não informado";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function getDebtKindLabel(kind: DebtKind) {
  const labels: Record<DebtKind, string> = {
    bank_loan: "Empréstimo bancário",
    financing: "Financiamento",
    retail: "Loja ou crediário",
    credit_card: "Cartão de crédito",
    tax: "Imposto",
    bill: "Conta vencida",
    other: "Outra dívida",
  };

  return labels[kind];
}

export function getInterestPeriodLabel(period: InterestPeriod) {
  const labels: Record<InterestPeriod, string> = {
    daily: "ao dia",
    monthly: "ao mês",
    yearly: "ao ano",
  };

  return labels[period];
}

export function getInterestMethodLabel(method: InterestMethod) {
  return method === "compound" ? "Juros compostos" : "Juros simples";
}

export function getCommitmentStatusLabel(status: CommitmentStatus) {
  const labels: Record<CommitmentStatus, string> = {
    pending: "Pendente",
    partial: "Parcialmente liquidado",
    settled: "Liquidado",
    overdue: "Atrasado",
    cancelled: "Cancelado",
  };

  return labels[status];
}

export function getCommitmentDirectionLabel(direction: CommitmentDirection) {
  return direction === "payable" ? "Conta a pagar" : "Valor a receber";
}
