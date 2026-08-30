"use client";

import {
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

type PeriodFilter =
  | "today"
  | "week"
  | "month"
  | "custom"
  | "all";

type MonthlyClosingSectionProps = {
  periodFilter: PeriodFilter;
  income: number;
  receivable: number;
  expense: number;
  payable: number;
  budgetReserve?: number;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

const PERIOD_TITLES: Record<PeriodFilter, { positive: string; negative: string }> = {
  today: {
    positive: "Seu dia fecha positivo",
    negative: "Seu dia fecha no vermelho",
  },
  week: {
    positive: "Sua semana fecha positiva",
    negative: "Sua semana fecha no vermelho",
  },
  month: {
    positive: "Seu mês fecha positivo",
    negative: "Seu mês fecha no vermelho",
  },
  custom: {
    positive: "Seu período fecha positivo",
    negative: "Seu período fecha no vermelho",
  },
  all: {
    positive: "Seu resultado projetado é positivo",
    negative: "Seu resultado projetado é negativo",
  },
};

export function MonthlyClosingSection({
  periodFilter,
  income,
  receivable,
  expense,
  payable,
  budgetReserve = 0,
}: MonthlyClosingSectionProps) {
  // O usuário pode optar por não manter saldos bancários no sistema.
  // Por isso a projeção usa fluxos do período, e não saldo de conta:
  // entradas realizadas + previstas - saídas realizadas - a pagar - reservas.
  const expectedIncome = income + receivable;
  const expectedExpense = expense + payable + budgetReserve;
  const projection = expectedIncome - expectedExpense;
  const closesNegative = projection < 0;
  const difference = Math.abs(projection);
  const title = closesNegative
    ? PERIOD_TITLES[periodFilter].negative
    : PERIOD_TITLES[periodFilter].positive;

  return (
    <section
      className={[
        "rounded-2xl border p-5 shadow-sm",
        closesNegative
          ? "border-red-200 bg-red-50"
          : "border-emerald-200 bg-emerald-50",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={[
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              closesNegative
                ? "bg-red-100 text-red-700"
                : "bg-emerald-100 text-emerald-700",
            ].join(" ")}
          >
            {closesNegative ? (
              <AlertTriangle size={21} />
            ) : (
              <CheckCircle2 size={21} />
            )}
          </div>

          <div>
            <p className="text-sm font-semibold text-[#0D1B2A]">
              {title}
            </p>
            <p
              className={[
                "mt-1 text-3xl font-semibold",
                closesNegative ? "text-red-800" : "text-emerald-800",
              ].join(" ")}
            >
              {closesNegative ? "-" : "+"}
              {formatCurrency(difference)}
            </p>
          </div>
        </div>

        <p className="max-w-xl text-sm leading-6 text-[#3A3A3C]/60 sm:text-right">
          {closesNegative
            ? `Faltam ${formatCurrency(difference)} para cobrir o que já saiu, o que ainda está a pagar e os planejamentos reservados.`
            : `Sobram ${formatCurrency(difference)} depois de considerar entradas realizadas e previstas, saídas, contas a pagar e planejamentos.`}
        </p>
      </div>

      <div className="mt-4 border-t border-current/10 pt-3 text-xs leading-5 text-[#3A3A3C]/55">
        Entradas: {formatCurrency(income)} realizadas + {formatCurrency(receivable)} a receber · Saídas: {formatCurrency(expense)} realizadas + {formatCurrency(payable)} a pagar
        {budgetReserve > 0
          ? ` + ${formatCurrency(budgetReserve)} ainda reservado em planejamentos`
          : ""}.
      </div>
    </section>
  );
}
