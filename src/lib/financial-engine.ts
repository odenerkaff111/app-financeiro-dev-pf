export type DebtGroup =
  | "personal"
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

  original_amount:
    | number
    | string;

  ledger_balance:
    | number
    | string;

  accrued_interest:
    | number
    | string;

  projected_penalty:
    | number
    | string;

  projected_late_interest:
    | number
    | string;

  projected_balance:
    | number
    | string;

  daily_growth:
    | number
    | string;

  overdue_days: number;

  interest_enabled: boolean;
  auto_accrue_interest: boolean;

  interest_rate:
    | number
    | string;

  interest_period:
    InterestPeriod;

  interest_method:
    InterestMethod;

  due_date: string | null;
  status: string;
};

export type CommitmentProgress = {
  id: string;
  household_id: string;

  direction:
    CommitmentDirection;

  counterparty: string;
  description: string;

  total_amount:
    | number
    | string;

  settled_amount:
    | number
    | string;

  remaining_amount:
    | number
    | string;

  computed_status:
    CommitmentStatus;

  progress_percentage:
    | number
    | string;

  issued_on: string;
  due_date: string | null;
};

export function toNumber(
  value:
    | number
    | string
    | null
    | undefined,
) {
  const parsed =
    Number(value ?? 0);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

export function formatCurrency(
  value:
    | number
    | string
    | null
    | undefined,
) {
  return new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    },
  ).format(
    toNumber(value),
  );
}

export function parsePtBrAmount(
  value: string,
) {
  const normalized =
    value
      .trim()
      .replace(/\s/g, "")
      .replace(/R\$/gi, "")
      .replace(/\./g, "")
      .replace(",", ".");

  const parsed =
    Number(normalized);

  return Number.isFinite(parsed)
    ? parsed
    : Number.NaN;
}

export function calculateInterest(
  balance: number,
  ratePercent: number,
  periodFraction: number,
  method: InterestMethod,
) {
  if (
    balance <= 0 ||
    ratePercent <= 0 ||
    periodFraction <= 0
  ) {
    return 0;
  }

  const rate =
    ratePercent / 100;

  if (method === "compound") {
    return (
      balance *
      (Math.pow(
        1 + rate,
        periodFraction,
      ) - 1)
    );
  }

  return (
    balance *
    rate *
    periodFraction
  );
}

export function getPeriodFraction(
  days: number,
  period: InterestPeriod,
) {
  if (days <= 0) {
    return 0;
  }

  if (period === "daily") {
    return days;
  }

  if (period === "yearly") {
    return days / 365;
  }

  return days / 30;
}

export function getDebtGroupLabel(
  group: DebtGroup,
) {
  return group === "personal"
    ? "Dívida pessoal"
    : "Outra dívida ou financiamento";
}

export function getInterestPeriodLabel(
  period: InterestPeriod,
) {
  const labels: Record<
    InterestPeriod,
    string
  > = {
    daily: "ao dia",
    monthly: "ao mês",
    yearly: "ao ano",
  };

  return labels[period];
}

export function getInterestMethodLabel(
  method: InterestMethod,
) {
  return method === "compound"
    ? "Juros compostos"
    : "Juros simples";
}

export function getCommitmentStatusLabel(
  status: CommitmentStatus,
) {
  const labels: Record<
    CommitmentStatus,
    string
  > = {
    pending: "Pendente",
    partial: "Parcialmente liquidado",
    settled: "Liquidado",
    overdue: "Atrasado",
    cancelled: "Cancelado",
  };

  return labels[status];
}

export function getCommitmentDirectionLabel(
  direction: CommitmentDirection,
) {
  return direction === "payable"
    ? "Conta a pagar"
    : "Valor a receber";
}

export function getCommitmentProgress(
  totalAmount:
    | number
    | string,
  settledAmount:
    | number
    | string,
) {
  const total =
    toNumber(totalAmount);

  const settled =
    toNumber(settledAmount);

  if (total <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      (settled / total) * 100,
    ),
  );
}
