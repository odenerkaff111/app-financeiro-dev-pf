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
  differenceInCalendarDays,
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
  | "next_month"
  | "custom"
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
  customStart?: string;
  customEnd?: string;
};

const CATEGORY_PALETTE = [
  "#0F766E",
  "#B91C1C",
  "#1D4ED8",
  "#A16207",
  "#7E22CE",
  "#BE123C",
  "#047857",
  "#C2410C",
  "#334155",
  "#0369A1",
  "#4D7C0F",
  "#9F1239",
  "#5B21B6",
  "#0E7490",
  "#92400E",
  "#4338CA",
];

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  today: "hoje",
  week: "nesta semana",
  month: "neste mês",
  next_month: "no próximo mês",
  custom: "no período personalizado",
  all: "em todo o período",
};

function formatCurrency(value: number | string | null) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function fallbackCategoryColor(index: number) {
  // Golden-angle hue spacing keeps generated colors distinct even when
  // the number of custom categories grows beyond the fixed palette.
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 68% 42%)`;
}

function isDateInPeriod(
  value: string | null,
  periodFilter: PeriodFilter,
  customStart?: string,
  customEnd?: string,
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

    if (periodFilter === "next_month") {
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
      return isSameMonth(date, nextMonth);
    }

    if (periodFilter === "custom") {
      if (!customStart || !customEnd || customStart > customEnd) {
        return false;
      }

      return value >= customStart && value <= customEnd;
    }

    return isSameMonth(date, today);
  } catch {
    return false;
  }
}

function expectedDebtCommitment(
  monthlyAmount: number,
  periodFilter: PeriodFilter,
  customStart?: string,
  customEnd?: string,
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

  if (periodFilter === "custom") {
    if (!customStart || !customEnd || customStart > customEnd) {
      return 0;
    }

    try {
      const days =
        differenceInCalendarDays(parseISO(customEnd), parseISO(customStart)) + 1;
      return monthlyAmount * (Math.max(days, 1) / 30);
    } catch {
      return 0;
    }
  }

  return monthlyAmount;
}

export function SpendingCategoryChart({
  categoryData,
  periodFilter,
  customStart,
  customEnd,
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
      const name = category.name.trim() || "Sem categoria";
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
      customStart,
      customEnd,
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
          isDateInPeriod(
            commitment.due_date,
            periodFilter,
            customStart,
            customEnd,
          ),
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
  }, [
    categoryData,
    commitments,
    debts,
    periodFilter,
    customStart,
    customEnd,
  ]);

  const colorByCategory = useMemo(() => {
    const names = chartData
      .map((item) => item.name)
      .slice()
      .sort((first, second) => first.localeCompare(second, "pt-BR"));

    return new Map(
      names.map((name, index) => [
        name,
        CATEGORY_PALETTE[index] ?? fallbackCategoryColor(index),
      ]),
    );
  }, [chartData]);

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
                      fill={colorByCategory.get(category.name)}
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
                      backgroundColor: colorByCategory.get(category.name),
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
