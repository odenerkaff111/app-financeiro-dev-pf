"use client";

import {
  CalendarDays,
  CreditCard,
  Loader2,
  Plus,
  ReceiptText,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UnifiedFinancialEntryModal } from "@/components/finance/UnifiedFinancialEntryModal";
import { useHousehold } from "@/contexts/HouseholdContext";
import { supabase } from "@/lib/supabase";

type CardTransaction = {
  id: string;
  status: "planned" | "paid" | "overdue" | "cancelled";
  description: string;
  merchant: string | null;
  amount: number | string;
  due_date: string | null;
  paid_at: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  metadata: Record<string, unknown> | null;
};

type HolderGroup = {
  key: string;
  holder: string;
  institution: string | null;
  transactions: CardTransaction[];
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function monthKey(value: string | null) {
  return value?.slice(0, 7) ?? "sem-data";
}

function formatMonth(key: string) {
  if (!/^\d{4}-\d{2}$/.test(key)) return "Sem vencimento";
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function formatDate(value: string | null) {
  if (!value) return "Sem vencimento";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function transactionHolder(transaction: CardTransaction) {
  const value = transaction.metadata?.card_holder;
  return typeof value === "string" ? value.trim() : "";
}

function transactionInstitution(transaction: CardTransaction) {
  const value = transaction.metadata?.card_institution;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isThirdPartyCard(transaction: CardTransaction) {
  const paymentMethod = transaction.metadata?.payment_method;
  const ownCardId = transaction.metadata?.credit_card_account_id;
  return (
    paymentMethod === "credit_card" &&
    !ownCardId &&
    Boolean(transactionHolder(transaction))
  );
}

export function ThirdPartyCardsPanel() {
  const { household, canWrite } = useHousehold();
  const [transactions, setTransactions] = useState<CardTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await supabase
      .from("pf_transactions")
      .select(
        "id, status, description, merchant, amount, due_date, paid_at, installment_group_id, installment_number, installment_total, metadata",
      )
      .eq("household_id", household.id)
      .eq("type", "expense")
      .neq("status", "cancelled")
      .order("due_date", { ascending: true, nullsFirst: false });

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    setTransactions(
      ((result.data ?? []) as CardTransaction[]).filter(isThirdPartyCard),
    );
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const groups = useMemo<HolderGroup[]>(() => {
    const map = new Map<string, HolderGroup>();

    transactions.forEach((transaction) => {
      const holder = transactionHolder(transaction);
      const institution = transactionInstitution(transaction);
      const key = normalize(holder);
      const current = map.get(key) ?? {
        key,
        holder,
        institution,
        transactions: [],
      };
      if (!current.institution && institution) current.institution = institution;
      current.transactions.push(transaction);
      map.set(key, current);
    });

    return Array.from(map.values()).sort((a, b) =>
      a.holder.localeCompare(b.holder, "pt-BR"),
    );
  }, [transactions]);

  const overallPending = useMemo(
    () =>
      transactions
        .filter((item) => item.status !== "paid")
        .reduce((total, item) => total + Number(item.amount || 0), 0),
    [transactions],
  );

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C8A15A]">
            Cartões de terceiros
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[#0D1B2A]">
            Faturas que você vai reembolsar
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#3A3A3C]/60">
            Compras feitas em cartão de outra pessoa ficam agrupadas por titular. A próxima fatura e todas as parcelas futuras são somadas automaticamente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEntryOpen(true)}
          disabled={!canWrite}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus size={17} />
          Registrar compra
        </button>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Summary label="Titulares" value={String(groups.length)} />
        <Summary label="Total ainda a pagar" value={money(overallPending)} />
        <Summary
          label="Parcelas pendentes"
          value={String(transactions.filter((item) => item.status !== "paid").length)}
        />
      </section>

      {groups.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-[#0D1B2A]/15 bg-white px-5 py-12 text-center">
          <CreditCard className="mx-auto text-[#C8A15A]" />
          <p className="mt-3 font-semibold text-[#0D1B2A]">
            Nenhum cartão de terceiro registrado
          </p>
          <p className="mt-1 text-sm text-[#3A3A3C]/55">
            Em Movimentações, use “Compra no cartão / parcelada” e escolha “De outra pessoa”.
          </p>
        </section>
      ) : (
        groups.map((group) => (
          <HolderCard key={group.key} group={group} />
        ))
      )}

      <UnifiedFinancialEntryModal
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        onSaved={async () => {
          setEntryOpen(false);
          await loadData();
        }}
      />
    </div>
  );
}

function HolderCard({ group }: { group: HolderGroup }) {
  const pending = group.transactions.filter((item) => item.status !== "paid");
  const paid = group.transactions.filter((item) => item.status === "paid");
  const monthMap = new Map<string, number>();

  pending.forEach((item) => {
    const key = monthKey(item.due_date);
    monthMap.set(key, (monthMap.get(key) ?? 0) + Number(item.amount || 0));
  });

  const months = Array.from(monthMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const nextMonth = months[0] ?? null;
  const pendingTotal = pending.reduce(
    (total, item) => total + Number(item.amount || 0),
    0,
  );
  const paidTotal = paid.reduce(
    (total, item) => total + Number(item.amount || 0),
    0,
  );

  return (
    <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0D1B2A] text-[#C8A15A]">
            <CreditCard size={20} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[#0D1B2A]">{group.holder}</h2>
            <p className="text-sm text-[#3A3A3C]/55">
              {group.institution ?? "Instituição não informada"}
            </p>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs uppercase tracking-wider text-[#3A3A3C]/45">
            Total futuro ainda devido
          </p>
          <p className="mt-1 text-2xl font-semibold text-red-700">
            {money(pendingTotal)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Summary
          label={nextMonth ? `Próxima fatura · ${formatMonth(nextMonth[0])}` : "Próxima fatura"}
          value={nextMonth ? money(nextMonth[1]) : money(0)}
        />
        <Summary label="Já reembolsado" value={money(paidTotal)} />
        <Summary label="Parcelas pendentes" value={String(pending.length)} />
      </div>

      {months.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#0D1B2A]">
            <CalendarDays size={16} className="text-[#C8A15A]" />
            Faturas por mês
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {months.map(([key, value]) => (
              <div key={key} className="rounded-xl bg-[#F7F5EF] p-3">
                <p className="text-[11px] font-medium capitalize text-[#3A3A3C]/55">
                  {formatMonth(key)}
                </p>
                <p className="mt-1 text-sm font-semibold text-[#0D1B2A]">
                  {money(value)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[#0D1B2A]/8 text-[11px] uppercase tracking-wider text-[#3A3A3C]/45">
            <tr>
              <th className="py-2 pr-4">Compra</th>
              <th className="py-2 pr-4">Parcela</th>
              <th className="py-2 pr-4">Vencimento</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {group.transactions
              .slice()
              .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
              .map((item) => (
                <tr key={item.id} className="border-b border-[#0D1B2A]/6 last:border-0">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-[#0D1B2A]">{item.description}</p>
                    {item.merchant && (
                      <p className="text-xs text-[#3A3A3C]/50">{item.merchant}</p>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-[#3A3A3C]/65">
                    {item.installment_number && item.installment_total
                      ? `${item.installment_number}/${item.installment_total}`
                      : "1/1"}
                  </td>
                  <td className="py-3 pr-4 text-[#3A3A3C]/65">
                    {formatDate(item.due_date)}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={[
                        "rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                        item.status === "paid"
                          ? "bg-emerald-50 text-emerald-700"
                          : item.status === "overdue"
                            ? "bg-red-50 text-red-700"
                            : "bg-amber-50 text-amber-700",
                      ].join(" ")}
                    >
                      {item.status === "paid"
                        ? "Pago"
                        : item.status === "overdue"
                          ? "Atrasado"
                          : "A pagar"}
                    </span>
                  </td>
                  <td className="py-3 text-right font-semibold text-[#0D1B2A]">
                    {money(Number(item.amount || 0))}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-[#F7F5EF] px-3 py-2.5 text-xs leading-5 text-[#3A3A3C]/60">
        <ReceiptText size={15} className="mt-0.5 shrink-0 text-[#C8A15A]" />
        Não cadastre a fatura total novamente como outra dívida: ela já é a soma dessas compras e parcelas. Novas compras feitas neste cartão entram automaticamente nesta mesma visão quando o titular for escrito da mesma forma.
      </div>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#F7F5EF] p-4">
      <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-[#0D1B2A]">{value}</p>
    </div>
  );
}
