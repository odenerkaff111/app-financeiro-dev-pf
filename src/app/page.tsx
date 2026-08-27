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

type PeriodFilter =
  | "today"
  | "week"
  | "month"
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
  account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  merchant: string | null;
  amount: number | string;
  occurred_on: string;
  due_date: string | null;
  paid_at: string | null;
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

  const [periodFilter, setPeriodFilter] =
    useState<PeriodFilter>("month");

  const [loading, setLoading] =
    useState(true);

  const [updatingId, setUpdatingId] =
    useState<string | null>(null);

  const [error, setError] = useState<
    string | null
  >(null);

  const loadDashboard = useCallback(
    async () => {
      setLoading(true);
      setError(null);

      const [
        accountsResult,
        categoriesResult,
        transactionsResult,
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
            "id, household_id, account_id, destination_account_id, category_id, type, status, description, merchant, amount, occurred_on, due_date, paid_at",
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

      setLoading(false);
    },
    [household.id],
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
              : transaction.occurred_on;

          const date = parseISO(referenceDate);

          if (periodFilter === "today") {
            return isToday(date);
          }

          if (periodFilter === "week") {
            return isSameWeek(
              date,
              now,
              {
                weekStartsOn: 1,
              },
            );
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
          effectiveStatus ===
          "overdue"
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

  const monthlyChartData =
    useMemo(() => {
      const currentYear =
        new Date().getFullYear();

      const data = MONTH_NAMES.map(
        (name) => ({
          name,
          Entradas: 0,
          Saídas: 0,
        }),
      );

      transactions.forEach(
        (transaction) => {
          if (
            transaction.status !== "paid"
          ) {
            return;
          }

          try {
            const date = parseISO(
              transaction.occurred_on,
            );

            if (
              date.getFullYear() !==
              currentYear
            ) {
              return;
            }

            const amount =
              Number(transaction.amount) ||
              0;

            const item =
              data[date.getMonth()];

            if (
              transaction.type ===
                "income" ||
              transaction.type ===
                "debt_received"
            ) {
              item.Entradas += amount;
            }

            if (
              transaction.type ===
                "expense" ||
              transaction.type ===
                "debt_payment"
            ) {
              item.Saídas += amount;
            }
          } catch {
            return;
          }
        },
      );

      return data;
    }, [transactions]);

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
            category?.name ??
            "Sem categoria";

          categoryTotals.set(
            categoryName,
            (categoryTotals.get(
              categoryName,
            ) ?? 0) +
              Number(
                transaction.amount || 0,
              ),
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

          <PeriodFilterControl
            periods={periods}
            value={periodFilter}
            onChange={setPeriodFilter}
          />
        </div>

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
      </section>

      <MonthlyClosingSection />

      <section className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <InvestmentOverview />
        </div>

        <SpendingCategoryChart
          categoryData={categoryChartData}
          periodFilter={periodFilter}
        />
      </section>

      <UpcomingObligations />
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
}: {
  periods: PeriodOption[];
  value: PeriodFilter;
  onChange: (value: PeriodFilter) => void;
}) {
  return (
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