"use client";

import Link from "next/link";
import { Loader2, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { supabase } from "@/lib/supabase";

type Budget = {
  id: string;
  category_id: string;
  amount: number | string;
};

type PaidExpense = {
  category_id: string | null;
  budget_id: string | null;
  amount: number | string;
  occurred_on: string;
};

type Props = {
  month: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

export function BudgetPlanningSummary({ month }: Props) {
  const { household } = useHousehold();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<PaidExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    setError(null);

    const [budgetResult, transactionResult] = await Promise.all([
      supabase
        .from("pf_budgets")
        .select("id, category_id, amount")
        .eq("household_id", household.id)
        .eq("month", `${month}-01`),
      supabase
        .from("pf_transactions")
        .select("category_id, budget_id, amount, occurred_on")
        .eq("household_id", household.id)
        .eq("type", "expense")
        .eq("status", "paid")
        .gte("occurred_on", `${month}-01`)
        .lt(
          "occurred_on",
          (() => {
            const [year, monthNumber] = month.split("-").map(Number);
            const next = new Date(year, monthNumber, 1);
            return [
              next.getFullYear(),
              String(next.getMonth() + 1).padStart(2, "0"),
              "01",
            ].join("-");
          })(),
        ),
    ]);

    const firstError = budgetResult.error ?? transactionResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setBudgets((budgetResult.data ?? []) as Budget[]);
    setTransactions((transactionResult.data ?? []) as PaidExpense[]);
    setLoading(false);
  }, [household.id, month]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load();
    }, 0);

    const handleChange = () => void load();
    window.addEventListener("pf:financial-data-changed", handleChange);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("pf:financial-data-changed", handleChange);
    };
  }, [load]);

  const summary = useMemo(() => {
    const budgetsByCategory = new Map<string, Budget[]>();
    budgets.forEach((budget) => {
      const current = budgetsByCategory.get(budget.category_id) ?? [];
      current.push(budget);
      budgetsByCategory.set(budget.category_id, current);
    });

    const usedByBudget = new Map<string, number>();
    transactions.forEach((transaction) => {
      if (!transaction.category_id) return;

      let budgetId = transaction.budget_id;
      if (!budgetId) {
        const categoryBudgets = budgetsByCategory.get(transaction.category_id) ?? [];
        if (categoryBudgets.length === 1) {
          budgetId = categoryBudgets[0].id;
        }
      }

      if (!budgetId) return;
      usedByBudget.set(
        budgetId,
        (usedByBudget.get(budgetId) ?? 0) + Number(transaction.amount || 0),
      );
    });

    const planned = budgets.reduce((total, budget) => total + Number(budget.amount || 0), 0);
    const used = Array.from(usedByBudget.values()).reduce((a, b) => a + b, 0);
    const difference = planned - used;

    return {
      planned,
      used,
      difference,
      exceeded: difference < 0,
    };
  }, [budgets, transactions]);

  return (
    <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Target size={19} className="text-[#C8A15A]" />
            <h2 className="text-xl font-semibold tracking-tight text-[#0D1B2A]">
              Planejamento mensal
            </h2>
          </div>
          <p className="mt-1 text-sm text-[#3A3A3C]/60">
            Indicadores de {formatMonth(month)}. A edição fica em Movimentações → Planejamentos.
          </p>
        </div>

        <Link
          href="/registros/planejamentos"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-[#0D1B2A]/12 bg-[#F7F5EF] px-4 text-xs font-semibold text-[#0D1B2A] transition hover:bg-white"
        >
          Gerenciar planejamentos
        </Link>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[#C8A15A]" />
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard label="Planejado" value={summary.planned} />
          <SummaryCard label="Usado/pago" value={summary.used} />
          <SummaryCard
            label={summary.exceeded ? "Acima do planejado" : "Economia / saldo"}
            value={Math.abs(summary.difference)}
            negative={summary.exceeded}
            detail={
              summary.exceeded
                ? "gasto acima do limite definido"
                : "valor ainda não consumido"
            }
          />
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  negative = false,
}: {
  label: string;
  value: number;
  detail?: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[#F7F5EF] p-4">
      <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
        {label}
      </p>
      <p className={[
        "mt-1 text-lg font-semibold",
        negative ? "text-red-700" : "text-[#0D1B2A]",
      ].join(" ")}>
        {formatCurrency(value)}
      </p>
      {detail && <p className="mt-1 text-[11px] text-[#3A3A3C]/50">{detail}</p>}
    </div>
  );
}
