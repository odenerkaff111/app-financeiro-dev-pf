"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  PiggyBank,
  Receipt,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  format,
  isSameMonth,
  isSameWeek,
  isToday,
  parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";
import { SpendingCategoryChart } from "@/components/dashboard/SpendingCategoryChart";
import { DebtSummarySection } from "@/components/DebtSummarySection";
import { MonthlyClosingSection } from "@/components/MonthlyClosingSection";
import { UpcomingObligations } from "@/components/dashboard/UpcomingObligations";
import { InvestmentOverview } from "@/components/dashboard/InvestmentOverview";
import { CostOfLivingCard } from "@/components/dashboard/CostOfLivingCard";
import { BudgetPlanningSummary } from "@/components/dashboard/BudgetPlanningSummary";

type PeriodFilter =
  | "today"
  | "week"
  | "month"
  | "next_month"
  | "custom"
  | "all";

type AccountType =
  | "checking"
  | "savings"
  | "cash"
  | "wallet"
  | "credit_card"
  | "investment";

type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "debt_received"
  | "debt_payment"
  | "investment_contribution"
  | "investment_withdrawal"
  | "adjustment";

type TransactionStatus =
  | "planned"
  | "paid"
  | "overdue"
  | "cancelled";

type Account = {
  id: string;
  household_id: string;
  name: string;
  institution_name: string | null;
  type: AccountType;
  balance: number | string;
  is_active: boolean;
};

type Category = {
  id: string;
  name: string;
  kind: string;
  group_type: string;
};

type Transaction = {
  id: string;
  household_id: string;
  account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  budget_id: string | null;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  merchant: string | null;
  amount: number | string;
  occurred_on: string;
  due_date: string | null;
  paid_at: string | null;
};

type Budget = {
  id: string;
  category_id: string;
  month: string;
  amount: number | string;
};

