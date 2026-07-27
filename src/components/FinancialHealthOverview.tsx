"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  TrendingUp,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { supabase } from "@/lib/supabase";
import {
  formatCurrency,
  toNumber,
  type CommitmentProgress,
  type DebtPosition,
} from "@/lib/financial-engine";

type Account = {
  id: string;
  type: string;
  balance: number | string;
  is_active: boolean;
};

type AlertItem = {
  id: string;
  level: "critical" | "warning" | "positive";
  title: string;
  description: string;
};

export function FinancialHealthOverview() {
  const { household } = useHousehold();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [debts, setDebts] = useState<DebtPosition[]>([]);
  const [commitments, setCommitments] = useState<CommitmentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [accountsResult, debtsResult, commitmentsResult] =
      await Promise.all([
        supabase
          .from("pf_accounts")
          .select("id, type, balance, is_active")
          .eq("household_id", household.id)
          .eq("is_active", true),
        supabase
          .from("pf_debt_positions")
          .select("*")
          .eq("household_id", household.id)
          .neq("status", "cancelled")
          .gt("projected_balance", 0)
          .order("projected_balance", { ascending: false }),
        supabase
          .from("pf_commitment_progress")
          .select("*")
          .eq("household_id", household.id)
          .in("computed_status", ["pending", "partial", "overdue"])
          .order("due_date", { ascending: true, nullsFirst: false }),
      ]);

    const firstError =
      accountsResult.error ??
      debtsResult.error ??
      commitmentsResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setAccounts((accountsResult.data ?? []) as Account[]);
    setDebts((debtsResult.data ?? []) as DebtPosition[]);
    setCommitments(
      (commitmentsResult.data ?? []) as CommitmentProgress[],
    );
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const snapshot = useMemo(() => {
    const available = accounts
      .filter((account) =>
        ["checking", "savings", "cash", "wallet"].includes(
          account.type,
        ),
      )
      .reduce(
        (total, account) => total + toNumber(account.balance),
        0,
      );

    const creditCardBalance = accounts
      .filter((account) => account.type === "credit_card")
      .reduce(
        (total, account) => total + toNumber(account.balance),
        0,
      );

    const personalDebt = debts
      .filter((debt) => debt.debt_group === "personal")
      .reduce(
        (total, debt) => total + toNumber(debt.projected_balance),
        0,
      );

    const otherDebt = debts
      .filter((debt) => debt.debt_group === "other")
      .reduce(
        (total, debt) => total + toNumber(debt.projected_balance),
        0,
      );

    const dailyGrowth = debts.reduce(
      (total, debt) => total + toNumber(debt.daily_growth),
      0,
    );

    const projectedCharges = debts.reduce(
      (total, debt) =>
        total +
        toNumber(debt.accrued_interest) +
        toNumber(debt.projected_penalty) +
        toNumber(debt.projected_late_interest),
      0,
    );

    const payable = commitments
      .filter((item) => item.direction === "payable")
      .reduce(
        (total, item) => total + toNumber(item.remaining_amount),
        0,
      );

    const receivable = commitments
      .filter((item) => item.direction === "receivable")
      .reduce(
        (total, item) => total + toNumber(item.remaining_amount),
        0,
      );

    const overduePayable = commitments
      .filter(
        (item) =>
          item.direction === "payable" &&
          item.computed_status === "overdue",
      )
      .reduce(
        (total, item) => total + toNumber(item.remaining_amount),
        0,
      );

    const overdueReceivable = commitments
      .filter(
        (item) =>
          item.direction === "receivable" &&
          item.computed_status === "overdue",
      )
      .reduce(
        (total, item) => total + toNumber(item.remaining_amount),
        0,
      );

    const projectedCash = available + receivable - payable;

    return {
      available,
      creditCardBalance,
      personalDebt,
      otherDebt,
      dailyGrowth,
      projectedCharges,
      payable,
      receivable,
      overduePayable,
      overdueReceivable,
      projectedCash,
    };
  }, [accounts, commitments, debts]);

  const alerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];

    if (snapshot.overduePayable > 0) {
      items.push({
        id: "overdue-payable",
        level: "critical",
        title: "Existem contas vencidas",
        description: `${formatCurrency(snapshot.overduePayable)} ainda precisam ser pagos em compromissos vencidos.`,
      });
    }

    if (snapshot.dailyGrowth > 0) {
      items.push({
        id: "daily-growth",
        level: "critical",
        title: "Suas dívidas estão crescendo",
        description: `O saldo aumenta aproximadamente ${formatCurrency(snapshot.dailyGrowth)} por dia enquanto as condições atuais continuarem.`,
      });
    }

    if (snapshot.projectedCash < 0) {
      items.push({
        id: "negative-projection",
        level: "warning",
        title: "As pendências superam os recursos mapeados",
        description: `Mesmo considerando ${formatCurrency(snapshot.receivable)} a receber, faltariam ${formatCurrency(Math.abs(snapshot.projectedCash))} para cobrir as contas abertas.`,
      });
    }

    if (snapshot.projectedCharges > 0) {
      items.push({
        id: "charges",
        level: "warning",
        title: "Há juros e encargos projetados",
        description: `${formatCurrency(snapshot.projectedCharges)} do saldo atual correspondem a juros, multa ou atraso projetados.`,
      });
    }

    if (snapshot.overdueReceivable > 0) {
      items.push({
        id: "overdue-receivable",
        level: "warning",
        title: "Há valores a receber vencidos",
        description: `${formatCurrency(snapshot.overdueReceivable)} estão atrasados e ainda não entraram nas contas.`,
      });
    }

    if (items.length === 0) {
      items.push({
        id: "healthy",
        level: "positive",
        title: "Nenhum alerta financeiro crítico",
        description:
          "Com os dados cadastrados até agora, não há contas vencidas, crescimento diário de dívida ou déficit projetado.",
      });
    }

    return items.slice(0, 4);
  }, [snapshot]);

  const growingDebts = useMemo(
    () =>
      debts
        .filter((debt) => toNumber(debt.daily_growth) > 0)
        .sort(
          (first, second) =>
            toNumber(second.daily_growth) -
            toNumber(first.daily_growth),
        )
        .slice(0, 3),
    [debts],
  );

  if (loading) {
    return (
      <section className="flex min-h-28 items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white/80">
        <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        Não foi possível carregar a visão financeira consolidada: {error}
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="flex h-full flex-col rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle size={19} className="text-[#C8A15A]" />
          <h3 className="font-semibold text-[#0D1B2A]">
            Alertas objetivos
          </h3>
        </div>

        <div className="mt-4 flex-1 space-y-3">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      </div>

      <div className="flex h-full flex-col rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <TrendingUp size={19} className="text-[#C8A15A]" />
          <h3 className="font-semibold text-[#0D1B2A]">
            Leitura rápida
          </h3>
        </div>

        <div className="mt-4 space-y-2 text-sm">
          <SummaryRow
            label="Dívidas pessoais"
            value={formatCurrency(snapshot.personalDebt)}
          />
          <SummaryRow
            label="Outras dívidas"
            value={formatCurrency(snapshot.otherDebt)}
          />
          <SummaryRow
            label="Faturas de cartão"
            value={formatCurrency(snapshot.creditCardBalance)}
          />
          <SummaryRow
            label="Saldo após pendências"
            value={formatCurrency(snapshot.projectedCash)}
            emphasized
          />
        </div>

        {growingDebts.length > 0 && (
          <div className="mt-4 border-t border-[#0D1B2A]/8 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/50">
              Maiores crescimentos diários
            </p>
            <div className="mt-3 space-y-2">
              {growingDebts.map((debt) => (
                <div
                  key={debt.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate text-[#0D1B2A]">
                    {debt.creditor}
                  </span>
                  <span className="shrink-0 font-semibold text-red-700">
                    +{formatCurrency(debt.daily_growth)}/dia
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function AlertRow({ alert }: { alert: AlertItem }) {
  const Icon =
    alert.level === "positive"
      ? CheckCircle2
      : alert.level === "critical"
        ? AlertTriangle
        : Clock3;

  const classes =
    alert.level === "positive"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : alert.level === "critical"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <div className={`rounded-xl border p-3.5 ${classes}`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">{alert.title}</p>
          <p className="mt-1 text-xs leading-5 opacity-80">
            {alert.description}
          </p>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center justify-between gap-4 rounded-xl px-3 py-2.5",
        emphasized ? "bg-[#0D1B2A] text-white" : "bg-[#F7F5EF]",
      ].join(" ")}
    >
      <span className={emphasized ? "text-white/70" : "text-[#3A3A3C]/60"}>
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
