"use client";

import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Loader2,
  ReceiptText,
  WalletCards,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";
import { logSecurityEvent } from "@/lib/security-events";

type Obligation = {
  source_type: "commitment" | "transaction";
  source_id: string;
  household_id: string;
  direction: "payable" | "receivable";
  counterparty: string;
  description: string;
  total_amount: number | string;
  settled_amount: number | string;
  remaining_amount: number | string;
  due_date: string | null;
  computed_status: "pending" | "partial" | "overdue";
  default_account_id: string | null;
  category_id: string | null;
  source: string;
  notes: string | null;
  created_at: string;
  is_essential: boolean;
};

type Account = {
  id: string;
  name: string;
  institution_name: string | null;
  type: string;
  balance: number | string;
  is_active: boolean;
};

type SettlementForm = {
  account_id: string;
  amount: string;
  settled_on: string;
  notes: string;
};

function getToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatCurrency(value: number | string | null) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value: string | null) {
  if (!value) return "Sem vencimento";

  try {
    return format(parseISO(value), "dd/MM/yyyy", {
      locale: ptBR,
    });
  } catch {
    return value;
  }
}

function parseAmount(value: string) {
  const normalized = value.trim().includes(",")
    ? value.trim().replace(/\./g, "").replace(",", ".")
    : value.trim();
  return Number(normalized);
}

function notifyFinancialDataChanged(detail?: Record<string, unknown>) {
  const version = String(Date.now());
  window.localStorage.setItem("pf:financial-data-version", version);
  window.dispatchEvent(
    new CustomEvent("pf:financial-data-changed", {
      detail: { version, ...detail },
    }),
  );
}

