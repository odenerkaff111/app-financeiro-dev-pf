"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  HandCoins,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { supabase } from "@/lib/supabase";
import {
  formatCurrency,
  formatDate,
  getDebtKindLabel,
  getInterestMethodLabel,
  getInterestPeriodLabel,
  toNumber,
  type DebtPosition,
} from "@/lib/financial-engine";

export function OtherDebtsPanel() {
  const { household } = useHousehold();
  const [debts, setDebts] = useState<DebtPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await supabase
      .from("pf_debt_positions")
      .select("*")
      .eq("household_id", household.id)
      .eq("debt_group", "other")
      .neq("status", "cancelled")
      .order("projected_balance", { ascending: false });

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    setDebts((result.data ?? []) as DebtPosition[]);
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const summary = useMemo(
    () =>
      debts.reduce(
        (total, debt) => ({
          balance: total.balance + toNumber(debt.projected_balance),
          dailyGrowth: total.dailyGrowth + toNumber(debt.daily_growth),
          overdue: total.overdue + (debt.overdue_days > 0 ? 1 : 0),
        }),
        { balance: 0, dailyGrowth: 0, overdue: 0 },
      ),
    [debts],
  );

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
            Acompanhamento
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
            Outras dívidas
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/65">
            Consulte saldo atualizado, juros e velocidade de crescimento. Novos registros são feitos em Movimentações ou pelo Assistente.
          </p>
        </div>

        <Link
          href="/registros"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-5 text-sm font-semibold text-white"
        >
          Novo registro
          <ArrowRight size={16} />
        </Link>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard label="Saldo atualizado" value={formatCurrency(summary.balance)} icon={HandCoins} />
        <SummaryCard label="Crescimento por dia" value={formatCurrency(summary.dailyGrowth)} icon={TrendingUp} />
        <SummaryCard label="Dívidas atrasadas" value={String(summary.overdue)} icon={AlertTriangle} />
      </section>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
        </div>
      ) : debts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#0D1B2A]/15 bg-white/70 p-10 text-center">
          <HandCoins className="mx-auto text-[#C8A15A]" size={36} />
          <h2 className="mt-4 text-lg font-semibold">Nenhuma outra dívida cadastrada</h2>
          <p className="mt-2 text-sm text-[#3A3A3C]/55">
            Registre pela tela de Movimentações. Esta página será atualizada automaticamente.
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          {debts.map((debt) => (
            <article
              key={debt.id}
              className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-[#0D1B2A]">
                      {debt.creditor}
                    </h2>
                    <span className="rounded-full bg-[#F7F5EF] px-2.5 py-1 text-[11px] font-semibold text-[#0D1B2A]">
                      {getDebtKindLabel(debt.debt_kind)}
                    </span>
                    {debt.overdue_days > 0 && (
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                        {debt.overdue_days} dias em atraso
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[#3A3A3C]/55">
                    {debt.description || "Sem descrição"}
                  </p>
                </div>

                <div className="text-left lg:text-right">
                  <p className="text-xs uppercase tracking-wider text-[#3A3A3C]/45">
                    Saldo atualizado
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-red-800">
                    {formatCurrency(debt.projected_balance)}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                <Metric label="Principal" value={formatCurrency(debt.ledger_balance)} />
                <Metric label="Juros acumulados" value={formatCurrency(debt.accrued_interest)} />
                <Metric label="Multa projetada" value={formatCurrency(debt.projected_penalty)} />
                <Metric label="Juros de atraso" value={formatCurrency(debt.projected_late_interest)} />
                <Metric label="Cresce por dia" value={formatCurrency(debt.daily_growth)} />
                <Metric label="Vencimento" value={formatDate(debt.due_date)} />
              </div>

              {debt.interest_enabled && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <Clock3 size={15} />
                  {getInterestMethodLabel(debt.interest_method)}, {Number(debt.interest_rate)}% {getInterestPeriodLabel(debt.interest_period)}.
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

type IconType = typeof HandCoins;

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: IconType }) {
  return (
    <article className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#3A3A3C]/55">{label}</p>
        <Icon size={17} className="text-[#C8A15A]" />
      </div>
      <p className="mt-3 text-xl font-semibold text-[#0D1B2A]">{value}</p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#F7F5EF] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[#0D1B2A]">{value}</p>
    </div>
  );
}
