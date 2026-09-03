"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CreditCard,
  Download,
  Landmark,
  Loader2,
  Search,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type PeriodMode = "today" | "month" | "custom" | "all";

type CategoryRow = {
  id: string;
  name: string;
};

type TransactionRow = {
  id: string;
  category_id: string | null;
  type: string;
  status: string;
  description: string;
  merchant: string | null;
  amount: number | string;
  occurred_on: string;
  due_date: string | null;
  paid_at: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type StatementKind =
  | "card_purchase"
  | "outflow"
  | "inflow"
  | "transfer";

type StatementEvent = {
  id: string;
  at: string;
  dateKey: string;
  kind: StatementKind;
  title: string;
  detail: string;
  category: string;
  amount: number;
  cashImpact: number;
};

const BRAZIL_TZ = "America/Sao_Paulo";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function localDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";

  return `${year}-${month}-${day}`;
}

function todayKey() {
  return localDateKey(new Date());
}

function monthBounds(dateKey = todayKey()) {
  const [year, month] = dateKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function eventDateKey(iso: string) {
  return localDateKey(new Date(iso));
}

function formatDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRAZIL_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function numberFromMetadata(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statementTimestamp(transaction: TransactionRow) {
  // Para registros criados no mesmo dia da movimentação, created_at preserva
  // a hora real do cadastro. Para histórico, paid_at continua sendo a referência.
  const createdDate = eventDateKey(transaction.created_at);

  if (transaction.paid_at) {
    const paidDate = eventDateKey(transaction.paid_at);
    if (paidDate === createdDate) return transaction.created_at;
    return transaction.paid_at;
  }

  if (transaction.occurred_on === createdDate) {
    return transaction.created_at;
  }

  return `${transaction.occurred_on}T12:00:00-03:00`;
}

function eventKind(transaction: TransactionRow): StatementKind {
  if (
    transaction.type === "income" ||
    transaction.type === "debt_received" ||
    transaction.type === "investment_withdrawal"
  ) {
    return "inflow";
  }

  if (transaction.type === "transfer") {
    return "transfer";
  }

  return "outflow";
}

function escapeCsv(value: string | number) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export default function ExtratoPage() {
  const { household } = useHousehold();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const initialMonth = monthBounds();
  const [customStart, setCustomStart] = useState(initialMonth.start);
  const [customEnd, setCustomEnd] = useState(initialMonth.end);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [transactionsResult, categoriesResult] = await Promise.all([
      supabase
        .from("pf_transactions")
        .select(
          "id, category_id, type, status, description, merchant, amount, occurred_on, due_date, paid_at, installment_group_id, installment_number, installment_total, metadata, created_at",
        )
        .eq("household_id", household.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("pf_categories")
        .select("id, name")
        .eq("household_id", household.id),
    ]);

    const firstError = transactionsResult.error ?? categoriesResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setTransactions((transactionsResult.data ?? []) as TransactionRow[]);
    setCategories((categoriesResult.data ?? []) as CategoryRow[]);
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const allEvents = useMemo(() => {
    const events: StatementEvent[] = [];
    const installmentGroups = new Map<string, TransactionRow[]>();

    transactions.forEach((transaction) => {
      const origin = String(transaction.metadata?.origin ?? "");

      if (
        transaction.installment_group_id &&
        origin === "installment_purchase"
      ) {
        const current = installmentGroups.get(transaction.installment_group_id) ?? [];
        current.push(transaction);
        installmentGroups.set(transaction.installment_group_id, current);
      }

      if (transaction.status !== "paid") return;

      const kind = eventKind(transaction);
      const amount = Math.abs(Number(transaction.amount) || 0);
      const at = statementTimestamp(transaction);
      const installmentDetail = transaction.installment_group_id
        ? `Parcela ${transaction.installment_number ?? "—"}/${transaction.installment_total ?? "—"}`
        : null;

      const detailParts = [
        transaction.merchant,
        installmentDetail,
      ].filter(Boolean);

      events.push({
        id: `transaction:${transaction.id}`,
        at,
        dateKey: eventDateKey(at),
        kind,
        title:
          transaction.installment_group_id && origin === "installment_purchase"
            ? `Pagamento · ${transaction.description}`
            : transaction.description || "Movimentação",
        detail: detailParts.join(" · ") || "Movimentação realizada",
        category:
          (transaction.category_id && categoryMap.get(transaction.category_id)) ||
          "Sem categoria",
        amount,
        cashImpact:
          kind === "inflow"
            ? amount
            : kind === "outflow"
              ? -amount
              : 0,
      });
    });

    installmentGroups.forEach((group, groupId) => {
      const sorted = [...group].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      const first = sorted[0];
      if (!first) return;

      const metadata = first.metadata ?? {};
      const purchaseTotal =
        numberFromMetadata(metadata.purchase_total_amount) ||
        sorted.reduce((total, item) => total + Number(item.amount || 0), 0);
      const holder = String(metadata.card_holder ?? "").trim();
      const institution = String(metadata.card_institution ?? "").trim();
      const cardLabel = [holder, institution].filter(Boolean).join(" · ");
      const installmentCount = first.installment_total ?? sorted.length;
      const at = first.created_at;

      events.push({
        id: `card:${groupId}`,
        at,
        dateKey: eventDateKey(at),
        kind: "card_purchase",
        title: first.description || "Compra no cartão",
        detail: [
          first.merchant,
          cardLabel || "Cartão de crédito",
          `${installmentCount}x`,
        ]
          .filter(Boolean)
          .join(" · "),
        category:
          (first.category_id && categoryMap.get(first.category_id)) ||
          "Sem categoria",
        amount: purchaseTotal,
        cashImpact: 0,
      });
    });

    return events.sort((a, b) => b.at.localeCompare(a.at));
  }, [transactions, categoryMap]);

  const periodBounds = useMemo(() => {
    if (periodMode === "all") return null;
    if (periodMode === "today") {
      const today = todayKey();
      return { start: today, end: today };
    }
    if (periodMode === "month") return monthBounds();
    return { start: customStart, end: customEnd };
  }, [periodMode, customStart, customEnd]);

  const filteredEvents = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");

    return allEvents.filter((event) => {
      if (
        periodBounds &&
        (event.dateKey < periodBounds.start || event.dateKey > periodBounds.end)
      ) {
        return false;
      }

      if (!normalizedSearch) return true;

      return [event.title, event.detail, event.category]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(normalizedSearch);
    });
  }, [allEvents, periodBounds, search]);

  const totals = useMemo(() => {
    return filteredEvents.reduce(
      (summary, event) => {
        if (event.kind === "card_purchase") summary.card += event.amount;
        if (event.cashImpact > 0) summary.inflow += event.cashImpact;
        if (event.cashImpact < 0) summary.outflow += Math.abs(event.cashImpact);
        return summary;
      },
      { card: 0, inflow: 0, outflow: 0 },
    );
  }, [filteredEvents]);

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, StatementEvent[]>();

    filteredEvents.forEach((event) => {
      const current = groups.get(event.dateKey) ?? [];
      current.push(event);
      groups.set(event.dateKey, current);
    });

    return Array.from(groups.entries()).sort(([first], [second]) =>
      second.localeCompare(first),
    );
  }, [filteredEvents]);

  function exportCsv() {
    const rows = [
      [
        "Data",
        "Hora",
        "Evento",
        "Descrição",
        "Categoria",
        "Valor",
        "Impacto no caixa",
      ],
      ...filteredEvents.map((event) => [
        event.dateKey.split("-").reverse().join("/"),
        formatTime(event.at),
        event.kind === "card_purchase"
          ? "Compra no cartão"
          : event.kind === "inflow"
            ? "Entrada realizada"
            : event.kind === "outflow"
              ? "Saída realizada"
              : "Transferência",
        `${event.title}${event.detail ? ` · ${event.detail}` : ""}`,
        event.category,
        event.amount.toFixed(2).replace(".", ","),
        event.cashImpact.toFixed(2).replace(".", ","),
      ]),
    ];

    const content = `\uFEFF${rows
      .map((row) => row.map((cell) => escapeCsv(cell)).join(";"))
      .join("\r\n")}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const suffix = periodBounds
      ? `${periodBounds.start}_${periodBounds.end}`
      : "todo-periodo";

    anchor.href = url;
    anchor.download = `extrato-kyra-${suffix}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
            Linha do tempo financeira
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
            Extrato
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#3A3A3C]/70">
            Veja o que aconteceu em cada dia. Compras no cartão aparecem na data da compra; a saída de caixa acontece somente quando a fatura ou parcela é paga.
          </p>
        </div>

        <button
          type="button"
          onClick={exportCsv}
          disabled={filteredEvents.length === 0}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#172D43] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={16} />
          Baixar CSV
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Compras no cartão"
          value={totals.card}
          detail="Comprado no crédito no período"
          icon={CreditCard}
          accent="gold"
        />
        <MetricCard
          label="Saídas realizadas"
          value={totals.outflow}
          detail="Dinheiro que efetivamente saiu"
          icon={ArrowUpRight}
          accent="red"
        />
        <MetricCard
          label="Entradas realizadas"
          value={totals.inflow}
          detail="Dinheiro que efetivamente entrou"
          icon={ArrowDownLeft}
          accent="green"
        />
        <MetricCard
          label="Eventos"
          value={filteredEvents.length}
          detail="Movimentos na linha do tempo"
          icon={WalletCards}
          accent="navy"
          integer
        />
      </section>

      <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#3A3A3C]/40"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar descrição, estabelecimento ou categoria..."
              className="h-11 w-full rounded-xl border border-[#0D1B2A]/10 bg-white pl-11 pr-4 text-sm outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              ["today", "Hoje"],
              ["month", "Este mês"],
              ["custom", "Personalizado"],
              ["all", "Tudo"],
            ] as Array<[PeriodMode, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriodMode(value)}
                className={[
                  "h-10 rounded-xl px-3 text-xs font-semibold transition",
                  periodMode === value
                    ? "bg-[#0D1B2A] text-white"
                    : "border border-[#0D1B2A]/10 bg-[#F7F5EF] text-[#3A3A3C]/65 hover:text-[#0D1B2A]",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {periodMode === "custom" && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-[#3A3A3C]/65">
              De
              <input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] px-3 text-sm text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
              />
            </label>
            <label className="text-xs font-medium text-[#3A3A3C]/65">
              Até
              <input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] px-3 text-sm text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
              />
            </label>
          </div>
        )}
      </section>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white">
          <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Não foi possível carregar o extrato: {error}
        </div>
      ) : groupedEvents.length === 0 ? (
        <div className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-10 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-[#C8A15A]" />
          <p className="mt-3 font-semibold text-[#0D1B2A]">Nenhum evento encontrado</p>
          <p className="mt-1 text-sm text-[#3A3A3C]/55">
            Altere o período ou registre uma movimentação para começar a linha do tempo.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedEvents.map(([dateKey, events]) => (
            <section
              key={dateKey}
              className="overflow-hidden rounded-2xl border border-[#0D1B2A]/10 bg-white shadow-sm"
            >
              <header className="border-b border-[#0D1B2A]/8 bg-[#F7F5EF]/70 px-5 py-3">
                <p className="text-sm font-semibold capitalize text-[#0D1B2A]">
                  {formatDateLabel(dateKey)}
                </p>
              </header>

              <div className="divide-y divide-[#0D1B2A]/8">
                {events.map((event) => (
                  <StatementRow key={event.id} event={event} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent,
  integer = false,
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  accent: "gold" | "red" | "green" | "navy";
  integer?: boolean;
}) {
  const accents = {
    gold: "text-[#9A6E14] bg-[#C8A15A]/12",
    red: "text-red-700 bg-red-50",
    green: "text-emerald-700 bg-emerald-50",
    navy: "text-[#0D1B2A] bg-[#0D1B2A]/10",
  }[accent];

  return (
    <article className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-[#3A3A3C]/55">{label}</p>
        <span className={`rounded-lg p-2 ${accents}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold text-[#0D1B2A] sm:text-xl">
        {integer ? value.toLocaleString("pt-BR") : formatCurrency(value)}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-[#3A3A3C]/45">{detail}</p>
    </article>
  );
}

function StatementRow({ event }: { event: StatementEvent }) {
  const Icon =
    event.kind === "card_purchase"
      ? CreditCard
      : event.kind === "inflow"
        ? ArrowDownLeft
        : event.kind === "outflow"
          ? ArrowUpRight
          : Landmark;

  const iconClasses =
    event.kind === "card_purchase"
      ? "bg-[#C8A15A]/12 text-[#9A6E14]"
      : event.kind === "inflow"
        ? "bg-emerald-50 text-emerald-700"
        : event.kind === "outflow"
          ? "bg-red-50 text-red-700"
          : "bg-[#0D1B2A]/10 text-[#0D1B2A]";

  const amountClasses =
    event.kind === "card_purchase"
      ? "text-[#9A6E14]"
      : event.kind === "inflow"
        ? "text-emerald-700"
        : event.kind === "outflow"
          ? "text-red-700"
          : "text-[#0D1B2A]";

  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:grid-cols-[70px_42px_minmax(0,1fr)_auto] sm:px-5">
      <div className="text-xs font-medium text-[#3A3A3C]/50">
        {formatTime(event.at)}
      </div>

      <div className={`hidden h-9 w-9 items-center justify-center rounded-xl sm:flex ${iconClasses}`}>
        <Icon size={17} />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-[#0D1B2A]">
            {event.title}
          </p>
          <span className="rounded-full bg-[#F7F5EF] px-2 py-0.5 text-[10px] font-medium text-[#3A3A3C]/55">
            {event.category}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-[#3A3A3C]/50">
          {event.detail}
        </p>
        {event.kind === "card_purchase" && (
          <p className="mt-1 text-[10px] font-medium text-[#9A6E14]">
            Compra assumida hoje · saída de caixa nas faturas futuras
          </p>
        )}
      </div>

      <div className="text-right">
        <p className={`text-sm font-semibold ${amountClasses}`}>
          {event.kind === "inflow" ? "+ " : event.kind === "outflow" ? "- " : ""}
          {formatCurrency(event.amount)}
        </p>
        <p className="mt-0.5 text-[10px] text-[#3A3A3C]/40">
          {event.cashImpact === 0
            ? "Caixa: R$ 0,00"
            : `Caixa: ${event.cashImpact > 0 ? "+ " : "- "}${formatCurrency(Math.abs(event.cashImpact))}`}
        </p>
      </div>
    </div>
  );
}