export function UpcomingObligations() {
  const { household, canWrite } = useHousehold();
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<Obligation | null>(null);
  const [form, setForm] = useState<SettlementForm>({
    account_id: "",
    amount: "",
    settled_on: getToday(),
    notes: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [essentialSaving, setEssentialSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [obligationsResult, accountsResult] = await Promise.all([
      supabase
        .from("pf_upcoming_obligations")
        .select("*")
        .eq("household_id", household.id)
        .order("due_date", {
          ascending: true,
          nullsFirst: false,
        })
        .order("created_at", { ascending: true })
        .limit(12),
      supabase
        .from("pf_accounts")
        .select(
          "id, name, institution_name, type, balance, is_active",
        )
        .eq("household_id", household.id)
        .eq("is_active", true)
        .order("name"),
    ]);

    const firstError = obligationsResult.error ?? accountsResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setObligations(
      (obligationsResult.data ?? []) as Obligation[],
    );
    setAccounts((accountsResult.data ?? []) as Account[]);
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selected) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selected]);

  const totals = useMemo(() => {
    return obligations.reduce(
      (summary, obligation) => {
        const amount = Number(obligation.remaining_amount || 0);
        if (obligation.direction === "payable") {
          summary.payable += amount;
        } else {
          summary.receivable += amount;
        }
        if (obligation.computed_status === "overdue") {
          summary.overdue += amount;
        }
        return summary;
      },
      { payable: 0, receivable: 0, overdue: 0 },
    );
  }, [obligations]);

  function openObligation(obligation: Obligation) {
    const defaultAccount =
      accounts.find(
        (account) => account.id === obligation.default_account_id,
      ) ??
      accounts.find((account) =>
        obligation.direction === "receivable"
          ? account.type !== "credit_card" &&
            account.type !== "investment"
          : true,
      ) ??
      accounts[0];

    setSelected(obligation);
    setForm({
      account_id: defaultAccount?.id ?? "",
      amount: Number(obligation.remaining_amount || 0)
        .toFixed(2)
        .replace(".", ","),
      settled_on: getToday(),
      notes: "",
    });
    setError(null);
  }

  function closeModal() {
    if (saving) return;
    setSelected(null);
    setError(null);
  }

  async function toggleEssential() {
    if (!selected || selected.direction !== "payable" || essentialSaving) {
      return;
    }

    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    setEssentialSaving(true);
    setError(null);

    const nextValue = !selected.is_essential;
    const table =
      selected.source_type === "commitment"
        ? "pf_commitments"
        : "pf_transactions";

    const result = await supabase
      .from(table)
      .update({ is_essential: nextValue })
      .eq("id", selected.source_id)
      .eq("household_id", household.id);

    if (result.error) {
      setError(
        result.error.message ||
          "Não foi possível atualizar a classificação da despesa.",
      );
      setEssentialSaving(false);
      return;
    }

    setSelected((current) =>
      current ? { ...current, is_essential: nextValue } : current,
    );
    setObligations((current) =>
      current.map((item) =>
        item.source_type === selected.source_type &&
        item.source_id === selected.source_id
          ? { ...item, is_essential: nextValue }
          : item,
      ),
    );

    notifyFinancialDataChanged({
      source: "obligation_essential_classification",
      obligationId: selected.source_id,
    });

    setEssentialSaving(false);
  }

  async function registerSettlement(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selected || saving) return;

    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    if (!form.account_id) {
      setError(
        selected.direction === "payable"
          ? "Selecione a conta usada no pagamento."
          : "Selecione a conta que recebeu o valor.",
      );
      return;
    }

    const amount = parseAmount(form.amount);
    const remaining = Number(selected.remaining_amount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }

    if (amount > remaining + 0.005) {
      setError(
        `O valor não pode ser maior que ${formatCurrency(remaining)}.`,
      );
      return;
    }

    setSaving(true);
    setError(null);

    const result =
      selected.source_type === "commitment"
        ? await supabase.rpc("pf_register_commitment_settlement", {
            target_commitment_id: selected.source_id,
            target_account_id: form.account_id,
            settlement_amount: amount,
            settlement_date: form.settled_on,
            settlement_notes: form.notes.trim() || null,
            settlement_source: "dashboard",
          })
        : await supabase.rpc(
            "pf_register_pending_transaction_settlement",
            {
              target_transaction_id: selected.source_id,
              target_account_id: form.account_id,
              settlement_amount: amount,
              settlement_date: form.settled_on,
              settlement_notes: form.notes.trim() || null,
            },
          );

    if (result.error) {
      setError(
        result.error.message ||
          "Não foi possível registrar a liquidação.",
      );
      setSaving(false);
      return;
    }

    notifyFinancialDataChanged({
      source: "dashboard_obligation",
      obligationType: selected.source_type,
      obligationId: selected.source_id,
    });

    void logSecurityEvent({
      householdId: household.id,
      eventType: "obligation_settlement_confirmed",
      severity: "info",
      success: true,
      resourceType: selected.source_type,
      resourceId: selected.source_id,
      metadata: {
        action:
          selected.direction === "payable"
            ? "payment"
            : "receipt",
        source: "dashboard",
        obligation_type: selected.source_type,
      },
    });

    setSaving(false);
    setSelected(null);
    await loadData();
  }

  if (loading) {
    return (
      <section className="flex min-h-64 items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
      </section>
    );
  }

  return (
    <>
      <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock
                size={19}
                className="text-[#C8A15A]"
              />
              <h2 className="text-xl font-semibold tracking-tight text-[#0D1B2A]">
                Próximas obrigações
              </h2>
            </div>
            <p className="mt-1 text-sm text-[#3A3A3C]/60">
              Contas a pagar e valores a receber que exigem atenção.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-right sm:min-w-[360px]">
            <MiniTotal
              label="A pagar"
              value={totals.payable}
              tone="negative"
            />
            <MiniTotal
              label="A receber"
              value={totals.receivable}
              tone="positive"
            />
            <MiniTotal
              label="Em atraso"
              value={totals.overdue}
              tone="warning"
            />
          </div>
        </div>

        {error && !selected && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {obligations.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2
              size={34}
              className="mx-auto text-emerald-600"
            />
            <p className="mt-3 font-semibold text-[#0D1B2A]">
              Nenhuma obrigação pendente
            </p>
            <p className="mt-1 text-sm text-[#3A3A3C]/55">
              Suas próximas contas e recebimentos aparecerão aqui.
            </p>
          </div>
        ) : (
          <div className="mt-5 divide-y divide-[#0D1B2A]/8">
            {obligations.map((obligation) => {
              const isReceivable =
                obligation.direction === "receivable";

              return (
                <button
                  key={`${obligation.source_type}-${obligation.source_id}`}
                  type="button"
                  onClick={() => openObligation(obligation)}
                  className="group flex w-full flex-col gap-3 py-4 text-left first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={[
                        "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                        obligation.computed_status === "overdue"
                          ? "bg-red-500"
                          : isReceivable
                            ? "bg-emerald-500"
                            : "bg-amber-400",
                      ].join(" ")}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[#0D1B2A]">
                        {obligation.description}
                      </p>
                      <p className="mt-1 text-xs text-[#3A3A3C]/55">
                        {obligation.counterparty} • {isReceivable
                          ? "A receber"
                          : "A pagar"} • {formatDate(obligation.due_date)}
                      </p>
                      {obligation.direction === "payable" &&
                        obligation.is_essential && (
                          <span className="mt-2 inline-flex rounded-full bg-[#C8A15A]/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#8A641F]">
                            Despesa essencial
                          </span>
                        )}
                      {Number(obligation.settled_amount || 0) > 0 && (
                        <p className="mt-1 text-xs text-[#3A3A3C]/45">
                          Já liquidado: {formatCurrency(
                            obligation.settled_amount,
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <div className="text-right">
                      <p
                        className={[
                          "font-semibold",
                          isReceivable
                            ? "text-emerald-700"
                            : "text-red-700",
                        ].join(" ")}
                      >
                        {formatCurrency(obligation.remaining_amount)}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-[#3A3A3C]/40">
                        Saldo restante
                      </p>
                    </div>
                    <ChevronRight
                      size={18}
                      className="text-[#3A3A3C]/35 transition group-hover:translate-x-0.5 group-hover:text-[#0D1B2A]"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selected && (
        <div className="fixed inset-0 z-[140] overflow-y-auto bg-[#0D1B2A]/55 px-4 py-6 backdrop-blur-sm">
          <div className="mx-auto flex min-h-full max-w-xl items-center justify-center">
            <div className="w-full overflow-hidden rounded-3xl border border-[#C8A15A]/25 bg-[#F7F5EF] shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-[#0D1B2A]/10 px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C8A15A]">
                    {selected.direction === "payable"
                      ? "Conta a pagar"
                      : "Valor a receber"}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-[#0D1B2A]">
                    {selected.description}
                  </h3>
                  <p className="mt-1 text-sm text-[#3A3A3C]/60">
                    {selected.counterparty}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-full p-2 text-[#3A3A3C]/55 transition hover:bg-white hover:text-[#0D1B2A]"
                  aria-label="Fechar"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 px-6 pt-5 sm:grid-cols-4">
                <DetailCard
                  label="Valor total"
                  value={formatCurrency(selected.total_amount)}
                />
                <DetailCard
                  label="Já liquidado"
                  value={formatCurrency(selected.settled_amount)}
                />
                <DetailCard
                  label="Saldo"
                  value={formatCurrency(selected.remaining_amount)}
                  strong
                />
                <DetailCard
                  label="Vencimento"
                  value={formatDate(selected.due_date)}
                />
              </div>

              {selected.notes && (
                <div className="mx-6 mt-4 rounded-xl border border-[#0D1B2A]/8 bg-white px-4 py-3 text-sm leading-6 text-[#3A3A3C]/65">
                  {selected.notes}
                </div>
              )}

              {selected.direction === "payable" && (
                <div className="mx-6 mt-4 flex items-center justify-between gap-4 rounded-xl border border-[#C8A15A]/25 bg-[#C8A15A]/8 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0D1B2A]">
                      Despesa essencial
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#3A3A3C]/55">
                      Inclui esta conta no cálculo do custo de vida médio.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleEssential()}
                    disabled={essentialSaving || !canWrite}
                    className={[
                      "relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50",
                      selected.is_essential
                        ? "bg-[#0D1B2A]"
                        : "bg-[#0D1B2A]/15",
                    ].join(" ")}
                    aria-pressed={selected.is_essential}
                    aria-label="Alternar despesa essencial"
                  >
                    <span
                      className={[
                        "absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition",
                        selected.is_essential ? "left-6" : "left-1",
                      ].join(" ")}
                    />
                  </button>
                </div>
              )}

              <form onSubmit={registerSettlement}>
                <div className="space-y-4 px-6 py-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[#0D1B2A]">
                        {selected.direction === "payable"
                          ? "Conta usada"
                          : "Conta que recebeu"}
                      </span>
                      <select
                        value={form.account_id}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            account_id: event.target.value,
                          }))
                        }
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                      >
                        <option value="">Selecione</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name} — {formatCurrency(account.balance)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[#0D1B2A]">
                        Data
                      </span>
                      <input
                        type="date"
                        value={form.settled_on}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            settled_on: event.target.value,
                          }))
                        }
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                      />
                    </label>
                  </div>

                  <label className="block space-y-2">
                    <span className="flex items-center justify-between gap-3 text-sm font-medium text-[#0D1B2A]">
                      Valor
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            amount: Number(
                              selected.remaining_amount || 0,
                            )
                              .toFixed(2)
                              .replace(".", ","),
                          }))
                        }
                        className="text-xs font-semibold text-[#8A641F] hover:underline"
                      >
                        Usar valor integral
                      </button>
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.amount}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                      placeholder="0,00"
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Observação
                    </span>
                    <textarea
                      rows={2}
                      value={form.notes}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Opcional"
                      className="w-full resize-none rounded-xl border border-[#0D1B2A]/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#C8A15A]"
                    />
                  </label>

                  {error && (
                    <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      <AlertCircle size={17} className="mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {!canWrite && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                      Seu acesso é somente leitura. Você pode consultar os detalhes, mas não registrar pagamentos ou recebimentos.
                    </div>
                  )}
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-[#0D1B2A]/10 px-6 py-4 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={saving}
                    className="h-11 rounded-xl border border-[#0D1B2A]/15 px-5 text-sm font-semibold text-[#0D1B2A] transition hover:bg-white disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !canWrite}
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-6 text-sm font-semibold text-white transition hover:bg-[#172D43] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : selected.direction === "payable" ? (
                      <WalletCards size={17} />
                    ) : (
                      <ReceiptText size={17} />
                    )}
                    {selected.direction === "payable"
                      ? "Registrar pagamento"
                      : "Registrar recebimento"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MiniTotal({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "negative" | "positive" | "warning";
}) {
  const classes = {
    negative: "text-red-700",
    positive: "text-emerald-700",
    warning: "text-amber-700",
  }[tone];

  return (
    <div className="rounded-xl bg-[#F7F5EF] px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-[#3A3A3C]/45">
        {label}
      </p>
      <p className={["mt-1 text-sm font-semibold", classes].join(" ")}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function DetailCard({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#0D1B2A]/8 bg-white px-3 py-3">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-[#3A3A3C]/45">
        {label}
      </p>
      <p
        className={[
          "mt-1 text-sm text-[#0D1B2A]",
          strong ? "font-semibold" : "font-medium",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}
