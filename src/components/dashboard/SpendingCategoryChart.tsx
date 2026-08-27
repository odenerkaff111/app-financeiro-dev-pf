"use client";

import {
  Loader2,
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

type PayableCommitment = {
  remaining_amount: number | string;
  due_date: string | null;
  computed_status: string;
};

type SpendingCategoryChartProps = {
  categoryData: CategoryData[];
  periodFilter: PeriodFilter;
};

const CATEGORY_COLORS: Record<string, string> = {
  Investimento: "#047857",
  Educação: "#7C3AED",
  Despesa: "#64748B",
  Dívidas: "#B91C1C",
  "Contas abertas": "#B45309",
  Alimentação: "#C8A15A",
  Saúde: "#0369A1",
  Diversão: "#BE123C",
};

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  today: "hoje",
  week: "nesta semana",
  month: "neste mês",
  all: "em todo o período",
};

function formatCurrency(value: number | string | null) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeCategoryName(categoryName: string) {
  const name = normalizeText(categoryName);

  if (
    name.includes("invest") ||
    name.includes("tesouro") ||
    name.includes("aplicacao")
  ) {
    return "Investimento";
  }

  if (
    name.includes("educ") ||
    name.includes("escola") ||
    name.includes("curso") ||
    name.includes("faculdade")
  ) {
    return "Educação";
  }

  if (
    name.includes("divida") ||
    name.includes("financiamento")
  ) {
    return "Dívidas";
  }

  if (
    name.includes("aliment") ||
    name.includes("mercado") ||
    name.includes("supermercado") ||
    name.includes("restaurante") ||
    name.includes("delivery")
  ) {
    return "Alimentação";
  }

  if (
    name.includes("saude") ||
    name.includes("academia") ||
    name.includes("medico") ||
    name.includes("farmacia") ||
    name.includes("dentista")
  ) {
    return "Saúde";
  }

  if (
    name.includes("divers") ||
    name.includes("lazer") ||
    name.includes("entretenimento") ||
    name.includes("cinema") ||
    name.includes("streaming")
  ) {
    return "Diversão";
  }

  return "Despesa";
}

function isDateInPeriod(
  value: string | null,
  periodFilter: PeriodFilter,
) {
  if (periodFilter === "all") {
    return true;
  }

  if (!value) {
    return false;
  }

  try {
    const date = parseISO(value);
    const today = new Date();

    if (periodFilter === "today") {
      return isSameDay(date, today);
    }

    if (periodFilter === "week") {
      return isSameWeek(date, today, {
        weekStartsOn: 1,
      });
    }

    return isSameMonth(date, today);
  } catch {
    return false;
  }
}

function expectedDebtCommitment(
  monthlyAmount: number,
  periodFilter: PeriodFilter,
) {
  if (monthlyAmount <= 0) {
    return 0;
  }

  const today = new Date();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();

  if (periodFilter === "today") {
    return monthlyAmount / daysInMonth;
  }

  if (periodFilter === "week") {
    return monthlyAmount * (7 / daysInMonth);
  }

  return monthlyAmount;
}

export function SpendingCategoryChart({
  categoryData,
  periodFilter,
}: SpendingCategoryChartProps) {
  const { household } = useHousehold();
  const [debts, setDebts] = useState<DebtCommitment[]>([]);
  const [commitments, setCommitments] = useState<PayableCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [debtsResult, commitmentsResult] = await Promise.all([
      supabase
        .from("pf_debt_progress")
        .select("installment_amount, status")
        .eq("household_id", household.id)
        .neq("status", "cancelled"),
      supabase
        .from("pf_commitment_progress")
        .select("remaining_amount, due_date, computed_status")
        .eq("household_id", household.id)
        .eq("direction", "payable"),
    ]);

    const firstError = debtsResult.error ?? commitmentsResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setDebts((debtsResult.data ?? []) as DebtCommitment[]);
    setCommitments(
      (commitmentsResult.data ?? []) as PayableCommitment[],
    );
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const chartData = useMemo(() => {
    const totals = new Map<string, number>();

    categoryData.forEach((category) => {
      const name = normalizeCategoryName(category.name);
      totals.set(
        name,
        (totals.get(name) ?? 0) + Number(category.value || 0),
      );
    });

    const monthlyDebtAmount = debts
      .filter((debt) => debt.status !== "paid")
      .reduce(
        (sum, debt) =>
          sum + Number(debt.installment_amount ?? 0),
        0,
      );

    const debtAmount = expectedDebtCommitment(
      monthlyDebtAmount,
      periodFilter,
    );

    if (debtAmount > 0) {
      totals.set(
        "Dívidas",
        Math.max(totals.get("Dívidas") ?? 0, debtAmount),
      );
    }

    const openBills = commitments
      .filter(
        (commitment) =>
          commitment.computed_status !== "settled" &&
          commitment.computed_status !== "cancelled" &&
          isDateInPeriod(commitment.due_date, periodFilter),
      )
      .reduce(
        (sum, commitment) =>
          sum + Number(commitment.remaining_amount || 0),
        0,
      );

    if (openBills > 0) {
      totals.set("Contas abertas", openBills);
    }

    return Array.from(totals.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((item) => item.value > 0)
      .sort((first, second) => second.value - first.value);
  }, [categoryData, commitments, debts, periodFilter]);

  if (loading) {
    return (
      <article className="flex h-full min-h-[500px] items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
      </article>
    );
  }

  return (
    <article className="flex h-full min-h-[500px] flex-col rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#0D1B2A]">
            Gastos e compromissos
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#3A3A3C]/60">
            O que saiu ou está comprometido {PERIOD_LABELS[periodFilter]}.
          </p>
        </div>
        <WalletCards
          size={19}
          className="shrink-0 text-[#C8A15A]"
        />
      </div>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Não foi possível carregar gastos e compromissos.
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-sm text-[#3A3A3C]/50">
          Nenhum gasto ou compromisso encontrado no período.
        </div>
      ) : (
        <>
          <div className="mt-4 h-52 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  innerRadius={54}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                >
                  {chartData.map((category) => (
                    <Cell
                      key={category.name}
                      fill={
                        CATEGORY_COLORS[category.name] ?? "#64748B"
                      }
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value) =>
                    formatCurrency(Number(value ?? 0))
                  }
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #E5E7EB",
                    boxShadow: "0 8px 30px rgba(13,27,42,.08)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 space-y-3">
            {chartData.map((category) => (
              <div
                key={category.name}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        CATEGORY_COLORS[category.name] ?? "#64748B",
                    }}
                  />
                  <span className="truncate text-[#3A3A3C]/70">
                    {category.name}
                  </span>
                </div>
                <span className="shrink-0 font-semibold text-[#0D1B2A]">
                  {formatCurrency(category.value)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
