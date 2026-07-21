"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  isSameDay,
  isSameMonth,
  isSameWeek,
  parseISO,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type PeriodFilter =
  | "today"
  | "week"
  | "month"
  | "all";

type CategoryData = {
  name: string;
  value: number;
};

type DebtCommitment = {
  installment_amount: number | string | null;
  status: string;
};

type StructuralTransaction = {
  type: string;
  status: string;
  amount: number | string;
  occurred_on: string;
};

type SpendingCategoryChartProps = {
  categoryData: CategoryData[];
  periodFilter: PeriodFilter;
};

type BehaviorSummary = {
  invested: number;
  withdrawn: number;
  netInvested: number;
  debtPaid: number;
  borrowed: number;
  positiveAmount: number;
  riskAmount: number;
  score: number | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  Investimento: "#047857",
  Educação: "#7C3AED",
  Despesa: "#64748B",
  Dívidas: "#B91C1C",
  Empréstimos: "#B45309",
  Alimentação: "#C8A15A",
  Saúde: "#0369A1",
  Diversão: "#BE123C",
};

const PERIOD_LABELS: Record<
  PeriodFilter,
  string
> = {
  today: "hoje",
  week: "nesta semana",
  month: "neste mês",
  all: "em todo o período",
};

function formatCurrency(
  value: number | string | null,
) {
  const parsedValue = Number(value ?? 0);

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(
    Number.isFinite(parsedValue)
      ? parsedValue
      : 0,
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeCategoryName(
  categoryName: string,
) {
  const normalizedName =
    normalizeText(categoryName);

  if (
    normalizedName.includes("invest") ||
    normalizedName.includes("tesouro") ||
    normalizedName.includes("aplicacao")
  ) {
    return "Investimento";
  }

  if (
    normalizedName.includes("educ") ||
    normalizedName.includes("escola") ||
    normalizedName.includes("curso") ||
    normalizedName.includes("faculdade")
  ) {
    return "Educação";
  }

  if (
    normalizedName.includes("divida") ||
    normalizedName.includes("financiamento") ||
    normalizedName.includes("parcela de divida")
  ) {
    return "Dívidas";
  }

  if (
    normalizedName.includes("emprest") ||
    normalizedName.includes("credito") ||
    normalizedName.includes("pix parcelado")
  ) {
    return "Empréstimos";
  }

  if (
    normalizedName.includes("aliment") ||
    normalizedName.includes("mercado") ||
    normalizedName.includes("supermercado") ||
    normalizedName.includes("sacolao") ||
    normalizedName.includes("restaurante") ||
    normalizedName.includes("delivery")
  ) {
    return "Alimentação";
  }

  if (
    normalizedName.includes("saude") ||
    normalizedName.includes("academia") ||
    normalizedName.includes("medico") ||
    normalizedName.includes("farmacia") ||
    normalizedName.includes("dentista") ||
    normalizedName.includes("terapia")
  ) {
    return "Saúde";
  }

  if (
    normalizedName.includes("divers") ||
    normalizedName.includes("lazer") ||
    normalizedName.includes("entretenimento") ||
    normalizedName.includes("cinema") ||
    normalizedName.includes("viagem") ||
    normalizedName.includes("streaming")
  ) {
    return "Diversão";
  }

  return "Despesa";
}

function isTransactionInPeriod(
  occurredOn: string,
  periodFilter: PeriodFilter,
  previousPeriod = false,
) {
  try {
    const transactionDate =
      parseISO(occurredOn);

    const today = new Date();

    if (periodFilter === "all") {
      return !previousPeriod;
    }

    if (periodFilter === "today") {
      const referenceDate = previousPeriod
        ? subDays(today, 1)
        : today;

      return isSameDay(
        transactionDate,
        referenceDate,
      );
    }

    if (periodFilter === "week") {
      const referenceDate = previousPeriod
        ? subWeeks(today, 1)
        : today;

      return isSameWeek(
        transactionDate,
        referenceDate,
        {
          weekStartsOn: 1,
        },
      );
    }

    const referenceDate = previousPeriod
      ? subMonths(today, 1)
      : today;

    return isSameMonth(
      transactionDate,
      referenceDate,
    );
  } catch {
    return false;
  }
}

function summarizeBehavior(
  transactions: StructuralTransaction[],
): BehaviorSummary {
  let invested = 0;
  let withdrawn = 0;
  let debtPaid = 0;
  let borrowed = 0;

  transactions.forEach((transaction) => {
    const amount =
      Number(transaction.amount) || 0;

    if (
      transaction.type ===
      "investment_contribution"
    ) {
      invested += amount;
    }

    if (
      transaction.type ===
      "investment_withdrawal"
    ) {
      withdrawn += amount;
    }

    if (
      transaction.type === "debt_payment"
    ) {
      debtPaid += amount;
    }

    if (
      transaction.type === "debt_received"
    ) {
      borrowed += amount;
    }
  });

  const netInvested = Math.max(
    invested - withdrawn,
    0,
  );

  const positiveAmount =
    netInvested + debtPaid;

  const riskAmount = borrowed;

  const consideredAmount =
    positiveAmount + riskAmount;

  const score =
    consideredAmount > 0
      ? (positiveAmount /
          consideredAmount) *
        100
      : null;

  return {
    invested,
    withdrawn,
    netInvested,
    debtPaid,
    borrowed,
    positiveAmount,
    riskAmount,
    score,
  };
}

function getExpectedDebtCommitment(
  monthlyCommitment: number,
  periodFilter: PeriodFilter,
) {
  if (monthlyCommitment <= 0) {
    return 0;
  }

  const today = new Date();

  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();

  if (periodFilter === "today") {
    return monthlyCommitment / daysInMonth;
  }

  if (periodFilter === "week") {
    return (
      monthlyCommitment *
      (7 / daysInMonth)
    );
  }

  return monthlyCommitment;
}

function getFinancialInsight(
  behavior: BehaviorSummary,
) {
  if (behavior.score === null) {
    return "Ainda não existem aportes, pagamentos de dívidas ou novos empréstimos suficientes para avaliar este período.";
  }

  if (
    behavior.borrowed > 0 &&
    behavior.debtPaid > 0 &&
    behavior.borrowed >=
      behavior.debtPaid
  ) {
    return "Você pagou dívidas, mas criou um valor igual ou maior em novos empréstimos. A pressão financeira não diminuiu de verdade.";
  }

  if (
    behavior.borrowed >
    behavior.positiveAmount
  ) {
    return "Novos empréstimos superaram os aportes e pagamentos de dívidas. O período aumentou seu risco financeiro.";
  }

  if (
    behavior.netInvested > 0 &&
    behavior.debtPaid > 0 &&
    behavior.borrowed === 0
  ) {
    return "Você investiu e reduziu dívidas sem criar novo crédito. É um forte sinal de melhora financeira.";
  }

  if (
    behavior.debtPaid > 0 &&
    behavior.borrowed === 0
  ) {
    return "Você reduziu dívidas sem criar novos empréstimos. O endividamento está seguindo uma direção melhor.";
  }

  if (
    behavior.netInvested > 0 &&
    behavior.borrowed === 0
  ) {
    return "Você aumentou seus investimentos sem recorrer a novos empréstimos.";
  }

  return "Os movimentos positivos superaram o novo endividamento, mas ainda há espaço para aumentar a redução de dívidas e os investimentos.";
}

export function SpendingCategoryChart({
  categoryData,
  periodFilter,
}: SpendingCategoryChartProps) {
  const { household } = useHousehold();

  const [debts, setDebts] = useState<
    DebtCommitment[]
  >([]);

  const [
    structuralTransactions,
    setStructuralTransactions,
  ] = useState<StructuralTransaction[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [loadError, setLoadError] =
    useState(false);

  const loadAdditionalData =
    useCallback(async () => {
      setLoading(true);
      setLoadError(false);

      const [
        debtsResult,
        transactionsResult,
      ] = await Promise.all([
        supabase
          .from("pf_debt_progress")
          .select(
            "installment_amount, status",
          )
          .eq(
            "household_id",
            household.id,
          )
          .neq("status", "cancelled"),

        supabase
          .from("pf_transactions")
          .select(
            "type, status, amount, occurred_on",
          )
          .eq(
            "household_id",
            household.id,
          )
          .eq("status", "paid")
          .in("type", [
            "debt_received",
            "debt_payment",
            "investment_contribution",
            "investment_withdrawal",
          ]),
      ]);

      if (
        debtsResult.error ||
        transactionsResult.error
      ) {
        console.error(
          "Erro ao carregar análise financeira:",
          debtsResult.error ??
            transactionsResult.error,
        );

        setLoadError(true);
        setLoading(false);
        return;
      }

      setDebts(
        (debtsResult.data ??
          []) as DebtCommitment[],
      );

      setStructuralTransactions(
        (transactionsResult.data ??
          []) as StructuralTransaction[],
      );

      setLoading(false);
    }, [household.id]);

  useEffect(() => {
    void loadAdditionalData();
  }, [loadAdditionalData]);

  const currentTransactions =
    useMemo(() => {
      return structuralTransactions.filter(
        (transaction) =>
          isTransactionInPeriod(
            transaction.occurred_on,
            periodFilter,
          ),
      );
    }, [
      structuralTransactions,
      periodFilter,
    ]);

  const previousTransactions =
    useMemo(() => {
      if (periodFilter === "all") {
        return [];
      }

      return structuralTransactions.filter(
        (transaction) =>
          isTransactionInPeriod(
            transaction.occurred_on,
            periodFilter,
            true,
          ),
      );
    }, [
      structuralTransactions,
      periodFilter,
    ]);

  const currentBehavior = useMemo(
    () =>
      summarizeBehavior(
        currentTransactions,
      ),
    [currentTransactions],
  );

  const previousBehavior = useMemo(
    () =>
      summarizeBehavior(
        previousTransactions,
      ),
    [previousTransactions],
  );

  const monthlyDebtCommitment =
    useMemo(() => {
      return debts
        .filter(
          (debt) =>
            debt.status !== "paid",
        )
        .reduce(
          (total, debt) =>
            total +
            Number(
              debt.installment_amount || 0,
            ),
          0,
        );
    }, [debts]);

  const expectedDebtCommitment =
    useMemo(() => {
      return getExpectedDebtCommitment(
        monthlyDebtCommitment,
        periodFilter,
      );
    }, [
      monthlyDebtCommitment,
      periodFilter,
    ]);

  const chartData = useMemo(() => {
    const consolidatedData = new Map<
      string,
      number
    >();

    categoryData.forEach((category) => {
      const normalizedCategory =
        normalizeCategoryName(
          category.name,
        );

      consolidatedData.set(
        normalizedCategory,
        (consolidatedData.get(
          normalizedCategory,
        ) ?? 0) +
          Number(category.value || 0),
      );
    });

    const existingDebtValue =
      consolidatedData.get("Dívidas") ??
      0;

    const debtValue = Math.max(
      existingDebtValue,
      currentBehavior.debtPaid,
      expectedDebtCommitment,
    );

    if (debtValue > 0) {
      consolidatedData.set(
        "Dívidas",
        debtValue,
      );
    }

    if (
      currentBehavior.borrowed > 0
    ) {
      consolidatedData.set(
        "Empréstimos",
        (consolidatedData.get(
          "Empréstimos",
        ) ?? 0) +
          currentBehavior.borrowed,
      );
    }

    if (
      currentBehavior.invested > 0
    ) {
      consolidatedData.set(
        "Investimento",
        (consolidatedData.get(
          "Investimento",
        ) ?? 0) +
          currentBehavior.invested,
      );
    }

    return Array.from(
      consolidatedData.entries(),
    )
      .map(([name, value]) => ({
        name,
        value,
      }))
      .filter(
        (category) =>
          category.value > 0,
      )
      .sort(
        (first, second) =>
          second.value - first.value,
      );
  }, [
    categoryData,
    currentBehavior,
    expectedDebtCommitment,
  ]);

  const financialStatus = useMemo(() => {
    if (currentBehavior.score === null) {
      return {
        label: "Sem dados",
        classes:
          "bg-slate-100 text-slate-700",
        icon: Minus,
      };
    }

    if (currentBehavior.score >= 70) {
      return {
        label: "Melhorando",
        classes:
          "bg-emerald-50 text-emerald-700",
        icon: TrendingUp,
      };
    }

    if (currentBehavior.score >= 40) {
      return {
        label: "Em atenção",
        classes:
          "bg-amber-50 text-amber-700",
        icon: AlertTriangle,
      };
    }

    return {
      label: "Piorando",
      classes:
        "bg-red-50 text-red-700",
      icon: TrendingDown,
    };
  }, [currentBehavior.score]);

  const comparisonText =
    useMemo(() => {
      if (
        periodFilter === "all" ||
        currentBehavior.score === null ||
        previousBehavior.score === null
      ) {
        return null;
      }

      const difference =
        currentBehavior.score -
        previousBehavior.score;

      if (difference >= 5) {
        return `Melhorou ${difference.toFixed(
          0,
        )} pontos em relação ao período anterior.`;
      }

      if (difference <= -5) {
        return `Piorou ${Math.abs(
          difference,
        ).toFixed(
          0,
        )} pontos em relação ao período anterior.`;
      }

      return "Permaneceu praticamente estável em relação ao período anterior.";
    }, [
      currentBehavior.score,
      previousBehavior.score,
      periodFilter,
    ]);

  const HealthIcon =
    financialStatus.icon;

  if (loading) {
    return (
      <article className="flex min-h-[420px] items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
      </article>
    );
  }

  if (loadError) {
    return (
      <article className="flex min-h-[420px] items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        Não foi possível carregar a análise
        financeira.
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0D1B2A]">
            Gastos e compromissos
          </h2>

          <p className="mt-1 text-sm leading-6 text-[#3A3A3C]/60">
            O que saiu, foi investido ou entrou
            como empréstimo{" "}
            {PERIOD_LABELS[periodFilter]}.
          </p>
        </div>

        <WalletCards
          size={19}
          className="shrink-0 text-[#C8A15A]"
        />
      </div>

      {chartData.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-center text-sm text-[#3A3A3C]/50">
          Nenhum movimento financeiro encontrado
          no período.
        </div>
      ) : (
        <>
          <div className="mt-4 h-44 min-w-0">
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  innerRadius={48}
                  outerRadius={70}
                  paddingAngle={2}
                  stroke="none"
                >
                  {chartData.map(
                    (category) => (
                      <Cell
                        key={category.name}
                        fill={
                          CATEGORY_COLORS[
                            category.name
                          ] ?? "#64748B"
                        }
                      />
                    ),
                  )}
                </Pie>

                <RechartsTooltip
                  formatter={(value) =>
                    formatCurrency(
                      Number(value ?? 0),
                    )
                  }
                  contentStyle={{
                    borderRadius: "12px",
                    border:
                      "1px solid #E5E7EB",
                    boxShadow:
                      "0 8px 30px rgba(13,27,42,.08)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 space-y-3">
            {chartData.map((category) => {
              const isLoan =
                category.name ===
                "Empréstimos";

              return (
                <div
                  key={category.name}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          CATEGORY_COLORS[
                            category.name
                          ] ?? "#64748B",
                      }}
                    />

                    <div className="min-w-0">
                      <span className="block truncate text-[#3A3A3C]/70">
                        {category.name}
                      </span>

                      <span className="block text-[10px] uppercase tracking-wider text-[#3A3A3C]/40">
                        {isLoan
                          ? "Entrada de crédito"
                          : "Saída ou compromisso"}
                      </span>
                    </div>
                  </div>

                  <span className="shrink-0 font-semibold text-[#0D1B2A]">
                    {formatCurrency(
                      category.value,
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <section className="mt-5 rounded-xl border border-[#0D1B2A]/8 bg-[#F7F5EF] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={[
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                financialStatus.classes,
              ].join(" ")}
            >
              <HealthIcon size={18} />
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3A3A3C]/50">
                Direção financeira
              </p>

              <div className="mt-1 flex items-baseline gap-2">
                <p className="text-lg font-semibold text-[#0D1B2A]">
                  {financialStatus.label}
                </p>

                <span className="text-xs text-[#3A3A3C]/50">
                  {currentBehavior.score ===
                  null
                    ? "—"
                    : `${currentBehavior.score.toFixed(
                        0,
                      )}/100`}
                </span>
              </div>
            </div>
          </div>

          {comparisonText && (
            <p className="max-w-[230px] text-xs leading-5 text-[#3A3A3C]/60">
              {comparisonText}
            </p>
          )}
        </div>

        <p className="mt-3 text-xs leading-5 text-[#3A3A3C]/65">
          {getFinancialInsight(
            currentBehavior,
          )}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <BehaviorItem
            label="Investido"
            value={currentBehavior.invested}
            positive
          />

          <BehaviorItem
            label="Dívidas pagas"
            value={currentBehavior.debtPaid}
            positive
          />

          <BehaviorItem
            label="Novos empréstimos"
            value={currentBehavior.borrowed}
            negative
          />
        </div>
      </section>

      <div className="mt-4 border-t border-[#0D1B2A]/8 pt-3">
        <p className="text-[11px] leading-5 text-[#3A3A3C]/50">
          Dívidas consideram pagamentos realizados
          ou o compromisso proporcional estimado do
          período. Empréstimos mostram apenas valores
          realmente recebidos.
        </p>

        <Link
          href="/dividas"
          className="mt-1 inline-flex text-xs font-semibold text-[#0D1B2A] hover:underline"
        >
          Ver detalhes das dívidas
        </Link>
      </div>
    </article>
  );
}

function BehaviorItem({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
}) {
  const valueClasses = positive
    ? "text-emerald-700"
    : negative
      ? "text-red-700"
      : "text-[#0D1B2A]";

  return (
    <div className="rounded-lg bg-white px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
        {label}
      </p>

      <p
        className={[
          "mt-1 text-sm font-semibold",
          valueClasses,
        ].join(" ")}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}