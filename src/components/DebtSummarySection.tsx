"use client";

import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  CreditCard,
  HandCoins,
  Loader2,
  TrendingUp,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type DebtPositionRow = {
  id: string;
  debt_group: "personal" | "other";
  type: string;
  original_amount: number | string;
  installment_amount: number | string | null;
  status: string;
  accrued_interest: number | string;
  projected_penalty: number | string;
  projected_late_interest: number | string;
  projected_balance: number | string;
  daily_growth: number | string;
};

type DebtProgressRow = {
  id: string;
  paid_amount: number | string;
  remaining_installments: number | null;
  status: string;
};

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function DebtSummarySection() {
  const { household } = useHousehold();
  const [positions, setPositions] = useState<DebtPositionRow[]>([]);
  const [progressRows, setProgressRows] = useState<DebtProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadDebts = useCallback(async () => {
    setLoading(true);
    setError(false);

    const [positionsResult, progressResult] = await Promise.all([
      supabase
        .from("pf_debt_positions")
        .select(
          "id, debt_group, type, original_amount, installment_amount, status, accrued_interest, projected_penalty, projected_late_interest, projected_balance, daily_growth",
        )
        .eq("household_id", household.id)
        .neq("status", "cancelled"),
      supabase
        .from("pf_debt_progress")
        .select("id, paid_amount, remaining_installments, status")
        .eq("household_id", household.id)
        .neq("status", "cancelled"),
    ]);

    const firstError = positionsResult.error ?? progressResult.error;

    if (firstError) {
      console.error("Erro ao carregar resumo das dívidas:", firstError);
      setError(true);
      setLoading(false);
      return;
    }

    setPositions((positionsResult.data ?? []) as DebtPositionRow[]);
    setProgressRows((progressResult.data ?? []) as DebtProgressRow[]);
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadDebts();
  }, [loadDebts]);

  const summary = useMemo(() => {
    const activePositions = positions.filter(
      (debt) => debt.status !== "paid" && toNumber(debt.projected_balance) > 0.005,
    );

    const total = activePositions.reduce(
      (sum, debt) => sum + toNumber(debt.projected_balance),
      0,
    );

    const personal = activePositions
      .filter((debt) => debt.debt_group === "personal")
      .reduce((sum, debt) => sum + toNumber(debt.projected_balance), 0);

    const other = activePositions
      .filter((debt) => debt.debt_group === "other")
      .reduce((sum, debt) => sum + toNumber(debt.projected_balance), 0);

    const creditCards = activePositions
      .filter((debt) => debt.type === "credit_card")
      .reduce((sum, debt) => sum + toNumber(debt.projected_balance), 0);

    const interestAndCharges = activePositions.reduce(
      (sum, debt) =>
        sum +
        toNumber(debt.accrued_interest) +
        toNumber(debt.projected_penalty) +
        toNumber(debt.projected_late_interest),
      0,
    );

    const dailyGrowth = activePositions.reduce(
      (sum, debt) => sum + toNumber(debt.daily_growth),
      0,
    );

    const monthly = activePositions.reduce(
      (sum, debt) => sum + toNumber(debt.installment_amount),
      0,
    );

    const paid = progressRows.reduce(
      (sum, debt) => sum + toNumber(debt.paid_amount),
      0,
    );

    const original = positions.reduce(
      (sum, debt) => sum + toNumber(debt.original_amount),
      0,
    );

    const remainingInstallments = progressRows.reduce(
      (sum, debt) => sum + Number(debt.remaining_installments ?? 0),
      0,
    );

    const progress = original > 0 ? Math.min(100, (paid / original) * 100) : 0;

    return {
      total,
      personal,
      other,
      creditCards,
      interestAndCharges,
      dailyGrowth,
      monthly,
      paid,
      remainingInstallments,
      progress,
    };
  }, [positions, progressRows]);

  if (loading) {
    return (
      <section className="flex min-h-32 items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-[#C8A15A]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        Não foi possível carregar o resumo das dívidas agora.
      </section>
    );
  }

  if (positions.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#0D1B2A]">
            Resumo das dívidas
          </h2>
          <p className="mt-1 text-sm text-[#3A3A3C]/60">
            Posição consolidada, juros e ritmo atual do endividamento.
          </p>
        </div>

        <Link
          href="/dividas"
          className="text-sm font-semibold text-[#0D1B2A] hover:underline"
        >
          Ver todas
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <DashboardDebtCard
          label="Total atualizado"
          value={formatCurrency(summary.total)}
          icon={HandCoins}
          negative={summary.total > 0}
        />

        <DashboardDebtCard
          label="Dívidas pessoais"
          value={formatCurrency(summary.personal)}
          icon={UsersRound}
        />

        <DashboardDebtCard
          label="Outras dívidas"
          value={formatCurrency(summary.other)}
          detail={
            summary.creditCards > 0
              ? `Cartões: ${formatCurrency(summary.creditCards)}`
              : "Sem fatura de cartão mapeada"
          }
          icon={CreditCard}
        />

        <DashboardDebtCard
          label="Juros e encargos"
          value={formatCurrency(summary.interestAndCharges)}
          detail={
            summary.dailyGrowth > 0
              ? `+${formatCurrency(summary.dailyGrowth)}/dia`
              : "Sem crescimento diário calculado"
          }
          icon={TrendingUp}
          negative={summary.interestAndCharges > 0 || summary.dailyGrowth > 0}
        />

        <DashboardDebtCard
          label="Compromisso mensal"
          value={formatCurrency(summary.monthly)}
          detail={`${summary.remainingInstallments} parcelas restantes`}
          icon={CalendarClock}
        />

        <DashboardDebtCard
          label="Já pago"
          value={formatCurrency(summary.paid)}
          detail={`${summary.progress.toFixed(1)}% do valor original`}
          icon={CheckCircle2}
          positive
        />
      </div>

      <div className="mt-5 flex items-center gap-3">
        <WalletCards size={15} className="shrink-0 text-[#C8A15A]" />
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#0D1B2A]/8">
          <div
            className="h-full rounded-full bg-emerald-600"
            style={{ width: `${Math.min(100, Math.max(0, summary.progress))}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-[#3A3A3C]/60">
          {summary.progress.toFixed(1)}%
        </span>
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#3A3A3C]/60">{label}</p>
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
        <p className="mt-1 text-[11px] leading-4 text-[#3A3A3C]/55">
          {detail}
        </p>
      )}
    </article>
  );
}
