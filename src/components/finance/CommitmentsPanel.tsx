"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  Loader2,
  ReceiptText,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { supabase } from "@/lib/supabase";
import {
  formatCurrency,
  formatDate,
  getCommitmentStatusLabel,
  toNumber,
  type CommitmentDirection,
  type CommitmentProgress,
  type CommitmentStatus,
} from "@/lib/financial-engine";

type Props = {
  direction: CommitmentDirection;
};

export function CommitmentsPanel({ direction }: Props) {
  const { household } = useHousehold();
  const isPayable = direction === "payable";
  const [items, setItems] = useState<CommitmentProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"open" | "all" | "settled">("open");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await supabase
      .from("pf_commitment_progress")
      .select("*")
      .eq("household_id", household.id)
      .eq("direction", direction)
      .neq("computed_status", "cancelled")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    setItems((result.data ?? []) as CommitmentProgress[]);
    setLoading(false);
  }, [direction, household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredItems = useMemo(() => {
    if (statusFilter === "settled") {
      return items.filter((item) => item.computed_status === "settled");
    }
    if (statusFilter === "open") {
      return items.filter((item) =>
        ["pending", "partial", "overdue"].includes(item.computed_status),
      );
    }
    return items;
  }, [items, statusFilter]);

  const summary = useMemo(
    () =>
      items.reduce(
        (total, item) => ({
          total: total.total + toNumber(item.total_amount),
          settled: total.settled + toNumber(item.settled_amount),
          remaining: total.remaining + toNumber(item.remaining_amount),
          overdue: total.overdue + (item.computed_status === "overdue" ? 1 : 0),
        }),
        { total: 0, settled: 0, remaining: 0, overdue: 0 },
      ),
    [items],
  );

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
            Acompanhamento
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
            {isPayable ? "Contas a pagar" : "Valores a receber"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/65">
            Consulte total, liquidações e saldo restante. O cadastro e os pagamentos são feitos em Movimentações ou pelo Assistente.
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

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Valor total" value={formatCurrency(summary.total)} icon={isPayable ? ReceiptText : BadgeDollarSign} />
        <SummaryCard label={isPayable ? "Já pago" : "Já recebido"} value={formatCurrency(summary.settled)} icon={CheckCircle2} />
        <SummaryCard label="Saldo restante" value={formatCurrency(summary.remaining)} icon={Clock3} />
        <SummaryCard label="Atrasados" value={String(summary.overdue)} icon={AlertTriangle} />
      </section>

      <div className="flex justify-end">
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as "open" | "all" | "settled")}
          className="h-10 rounded-xl border border-[#0D1B2A]/12 bg-white px-4 text-sm outline-none"
        >
          <option value="open">Em aberto</option>
          <option value="settled">Liquidados</option>
          <option value="all">Todos</option>
        </select>
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#0D1B2A]/15 bg-white/70 p-10 text-center">
          {isPayable ? (
            <ReceiptText className="mx-auto text-[#C8A15A]" size={36} />
          ) : (
            <BadgeDollarSign className="mx-auto text-[#C8A15A]" size={36} />
          )}
          <h2 className="mt-4 text-lg font-semibold">
            Nenhum registro encontrado
          </h2>
          <p className="mt-2 text-sm text-[#3A3A3C]/55">
            Registre pela tela de Movimentações. Esta página será atualizada automaticamente.
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-[#0D1B2A]">
                      {item.counterparty}
                    </h2>
                    <StatusBadge status={item.computed_status} />
                  </div>
                  <p className="mt-1 text-sm text-[#3A3A3C]/55">
                    {item.description}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[560px]">
                  <Metric label="Total" value={formatCurrency(item.total_amount)} />
                  <Metric label={isPayable ? "Pago" : "Recebido"} value={formatCurrency(item.settled_amount)} />
                  <Metric label="Restante" value={formatCurrency(item.remaining_amount)} emphasis />
                  <Metric label="Vencimento" value={formatDate(item.due_date)} />
                </div>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#0D1B2A]/8">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{ width: `${Math.min(100, Math.max(0, Number(item.progress_percentage || 0)))}%` }}
                />
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

type IconType = typeof ReceiptText;

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

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl bg-[#F7F5EF] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${emphasis ? "text-red-800" : "text-[#0D1B2A]"}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: CommitmentStatus }) {
  const classes: Record<CommitmentStatus, string> = {
    pending: "bg-amber-50 text-amber-700",
    partial: "bg-blue-50 text-blue-700",
    settled: "bg-emerald-50 text-emerald-700",
    overdue: "bg-red-50 text-red-700",
    cancelled: "bg-gray-100 text-gray-500",
  };

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${classes[status]}`}>
      {getCommitmentStatusLabel(status)}
    </span>
  );
}