const MONTH_NAMES = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];


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

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    compactDisplay: "short",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Sem vencimento";
  }

  try {
    return format(
      parseISO(value),
      "dd/MM/yyyy",
      {
        locale: ptBR,
      },
    );
  } catch {
    return value;
  }
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(
    now.getMonth() + 1,
  ).padStart(2, "0");
  const day = String(
    now.getDate(),
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function monthStartKey(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function getMonthKey(offset = 0) {
  const reference = new Date();
  reference.setDate(1);
  reference.setMonth(reference.getMonth() + offset);
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
}

function relevantBudgetMonths(
  periodFilter: PeriodFilter,
  customStart: string,
  customEnd: string,
) {
  if (periodFilter === "month") {
    return new Set([`${getMonthKey()}-01`]);
  }

  if (periodFilter === "next_month") {
    return new Set([`${getMonthKey(1)}-01`]);
  }

  if (periodFilter !== "custom" || !customStart || !customEnd || customStart > customEnd) {
    return new Set<string>();
  }

  const months = new Set<string>();
  const cursor = new Date(`${customStart.slice(0, 7)}-01T12:00:00`);
  const end = new Date(`${customEnd.slice(0, 7)}-01T12:00:00`);

  while (cursor <= end) {
    months.add(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`,
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function getEffectiveStatus(
  transaction: Transaction,
): TransactionStatus {
  if (
    transaction.status === "planned" &&
    transaction.due_date &&
    transaction.due_date < getToday()
  ) {
    return "overdue";
  }

  return transaction.status;
}

export default function DashboardPage() {
  const { household } = useHousehold();

  const [accounts, setAccounts] = useState<
    Account[]
  >([]);

  const [categories, setCategories] =
    useState<Category[]>([]);

  const [transactions, setTransactions] =
    useState<Transaction[]>([]);

  const [budgets, setBudgets] =
    useState<Budget[]>([]);

  const [periodFilter, setPeriodFilter] =
    useState<PeriodFilter>("month");
  const [customStart, setCustomStart] = useState(getToday());
  const [customEnd, setCustomEnd] = useState(getToday());
  const [annualYear, setAnnualYear] = useState(new Date().getFullYear());
  const [dashboardValuesHidden, setDashboardValuesHidden] = useState(false);

  const [loading, setLoading] =
    useState(true);

  const [updatingId, setUpdatingId] =
    useState<string | null>(null);

  const [error, setError] = useState<
    string | null
  >(null);

  useEffect(() => {
    const storageKey = `pf:dashboard-values-hidden:${household.id}`;
    setDashboardValuesHidden(window.localStorage.getItem(storageKey) === "true");
  }, [household.id]);

  function toggleDashboardPrivacy() {
    setDashboardValuesHidden((current) => {
      const next = !current;
      window.localStorage.setItem(
        `pf:dashboard-values-hidden:${household.id}`,
        String(next),
      );
      return next;
    });
  }

  const privateDataClass = dashboardValuesHidden
    ? "pointer-events-none select-none blur-[7px] opacity-35 transition"
    : "transition";

  const loadDashboard = useCallback(
    async () => {
      setLoading(true);
      setError(null);

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonthIndex = now.getMonth();
      const annualRecurringMonths =
        annualYear < currentYear
          ? []
          : Array.from({ length: 12 }, (_, index) =>
              `${annualYear}-${String(index + 1).padStart(2, "0")}-01`,
            ).filter((_, index) =>
              annualYear > currentYear || index >= currentMonthIndex,
            );

      const recurringMonths = new Set<string>([
        `${getMonthKey()}-01`,
        `${getMonthKey(1)}-01`,
        ...annualRecurringMonths,
      ]);

      const recurringGenerations = await Promise.all(
        Array.from(recurringMonths).map((targetMonth) =>
          supabase.rpc("pf_generate_recurring_transactions", {
            target_month: targetMonth,
          }),
        ),
      );

      recurringGenerations.forEach((generation) => {
        if (generation.error) {
          console.warn(
            "Não foi possível gerar uma competência recorrente:",
            generation.error,
          );
        }
      });

      const [
        accountsResult,
        categoriesResult,
        transactionsResult,
        budgetsResult,
      ] = await Promise.all([
        supabase
          .from("pf_accounts")
          .select(
            "id, household_id, name, institution_name, type, balance, is_active",
          )
          .eq(
            "household_id",
            household.id,
          )
          .order("name"),

        supabase
          .from("pf_categories")
          .select(
            "id, name, kind, group_type",
          )
          .eq(
            "household_id",
            household.id,
          ),

        supabase
          .from("pf_transactions")
          .select(
            "id, household_id, account_id, destination_account_id, category_id, budget_id, type, status, description, merchant, amount, occurred_on, due_date, paid_at",
          )
          .eq(
            "household_id",
            household.id,
          )
          .order("occurred_on", {
            ascending: false,
          })
          .order("created_at", {
            ascending: false,
          }),

        supabase
          .from("pf_budgets")
          .select("id, category_id, month, amount")
          .eq("household_id", household.id),
      ]);

      if (accountsResult.error) {
        console.error(
          "Erro ao carregar contas:",
          accountsResult.error,
        );

        setError(
          "Não foi possível carregar suas contas.",
        );

        setLoading(false);
        return;
      }

      if (categoriesResult.error) {
        console.error(
          "Erro ao carregar categorias:",
          categoriesResult.error,
        );

        setError(
          "Não foi possível carregar as categorias.",
        );

        setLoading(false);
        return;
      }

      if (transactionsResult.error) {
        console.error(
          "Erro ao carregar movimentações:",
          transactionsResult.error,
        );

        setError(
          "Não foi possível carregar as movimentações.",
        );

        setLoading(false);
        return;
      }

      if (budgetsResult.error) {
        console.error(
          "Erro ao carregar planejamentos:",
          budgetsResult.error,
        );

        setError(
          "Não foi possível carregar os planejamentos.",
        );

        setLoading(false);
        return;
      }

      setAccounts(
        (accountsResult.data ??
          []) as Account[],
      );

      setCategories(
        (categoriesResult.data ??
          []) as Category[],
      );

      setTransactions(
        (transactionsResult.data ??
          []) as Transaction[],
      );

      setBudgets(
        (budgetsResult.data ?? []) as Budget[],
      );

      setLoading(false);
    },
    [household.id, annualYear],
  );

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const categoryMap = useMemo(() => {
    return new Map(
      categories.map((category) => [
        category.id,
        category,
      ]),
    );
  }, [categories]);

  const periodTransactions = useMemo(() => {
    const now = new Date();

    return transactions.filter(
      (transaction) => {
        if (periodFilter === "all") {
          return true;
        }

        try {
          const effectiveStatus =
            getEffectiveStatus(transaction);

          const referenceDate =
            effectiveStatus === "planned" ||
            effectiveStatus === "overdue"
              ? transaction.due_date ?? transaction.occurred_on
              : transaction.paid_at?.slice(0, 10) ?? transaction.occurred_on;

          const date = parseISO(referenceDate);

          if (periodFilter === "today") {
            return isToday(date);
          }

          if (periodFilter === "week") {
            return isSameWeek(
              date,
              now,
              {
                weekStartsOn: 0,
              },
            );
          }

          if (periodFilter === "next_month") {
            return referenceDate.slice(0, 7) === getMonthKey(1);
          }

          if (periodFilter === "custom") {
            if (!customStart || !customEnd || customStart > customEnd) {
              return false;
            }

            return referenceDate >= customStart && referenceDate <= customEnd;
          }

          return isSameMonth(
            date,
            now,
          );
        } catch {
          return true;
        }
      },
    );
  }, [
    transactions,
    periodFilter,
    customStart,
    customEnd,
  ]);

  const metrics = useMemo(() => {
    const activeAccounts =
      accounts.filter(
        (account) => account.is_active,
      );

    const available =
      activeAccounts
        .filter((account) =>
          [
            "checking",
            "savings",
            "cash",
            "wallet",
          ].includes(account.type),
        )
        .reduce(
          (total, account) =>
            total +
            Number(account.balance || 0),
          0,
        );

    const invested =
      activeAccounts
        .filter(
          (account) =>
            account.type ===
            "investment",
        )
        .reduce(
          (total, account) =>
            total +
            Number(account.balance || 0),
          0,
        );

    let income = 0;
    let expense = 0;
    let receivable = 0;
    let payable = 0;
    let overdue = 0;

    periodTransactions.forEach(
      (transaction) => {
        const amount =
          Number(transaction.amount) || 0;

        const effectiveStatus =
          getEffectiveStatus(
            transaction,
          );

        if (
          transaction.status === "paid"
        ) {
          if (transaction.type === "income") {
            income += amount;
          }

          if (
            transaction.type ===
              "expense" ||
            transaction.type ===
              "debt_payment"
          ) {
            expense += amount;
          }
        }

        if (
          effectiveStatus ===
            "planned" ||
          effectiveStatus ===
            "overdue"
        ) {
          if (
            transaction.type === "income"
          ) {
            receivable += amount;
          }

          if (
            transaction.type ===
              "expense" ||
            transaction.type ===
              "debt_payment"
          ) {
            payable += amount;
          }
        }

        if (
          effectiveStatus === "overdue" &&
          (transaction.type === "expense" ||
            transaction.type === "debt_payment")
        ) {
          overdue += amount;
        }
      },
    );

    return {
      available,
      invested,
      income,
      expense,
      receivable,
      payable,
      overdue,
    };
  }, [
    accounts,
    periodTransactions,
  ]);

  const budgetReserve = useMemo(() => {
    const relevantMonths = relevantBudgetMonths(
      periodFilter,
      customStart,
      customEnd,
    );

    if (relevantMonths.size === 0 || budgets.length === 0) {
      return 0;
    }

    const budgetsByCategoryMonth = new Map<string, Budget[]>();
    budgets.forEach((budget) => {
      const key = `${budget.category_id}:${budget.month}`;
      const current = budgetsByCategoryMonth.get(key) ?? [];
      current.push(budget);
      budgetsByCategoryMonth.set(key, current);
    });

    const committedByBudget = new Map<string, number>();

    transactions.forEach((transaction) => {
      if (
        transaction.type !== "expense" ||
        transaction.status === "cancelled" ||
        !transaction.category_id
      ) {
        return;
      }

      const effectiveStatus = getEffectiveStatus(transaction);
      const referenceDate =
        effectiveStatus === "planned" || effectiveStatus === "overdue"
          ? transaction.due_date ?? transaction.occurred_on
          : transaction.paid_at?.slice(0, 10) ?? transaction.occurred_on;
      const month = monthStartKey(referenceDate);

      if (!relevantMonths.has(month)) {
        return;
      }

      let budgetId = transaction.budget_id;
      if (!budgetId) {
        const categoryBudgets =
          budgetsByCategoryMonth.get(`${transaction.category_id}:${month}`) ?? [];
        if (categoryBudgets.length === 1) {
          budgetId = categoryBudgets[0].id;
        }
      }

      if (!budgetId) return;

      committedByBudget.set(
        budgetId,
        (committedByBudget.get(budgetId) ?? 0) + Number(transaction.amount || 0),
      );
    });

    return budgets.reduce((total, budget) => {
      if (!relevantMonths.has(budget.month)) {
        return total;
      }

      const committed = committedByBudget.get(budget.id) ?? 0;
      const remaining = Math.max(Number(budget.amount || 0) - committed, 0);
      return total + remaining;
    }, 0);
  }, [
    budgets,
    transactions,
    periodFilter,
    customStart,
    customEnd,
  ]);

  const annualYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>([currentYear, currentYear + 1]);

    transactions.forEach((transaction) => {
      const referenceDate =
        transaction.status === "planned" || transaction.status === "overdue"
          ? transaction.due_date ?? transaction.occurred_on
          : transaction.paid_at?.slice(0, 10) ?? transaction.occurred_on;

      const year = Number(referenceDate?.slice(0, 4));
      if (Number.isFinite(year) && year > 2000) {
        years.add(year);
      }
    });

    return Array.from(years).sort((a, b) => b - a);
  }, [transactions]);

  const monthlyChartData = useMemo(() => {
    const data = MONTH_NAMES.map((name) => ({
      name,
      Entradas: 0,
      Saídas: 0,
    }));

    transactions.forEach((transaction) => {
      if (transaction.status === "cancelled") {
        return;
      }

      const effectiveStatus = getEffectiveStatus(transaction);
      const referenceDate =
        effectiveStatus === "planned" || effectiveStatus === "overdue"
          ? transaction.due_date ?? transaction.occurred_on
          : transaction.paid_at?.slice(0, 10) ?? transaction.occurred_on;

      try {
        const date = parseISO(referenceDate);

        if (date.getFullYear() !== annualYear) {
          return;
        }

        const amount = Number(transaction.amount) || 0;
        const item = data[date.getMonth()];

        if (
          transaction.type === "income" ||
          transaction.type === "debt_received"
        ) {
          item.Entradas += amount;
        }

        if (
          transaction.type === "expense" ||
          transaction.type === "debt_payment"
        ) {
          item.Saídas += amount;
        }
      } catch {
        return;
      }
    });

    return data;
  }, [transactions, annualYear]);

  const annualTotals = useMemo(() => {
    return monthlyChartData.reduce(
      (totals, month) => {
        totals.income += month.Entradas;
        totals.expense += month.Saídas;
        return totals;
      },
      { income: 0, expense: 0 },
    );
  }, [monthlyChartData]);

  const categoryChartData =
    useMemo(() => {
      const categoryTotals =
        new Map<string, number>();

      periodTransactions.forEach(
        (transaction) => {
          if (
            transaction.type !== "expense" ||
            transaction.status === "cancelled"
          ) {
            return;
          }

          const category =
            transaction.category_id
              ? categoryMap.get(
                  transaction.category_id,
                )
              : null;

          const categoryName =
            category?.group_type === "debt"
              ? "Dívidas"
              : "Despesas";

          categoryTotals.set(
            categoryName,
            (categoryTotals.get(categoryName) ?? 0) +
              Number(transaction.amount || 0),
          );
        },
      );

      return Array.from(
        categoryTotals.entries(),
      )
        .map(([name, value]) => ({
          name,
          value,
        }))
        .sort(
          (a, b) =>
            b.value - a.value,
        );
    }, [
      periodTransactions,
      categoryMap,
    ]);

  const pendingTransactions =
    useMemo(() => {
      return transactions
        .filter((transaction) => {
          const status =
            getEffectiveStatus(
              transaction,
            );

          return (
            status === "planned" ||
            status === "overdue"
          );
        })
        .sort((a, b) => {
          const first =
            a.due_date ??
            a.occurred_on;

          const second =
            b.due_date ??
            b.occurred_on;

          return first.localeCompare(
            second,
          );
        })
        .slice(0, 8);
    }, [transactions]);

  async function markAsPaid(
    transaction: Transaction,
  ) {
    setUpdatingId(transaction.id);
    setError(null);

    const { error: updateError } =
      await supabase
        .from("pf_transactions")
        .update({
          status: "paid",
          paid_at:
            new Date().toISOString(),
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", transaction.id)
        .eq(
          "household_id",
          household.id,
        );

    if (updateError) {
      console.error(
        "Erro ao marcar como realizado:",
        updateError,
      );

      setError(
        updateError.message ||
          "Não foi possível atualizar a movimentação.",
      );

      setUpdatingId(null);
      return;
    }

    setUpdatingId(null);

    await loadDashboard();
  }

  const periods: Array<{
    value: PeriodFilter;
    label: string;
  }> = [
    {
      value: "today",
      label: "Hoje",
    },
    {
      value: "week",
      label: "Semana",
    },
    {
      value: "month",
      label: "Este mês",
    },
    {
      value: "next_month",
      label: "Próximo mês",
    },
    {
      value: "custom",
      label: "Personalizado",
    },
    {
      value: "all",
      label: "Todo período",
    },
  ];

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#C8A15A]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[#0D1B2A]">
              Resumo financeiro
            </h2>
            <p className="mt-1 text-xs text-[#3A3A3C]/55">
              Sua posição atual e os movimentos do período selecionado.
            </p>
          </div>

          <div className="flex max-w-full items-start gap-2">
            <PeriodFilterControl
              periods={periods}
              value={periodFilter}
              onChange={setPeriodFilter}
              customStart={customStart}
              customEnd={customEnd}
              onCustomStartChange={setCustomStart}
              onCustomEndChange={setCustomEnd}
            />
            <button
              type="button"
              onClick={toggleDashboardPrivacy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] text-[#0D1B2A] transition hover:bg-white"
              aria-label={
                dashboardValuesHidden
                  ? "Mostrar dados financeiros"
                  : "Ocultar dados financeiros"
              }
              title={
                dashboardValuesHidden
                  ? "Mostrar valores"
                  : "Ocultar valores"
              }
            >
              {dashboardValuesHidden ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        </div>

        <div className={privateDataClass}>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Disponível"
            value={metrics.available}
            icon={Wallet}
            variant="default"
          />

          <FlowMetricCard
            income={metrics.income}
            expense={metrics.expense}
          />

          <MetricCard
            label="A receber"
            value={metrics.receivable}
            icon={Receipt}
            variant="positive"
          />

          <MetricCard
            label="A pagar"
            value={metrics.payable}
            icon={Clock}
            variant={metrics.overdue > 0 ? "negative" : "warning"}
            detail={
              metrics.overdue > 0
                ? `${formatCurrency(metrics.overdue)} em atraso`
                : undefined
            }
          />

          <CostOfLivingCard />
        </div>

        <div className="my-6 h-px bg-[#0D1B2A]/10" />

        <DebtSummarySection />
        </div>
      </section>

      <div className={[privateDataClass, "space-y-6"].join(" ")}>
      <UpcomingObligations />

      <MonthlyClosingSection
        periodFilter={periodFilter}
        income={metrics.income}
        receivable={metrics.receivable}
        expense={metrics.expense}
        payable={metrics.payable}
        budgetReserve={budgetReserve}
      />

      <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C8A15A]">
              Visão anual
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#0D1B2A]">
              Mês a mês
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#3A3A3C]/55">
              Realizado + previsto. Lançamentos concluídos usam a data real; pendências usam o vencimento ou a data prevista.
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-[#3A3A3C]/65">
            Ano
            <select
              value={annualYear}
              onChange={(event) => setAnnualYear(Number(event.target.value))}
              className="h-10 rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] px-3 text-sm font-semibold text-[#0D1B2A] outline-none"
            >
              {annualYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-50/70 p-4">
            <p className="text-xs text-emerald-700">Entradas do ano</p>
            <p className="mt-1 text-lg font-semibold text-emerald-800">
              {formatCurrency(annualTotals.income)}
            </p>
          </div>
          <div className="rounded-xl bg-red-50/70 p-4">
            <p className="text-xs text-red-700">Gastos e compromissos do ano</p>
            <p className="mt-1 text-lg font-semibold text-red-800">
              {formatCurrency(annualTotals.expense)}
            </p>
          </div>
          <div className="rounded-xl bg-[#F7F5EF] p-4">
            <p className="text-xs text-[#3A3A3C]/60">Diferença projetada do ano</p>
            <p
              className={[
                "mt-1 text-lg font-semibold",
                annualTotals.income - annualTotals.expense >= 0
                  ? "text-emerald-800"
                  : "text-red-800",
              ].join(" ")}
            >
              {annualTotals.income - annualTotals.expense >= 0
                ? `Sobram ${formatCurrency(annualTotals.income - annualTotals.expense)}`
                : `Faltam ${formatCurrency(Math.abs(annualTotals.income - annualTotals.expense))}`}
            </p>
          </div>
        </div>

        <div className="mt-5 h-[300px] min-h-[300px] min-w-0 w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
            <BarChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis
                tickFormatter={(value) => formatCompactCurrency(Number(value))}
                tickLine={false}
                axisLine={false}
                width={54}
                fontSize={10}
              />
              <RechartsTooltip
                formatter={(value, name) => [formatCurrency(Number(value)), String(name)]}
                cursor={{ opacity: 0.08 }}
              />
              <Bar dataKey="Entradas" fill="#047857" radius={[5, 5, 0, 0]} />
              <Bar dataKey="Saídas" fill="#B91C1C" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {monthlyChartData.map((month) => (
            <div key={month.name} className="rounded-xl border border-[#0D1B2A]/8 bg-[#F7F5EF]/60 p-3">
              <p className="text-xs font-semibold text-[#0D1B2A]">{month.name}</p>
              <p className="mt-1 text-[11px] text-emerald-700">
                Entradas: {formatCurrency(month.Entradas)}
              </p>
              <p className="text-[11px] text-red-700">
                A pagar/sair: {formatCurrency(month.Saídas)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <BudgetPlanningSummary
        month={
          periodFilter === "next_month"
            ? getMonthKey(1)
            : periodFilter === "custom" && customStart
              ? customStart.slice(0, 7)
              : getMonthKey()
        }
      />

      <section className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <InvestmentOverview />
        </div>

        <div className="xl:col-span-3">
          <SpendingCategoryChart
            categoryData={categoryChartData}
            periodFilter={periodFilter}
            customStart={customStart}
            customEnd={customEnd}
          />
        </div>
      </section>

      </div>

      {dashboardValuesHidden && (
        <div className="fixed bottom-24 left-1/2 z-[90] -translate-x-1/2 rounded-full border border-[#0D1B2A]/10 bg-[#0D1B2A] px-4 py-2 text-xs font-semibold text-white shadow-xl sm:bottom-6">
          Dados financeiros ocultos
        </div>
      )}
    </div>
  );
}

type PeriodOption = {
  value: PeriodFilter;
  label: string;
};

function PeriodFilterControl({
  periods,
  value,
  onChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: {
  periods: PeriodOption[];
  value: PeriodFilter;
  onChange: (value: PeriodFilter) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (value: string) => void;
  onCustomEndChange: (value: string) => void;
}) {
  const invalidCustomRange =
    value === "custom" &&
    Boolean(customStart) &&
    Boolean(customEnd) &&
    customStart > customEnd;

  return (
    <div className="space-y-2">
      <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] p-1">
        {periods.map((period) => {
          const active = value === period.value;

          return (
            <button
              key={period.value}
              type="button"
              onClick={() => onChange(period.value)}
              className={[
                "shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition sm:px-3.5",
                active
                  ? "bg-[#0D1B2A] text-white shadow-sm"
                  : "text-[#3A3A3C]/60 hover:bg-white hover:text-[#0D1B2A]",
              ].join(" ")}
            >
              {period.label}
            </button>
          );
        })}
      </div>

      {value === "custom" && (
        <div className="rounded-xl border border-[#0D1B2A]/10 bg-white p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#3A3A3C]/55">
                De
              </span>
              <input
                type="date"
                value={customStart}
                onChange={(event) => onCustomStartChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-[#0D1B2A]/12 bg-white px-3 text-xs text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#3A3A3C]/55">
                Até
              </span>
              <input
                type="date"
                value={customEnd}
                onChange={(event) => onCustomEndChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-[#0D1B2A]/12 bg-white px-3 text-xs text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
              />
            </label>
          </div>
          {invalidCustomRange && (
            <p className="mt-2 text-xs text-red-600">
              A data inicial precisa ser anterior ou igual à data final.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FlowMetricCard({
  income,
  expense,
}: {
  income: number;
  expense: number;
}) {
  return (
    <article className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <p className="text-sm text-[#3A3A3C]/65">
        Entradas e saídas
      </p>

      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <ArrowUpCircle size={17} />
            <span className="text-xs font-medium">Entradas</span>
          </div>
          <span className="font-semibold text-emerald-800">
            {formatCurrency(income)}
          </span>
        </div>

        <div className="h-px bg-[#0D1B2A]/8" />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-red-700">
            <ArrowDownCircle size={17} />
            <span className="text-xs font-medium">Saídas</span>
          </div>
          <span className="font-semibold text-red-800">
            {formatCurrency(expense)}
          </span>
        </div>
      </div>
    </article>
  );
}

type MetricCardProps = {
  label: string;
  value: number;
  icon: typeof Wallet;
  variant:
    | "default"
    | "positive"
    | "negative"
    | "warning"
    | "gold";
  detail?: string;
};

function MetricCard({
  label,
  value,
  icon: Icon,
  variant,
  detail,
}: MetricCardProps) {
  const styles = {
    default: {
      icon: "text-[#0D1B2A]",
      value: "text-[#0D1B2A]",
      background: "bg-white",
    },
    positive: {
      icon: "text-emerald-700",
      value: "text-emerald-800",
      background: "bg-white",
    },
    negative: {
      icon: "text-red-700",
      value: "text-red-800",
      background: "bg-white",
    },
    warning: {
      icon: "text-amber-700",
      value: "text-[#0D1B2A]",
      background: "bg-white",
    },
    gold: {
      icon: "text-[#C8A15A]",
      value: "text-[#0D1B2A]",
      background: "bg-white",
    },
  }[variant];

  return (
    <article
      className={[
        "rounded-2xl border border-[#0D1B2A]/10 p-5 shadow-sm",
        styles.background,
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#3A3A3C]/65">
          {label}
        </p>

        <Icon
          size={19}
          className={styles.icon}
        />
      </div>

      <p
        className={[
          "mt-3 text-2xl font-semibold tracking-tight",
          styles.value,
        ].join(" ")}
      >
        {formatCurrency(value)}
      </p>

      {detail && (
        <p className="mt-2 text-xs font-medium text-red-600">
          {detail}
        </p>
      )}
    </article>
  );
}