"use client";

import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  HandCoins,
  Loader2,
  TrendingDown,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type DebtSummaryRow = {
  original_amount: number | string;
  current_balance: number | string;
  installment_amount: number | string | null;
  paid_amount: number | string;
  remaining_installments: number | null;
  status: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function DebtSummarySection() {
  const { household } = useHousehold();

  const [debts, setDebts] = useState<
    DebtSummaryRow[]
  >([]);

  const [loading, setLoading] =
    useState(true);

  const loadDebts = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("pf_debt_progress")
      .select(
        "original_amount, current_balance, installment_amount, paid_amount, remaining_installments, status",
      )
      .eq("household_id", household.id)
      .neq("status", "cancelled");

    if (error) {
      console.error(
        "Erro ao carregar resumo das dívidas:",
        error,
      );

      setLoading(false);
      return;
    }

    setDebts((data ?? []) as DebtSummaryRow[]);
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadDebts();
  }, [loadDebts]);

  const summary = useMemo(() => {
    const original = debts.reduce(
      (total, debt) =>
        total +
        Number(debt.original_amount || 0),
      0,
    );

    const paid = debts.reduce(
      (total, debt) =>
        total + Number(debt.paid_amount || 0),
      0,
    );

    const remaining = debts.reduce(
      (total, debt) =>
        total +
        Number(debt.current_balance || 0),
      0,
    );

    const monthly = debts
      .filter((debt) => debt.status !== "paid")
      .reduce(
        (total, debt) =>
          total +
          Number(debt.installment_amount || 0),
        0,
      );

    const remainingInstallments =
      debts.reduce(
        (total, debt) =>
          total +
          Number(debt.remaining_installments || 0),
        0,
      );

    const progress =
      original > 0
        ? (paid / original) * 100
        : 0;

    return {
      original,
      paid,
      remaining,
      monthly,
      remainingInstallments,
      progress,
    };
  }, [debts]);

  if (loading) {
    return (
      <section className="flex min-h-32 items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-[#C8A15A]" />
      </section>
    );
  }

  if (debts.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#0D1B2A]">
            Resumo das dívidas
          </h2>

          <p className="mt-1 text-sm text-[#3A3A3C]/60">
            Evolução dos empréstimos pessoais.
          </p>
        </div>

        <Link
          href="/dividas"
          className="text-sm font-semibold text-[#0D1B2A] hover:underline"
        >
          Ver todas
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardDebtCard
          label="Valor total"
          value={formatCurrency(summary.original)}
          icon={HandCoins}
        />

        <DashboardDebtCard
          label="Já pago"
          value={formatCurrency(summary.paid)}
          icon={CheckCircle2}
          positive
        />

        <DashboardDebtCard
          label="Falta pagar"
          value={formatCurrency(summary.remaining)}
          icon={TrendingDown}
          negative
        />

        <DashboardDebtCard
          label="Valor da mensalidade"
          value={formatCurrency(summary.monthly)}
          icon={CalendarClock}
        />

        <DashboardDebtCard
          label="Progresso"
          value={`${summary.progress.toFixed(1)}%`}
          detail={`${summary.remainingInstallments} parcelas restantes`}
          icon={CheckCircle2}
        />
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#0D1B2A]/8">
        <div
          className="h-full rounded-full bg-emerald-600"
          style={{
            width: `${Math.min(
              100,
              Math.max(0, summary.progress),
            )}%`,
          }}
        />
      </div>
    </section>
  );
}

function DashboardDebtCard({
  label,
  value,
  detail,
  icon: Icon,
  positive,
  negative,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: typeof HandCoins;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <article className="rounded-xl bg-[#F7F5EF] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#3A3A3C]/60">
          {label}
        </p>

        <Icon
          size={16}
          className={
            positive
              ? "text-emerald-700"
              : negative
                ? "text-red-700"
                : "text-[#C8A15A]"
          }
        />
      </div>

      <p
        className={[
          "mt-2 text-lg font-semibold",
          positive
            ? "text-emerald-800"
            : negative
              ? "text-red-800"
              : "text-[#0D1B2A]",
        ].join(" ")}
      >
        {value}
      </p>

      {detail && (
        <p className="mt-1 text-[11px] text-[#3A3A3C]/55">
          {detail}
        </p>
      )}
    </article>
  );
}