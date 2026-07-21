"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  HandCoins,
  Loader2,
  TrendingDown,
  WalletCards,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type DebtStatus =
  | "active"
  | "paid"
  | "negotiating"
  | "cancelled";

type Debt = {
  id: string;
  household_id: string;
  creditor: string;
  description: string | null;
  type: string;
  original_amount: number | string;
  current_balance: number | string;
  installment_amount: number | string | null;
  total_installments: number | null;
  paid_installments: number;
  remaining_installments: number | null;
  interest_free: boolean;
  status: DebtStatus;
  paid_amount: number | string;
  progress_percentage: number | string;
};

type Account = {
  id: string;
  name: string;
  institution_name: string | null;
  balance: number | string;
  type: string;
  is_active: boolean;
};

type PaymentForm = {
  account_id: string;
  amount: string;
  paid_on: string;
  count_installment: boolean;
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

function parseAmount(value: string) {
  const cleanedValue = value.trim();

  if (!cleanedValue) {
    return Number.NaN;
  }

  const normalizedValue = cleanedValue.includes(",")
    ? cleanedValue
        .replace(/\./g, "")
        .replace(",", ".")
    : cleanedValue;

  return Number(normalizedValue);
}

function clampPercentage(value: number | string) {
  const parsedValue = Number(value || 0);

  return Math.min(
    100,
    Math.max(
      0,
      Number.isFinite(parsedValue)
        ? parsedValue
        : 0,
    ),
  );
}

function getStatusLabel(status: DebtStatus) {
  const labels: Record<DebtStatus, string> = {
    active: "Ativa",
    paid: "Quitada",
    negotiating: "Negociando",
    cancelled: "Cancelada",
  };

  return labels[status];
}

function getStatusClasses(status: DebtStatus) {
  const classes: Record<DebtStatus, string> = {
    active: "bg-amber-50 text-amber-700",
    paid: "bg-emerald-50 text-emerald-700",
    negotiating: "bg-blue-50 text-blue-700",
    cancelled: "bg-gray-100 text-gray-500",
  };

  return classes[status];
}

export default function DebtsPage() {
  const { household } = useHousehold();

  const [debts, setDebts] = useState<Debt[]>([]);
  const [accounts, setAccounts] = useState<Account[]>(
    [],
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(
    null,
  );

  const [selectedDebt, setSelectedDebt] =
    useState<Debt | null>(null);

  const [paymentForm, setPaymentForm] =
    useState<PaymentForm>({
      account_id: "",
      amount: "",
      paid_on: getToday(),
      count_installment: true,
      notes: "",
    });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [debtsResult, accountsResult] =
      await Promise.all([
        supabase
          .from("pf_debt_progress")
          .select("*")
          .eq("household_id", household.id)
          .neq("status", "cancelled")
          .order("current_balance", {
            ascending: false,
          }),

        supabase
          .from("pf_accounts")
          .select(
            "id, name, institution_name, balance, type, is_active",
          )
          .eq("household_id", household.id)
          .eq("is_active", true)
          .order("name"),
      ]);

    if (debtsResult.error) {
      console.error(
        "Erro ao carregar dívidas:",
        debtsResult.error,
      );

      setError(
        "Não foi possível carregar suas dívidas.",
      );

      setLoading(false);
      return;
    }

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

    setDebts((debtsResult.data ?? []) as Debt[]);

    setAccounts(
      (accountsResult.data ?? []) as Account[],
    );

    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedDebt) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [selectedDebt]);


  function openPaymentModal(debt: Debt) {
    const defaultAmount = Math.min(
      Number(debt.installment_amount || 0),
      Number(debt.current_balance || 0),
    );

    setSelectedDebt(debt);

    setPaymentForm({
      account_id: accounts[0]?.id ?? "",
      amount:
        defaultAmount > 0
          ? defaultAmount
              .toFixed(2)
              .replace(".", ",")
          : "",
      paid_on: getToday(),
      count_installment: true,
      notes: "",
    });

    setError(null);
  }

  function closePaymentModal() {
    if (saving) {
      return;
    }

    setSelectedDebt(null);
    setError(null);
  }

  async function registerPayment(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selectedDebt) {
      return;
    }

    if (!paymentForm.account_id) {
      setError(
        "Selecione a conta usada para o pagamento.",
      );

      return;
    }

    const amount = parseAmount(paymentForm.amount);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setError(
        "Informe um valor de pagamento válido.",
      );

      return;
    }

    if (
      amount >
      Number(selectedDebt.current_balance)
    ) {
      setError(
        "O pagamento não pode ser maior que o saldo restante.",
      );

      return;
    }

    setSaving(true);
    setError(null);

    const { error: paymentError } =
      await supabase.rpc(
        "pf_register_debt_payment",
        {
          target_debt_id: selectedDebt.id,
          target_account_id:
            paymentForm.account_id,
          payment_amount: amount,
          payment_date: paymentForm.paid_on,
          count_installment:
            paymentForm.count_installment,
          payment_notes:
            paymentForm.notes.trim() || null,
        },
      );

    if (paymentError) {
      console.error(
        "Erro ao registrar pagamento:",
        paymentError,
      );

      setError(
        paymentError.message ||
          "Não foi possível registrar o pagamento.",
      );

      setSaving(false);
      return;
    }

    setSaving(false);
    setSelectedDebt(null);

    await loadData();
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#C8A15A]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
          Compromissos financeiros
        </p>

        <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
          Dívidas pessoais
        </h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/70">
          Acompanhe quanto você já pagou e quanto
          ainda falta para quitar.
        </p>
      </header>

      {error && !selectedDebt && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}


      <section className="space-y-2.5">
        {debts.map((debt) => {
          const progress = clampPercentage(
            debt.progress_percentage,
          );

          const isPaid =
            debt.status === "paid";

          return (
            <article
              key={debt.id}
              className="rounded-xl border border-[#0D1B2A]/10 bg-white px-4 py-3 shadow-sm"
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(160px,0.9fr)_minmax(210px,1fr)_minmax(390px,2fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-[#0D1B2A]">
                      {debt.creditor}
                    </h2>

                    <span
                      className={[
                        "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                        getStatusClasses(
                          debt.status,
                        ),
                      ].join(" ")}
                    >
                      {getStatusLabel(
                        debt.status,
                      )}
                    </span>
                  </div>

                  <p className="mt-0.5 truncate text-[11px] text-[#3A3A3C]/50">
                    Empréstimo pessoal sem juros
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4 lg:block">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
                      Falta pagar
                    </p>

                    <p className="mt-0.5 text-lg font-semibold text-red-800">
                      {formatCurrency(
                        debt.current_balance,
                      )}
                    </p>
                  </div>

                  <p className="text-xs font-semibold text-emerald-700 lg:hidden">
                    {progress.toFixed(1)}%
                  </p>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#0D1B2A]/8">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-all"
                        style={{
                          width: `${progress}%`,
                        }}
                      />
                    </div>

                    <span className="hidden w-12 shrink-0 text-right text-xs font-semibold text-emerald-700 lg:block">
                      {progress.toFixed(1)}%
                    </span>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <DebtDetail
                      label="Valor total"
                      value={formatCurrency(
                        debt.original_amount,
                      )}
                    />

                    <DebtDetail
                      label="Já pago"
                      value={formatCurrency(
                        debt.paid_amount,
                      )}
                    />

                    <DebtDetail
                      label="Mensalidade"
                      value={formatCurrency(
                        debt.installment_amount,
                      )}
                    />

                    <DebtDetail
                      label="Parcelas"
                      value={`${debt.paid_installments}/${debt.total_installments ?? "—"}`}
                    />
                  </div>
                </div>

                <div className="lg:flex lg:justify-end">
                  {!isPaid ? (
                    <button
                      type="button"
                      onClick={() =>
                        openPaymentModal(debt)
                      }
                      disabled={
                        accounts.length === 0
                      }
                      className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#0D1B2A] px-4 text-xs font-semibold text-white transition hover:bg-[#172D43] disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
                    >
                      <WalletCards size={15} />

                      Registrar pagamento
                    </button>
                  ) : (
                    <div className="flex h-9 items-center justify-center rounded-lg bg-emerald-50 px-4 text-xs font-semibold text-emerald-700">
                      Dívida quitada
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {debts.length === 0 && (
        <section className="rounded-2xl border border-dashed border-[#0D1B2A]/20 bg-white/70 px-6 py-16 text-center">
          <HandCoins
            size={40}
            className="mx-auto text-[#C8A15A]"
          />

          <h2 className="mt-4 text-xl font-semibold text-[#0D1B2A]">
            Nenhuma dívida cadastrada
          </h2>
        </section>
      )}

      {selectedDebt && (
        <div className="fixed inset-0 z-[130] overflow-y-auto bg-[#0D1B2A]/55 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center p-4 pb-28">
            <div className="w-full max-w-xl rounded-3xl border border-[#C8A15A]/25 bg-[#F7F5EF] shadow-2xl">
              <div className="flex items-start justify-between border-b border-[#0D1B2A]/10 px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#C8A15A]">
                    Pagamento de dívida
                  </p>

                  <h2 className="mt-2 text-2xl font-semibold text-[#0D1B2A]">
                    {selectedDebt.creditor}
                  </h2>

                  <p className="mt-1 text-sm text-[#3A3A3C]/60">
                    Saldo:{" "}
                    {formatCurrency(
                      selectedDebt.current_balance,
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closePaymentModal}
                  className="rounded-full p-2 text-[#3A3A3C]/60 hover:bg-white"
                  aria-label="Fechar"
                >
                  <X size={20} />
                </button>
              </div>

              <form
                onSubmit={registerPayment}
                className="space-y-5 px-6 py-6"
              >
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    Conta usada no pagamento
                  </span>

                  <select
                    required
                    value={paymentForm.account_id}
                    onChange={(event) =>
                      setPaymentForm(
                        (currentForm) => ({
                          ...currentForm,
                          account_id:
                            event.target.value,
                        }),
                      )
                    }
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                  >
                    <option value="">
                      Selecione
                    </option>

                    {accounts.map((account) => (
                      <option
                        key={account.id}
                        value={account.id}
                      >
                        {account.name} —{" "}
                        {formatCurrency(
                          account.balance,
                        )}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Valor pago
                    </span>

                    <input
                      type="text"
                      inputMode="decimal"
                      required
                      value={paymentForm.amount}
                      onChange={(event) =>
                        setPaymentForm(
                          (currentForm) => ({
                            ...currentForm,
                            amount:
                              event.target.value,
                          }),
                        )
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Data
                    </span>

                    <input
                      type="date"
                      required
                      value={paymentForm.paid_on}
                      onChange={(event) =>
                        setPaymentForm(
                          (currentForm) => ({
                            ...currentForm,
                            paid_on:
                              event.target.value,
                          }),
                        )
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>
                </div>

                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[#0D1B2A]/10 bg-white p-4">
                  <div>
                    <p className="text-sm font-medium text-[#0D1B2A]">
                      Contar como parcela paga
                    </p>

                    <p className="mt-1 text-xs text-[#3A3A3C]/55">
                      Desmarque em pagamentos parciais.
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={
                      paymentForm.count_installment
                    }
                    onChange={(event) =>
                      setPaymentForm(
                        (currentForm) => ({
                          ...currentForm,
                          count_installment:
                            event.target.checked,
                        }),
                      )
                    }
                    className="h-5 w-5 accent-[#0D1B2A]"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    Observações
                  </span>

                  <textarea
                    rows={3}
                    value={paymentForm.notes}
                    onChange={(event) =>
                      setPaymentForm(
                        (currentForm) => ({
                          ...currentForm,
                          notes:
                            event.target.value,
                        }),
                      )
                    }
                    className="w-full resize-none rounded-xl border border-[#0D1B2A]/15 bg-white px-4 py-3 text-sm outline-none"
                  />
                </label>

                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closePaymentModal}
                    disabled={saving}
                    className="h-11 rounded-xl border border-[#0D1B2A]/15 px-5 text-sm font-semibold"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={saving}
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-6 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {saving && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}

                    Confirmar pagamento
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function DebtDetail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/50">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-[#0D1B2A]">
        {value}
      </p>
    </div>
  );
}