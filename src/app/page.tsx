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
  SlidersHorizontal,
  Eye,
  EyeOff,
  Loader2,
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
import { rowResult } from "@/lib/control/client";
import { summarizeBalances, summarizePeriod, transactionDay, uncommittedBudget, type DashboardLoan, type DashboardStatement } from "@/lib/dashboard/summary";
import { useHousehold } from "@/contexts/HouseholdContext";
import { SpendingCategoryChart } from "@/components/dashboard/SpendingCategoryChart";
import { BankBalanceOverview } from "@/components/dashboard/BankBalanceOverview";
import { DebtSummarySection } from "@/components/DebtSummarySection";
import { MonthlyClosingSection } from "@/components/MonthlyClosingSection";

import { InvestmentOverview } from "@/components/dashboard/InvestmentOverview";
import { CostOfLivingCard } from "@/components/dashboard/CostOfLivingCard";
import { BudgetPlanningSummary } from "@/components/dashboard/BudgetPlanningSummary";
import { BottomSheet } from "@/components/ui/BottomSheet";

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
  | "adjustment"
  | "loan_given"
  | "loan_repayment";

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
  available_credit: number | string | null;
  is_active: boolean;
  account_scope: "personal" | "business";
  reconciliation_required: boolean;
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
  financial_scope: "personal" | "business";
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  merchant: string | null;
  amount: number | string;
  occurred_on: string;
  due_date: string | null;
  paid_at: string | null;
  card_statement_id: string | null;
  card_forecast: boolean;
  recurrence_key: string | null;
  metadata: Record<string, unknown>;
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

  const [loans, setLoans] = useState<DashboardLoan[]>([]);
  const [statements, setStatements] = useState<DashboardStatement[]>([]);

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
    const task=setTimeout(()=>{try{setDashboardValuesHidden(window.localStorage.getItem(storageKey) === "true");}catch{/* Privacy toggle remains available. */}},0);
    return()=>clearTimeout(task);
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
        loansResult,
        statementsResult,
      ] = await Promise.all([
        supabase
          .from("pf_accounts")
          .select(
            "id, household_id, name, institution_name, type, balance, available_credit, is_active, account_scope, reconciliation_required",
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

        rowResult<Transaction>("pf_transactions", household.id,
          "id, household_id, account_id, destination_account_id, category_id, budget_id, type, status, description, merchant, amount, occurred_on, due_date, paid_at, financial_scope, card_statement_id, card_forecast, recurrence_key, metadata"),

        supabase
          .from("pf_budgets")
          .select("id, category_id, month, amount")
          .eq("household_id", household.id),
        rowResult<DashboardLoan>("pf_personal_loan_positions", household.id,
          "id, borrower, remaining_amount, due_date, cancelled_at"),
        rowResult<DashboardStatement>("pf_card_statement_positions", household.id,
          "id, due_date, remaining_amount"),
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

      if (loansResult.error || statementsResult.error) {
        setError(loansResult.error?.message || statementsResult.error?.message || "Não foi possível carregar os valores pendentes.");
        setLoading(false);
        return;
      }
      setLoans(loansResult.data ?? []);
      setStatements(statementsResult.data ?? []);
      setAccounts(
        (accountsResult.data ??
          []) as Account[],
      );

      setCategories(
        (categoriesResult.data ??
          []) as Category[],
      );

      setTransactions(
        (transactionsResult.data ?? []) as Transaction[],
      );

      setBudgets(
        (budgetsResult.data ?? []) as Budget[],
      );

      setLoading(false);
    },
    [household.id, annualYear],
  );

  useEffect(() => {
    const task=setTimeout(()=>void loadDashboard(),0);
    const refresh = () => { void loadDashboard(); };
    const onStorage = (event: StorageEvent) => { if (event.key === "pf:financial-data-version") refresh(); };
    window.addEventListener("pf:financial-data-changed", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      clearTimeout(task);
      window.removeEventListener("pf:financial-data-changed", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
    };
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

          const referenceDate = transactionDay(transaction);

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

  const balances = useMemo(() => summarizeBalances(accounts), [accounts]);
  const selectedRange = useMemo(() => {
    const today = getToday();
    if (periodFilter === "all") return { start: null, end: null };
    if (periodFilter === "custom") return { start: customStart || "9999-12-31", end: customEnd || "0001-01-01" };
    if (periodFilter === "today") return { start: today, end: today };
    if (periodFilter === "week") {
      const start = new Date(`${today}T12:00:00`);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start); end.setDate(end.getDate() + 6);
      return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
    }
    const month = getMonthKey(periodFilter === "next_month" ? 1 : 0);
    const end = new Date(`${month}-01T12:00:00`);
    end.setMonth(end.getMonth() + 1, 0);
    return { start: `${month}-01`, end: format(end, "yyyy-MM-dd") };
  }, [periodFilter, customStart, customEnd]);

  const metrics = useMemo(() => summarizePeriod(
    transactions, statements, loans, selectedRange, getToday(),
  ), [transactions, statements, loans, selectedRange]);

  const budgetReserve = useMemo(() => uncommittedBudget(
    budgets, transactions, relevantBudgetMonths(periodFilter, customStart, customEnd),
  ), [budgets, transactions, periodFilter, customStart, customEnd]);

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

  const monthlyChartData = useMemo(() => MONTH_NAMES.map((name, index) => {
    const month = `${annualYear}-${String(index + 1).padStart(2, "0")}`;
    const end = new Date(annualYear, index + 1, 0, 12);
    const totals = summarizePeriod(transactions, statements, loans,
      { start: `${month}-01`, end: format(end, "yyyy-MM-dd") }, getToday());
    return { name, Entradas: totals.income + totals.receivableInPeriod, Saídas: totals.expense + totals.payable };
  }), [transactions, statements, loans, annualYear]);

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
            category?.name?.trim() ||
            (category?.group_type === "debt"
              ? "Dívidas"
              : "Sem categoria");

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
        <div className="mt-4 space-y-4">
          <BankBalanceOverview
            balances={balances}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <FlowMetricCard
              income={metrics.income}
              expense={metrics.expense}
            />

            <MetricCard
              label="A receber"
              value={metrics.receivable}
              detail={`Total pendente. ${formatCurrency(metrics.receivableInPeriod)} com previsão no período selecionado.`}
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
        </div>

        <div className="my-6 h-px bg-[#0D1B2A]/10" />

        <DebtSummarySection />
        </div>
      </section>

      <div className={[privateDataClass, "space-y-6"].join(" ")}>


      <MonthlyClosingSection
        periodFilter={periodFilter}
        income={metrics.income}
        receivable={metrics.receivableInPeriod}
        expense={metrics.expense}
        payable={metrics.payable}
        budgetReserve={budgetReserve}
      />

      <section className="space-y-6">
        <SpendingCategoryChart
          categoryData={categoryChartData}
          periodFilter={periodFilter}
          customStart={customStart}
          customEnd={customEnd}
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
                ? `Diferença: ${formatCurrency(annualTotals.income - annualTotals.expense)}`
                : `Diferença: -${formatCurrency(Math.abs(annualTotals.income - annualTotals.expense))}`}
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
                Saídas e pendências: {formatCurrency(month.Saídas)}
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

      <InvestmentOverview />
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
  const [open, setOpen] = useState(false);
  const invalidCustomRange =
    value === "custom" &&
    Boolean(customStart) &&
    Boolean(customEnd) &&
    customStart > customEnd;
  const selected = periods.find((period) => period.value === value)?.label ?? "Período";

  const customInputs = (
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#3A3A3C]/55">De</span>
        <input
          type="date"
          value={customStart}
          onChange={(event) => onCustomStartChange(event.target.value)}
          className="h-11 w-full rounded-xl border border-[#0D1B2A]/12 bg-white px-3 text-xs text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
        />
      </label>
      <label className="space-y-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#3A3A3C]/55">Até</span>
        <input
          type="date"
          value={customEnd}
          onChange={(event) => onCustomEndChange(event.target.value)}
          className="h-11 w-full rounded-xl border border-[#0D1B2A]/12 bg-white px-3 text-xs text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
        />
      </label>
      {invalidCustomRange && (
        <p className="col-span-2 text-xs text-red-600">
          A data inicial precisa ser anterior ou igual à data final.
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] px-3 text-xs font-semibold text-[#0D1B2A] sm:hidden"
      >
        <SlidersHorizontal size={15} />
        {selected}
      </button>

      <div className="hidden max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] p-1 sm:flex app-scrollbar-none">
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

      {value === "custom" && <div className="hidden sm:block">{customInputs}</div>}

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Período do painel"
        footer={
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="app-primary-button w-full px-4"
          >
            Aplicar período
          </button>
        }
      >
        <div className="space-y-2">
          {periods.map((period) => {
            const active = value === period.value;
            return (
              <button
                key={period.value}
                type="button"
                onClick={() => onChange(period.value)}
                className={[
                  "flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 text-left text-sm font-semibold",
                  active
                    ? "border-[#0D1B2A] bg-[#0D1B2A] text-white"
                    : "border-[#0D1B2A]/8 bg-white text-[#0D1B2A]",
                ].join(" ")}
              >
                {period.label}
                {active && <CheckCircle2 size={17} />}
              </button>
            );
          })}

          {value === "custom" && <div className="pt-3">{customInputs}</div>}
        </div>
      </BottomSheet>
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
