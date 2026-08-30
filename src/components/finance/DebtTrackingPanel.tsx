"use client";

import {
  CheckCircle2,
  HandCoins,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  WalletCards,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { supabase } from "@/lib/supabase";
import {
  formatCurrency,
  getInterestPeriodLabel,
  toNumber,
} from "@/lib/financial-engine";

type DebtGroup = "personal" | "other";

type DebtProgress = {
  id: string;
  household_id: string;
  creditor: string;
  description: string | null;
  original_amount: number | string;
  current_balance: number | string;
  installment_amount: number | string | null;
  total_installments: number | null;
  paid_installments: number;
  remaining_installments: number | null;
  status: string;
  paid_amount: number | string;
  progress_percentage: number | string;
  debt_group: DebtGroup;
  interest_enabled: boolean;
  interest_rate: number | string;
  interest_period: "daily" | "monthly" | "yearly";
  interest_method: "simple" | "compound";
  accrued_interest: number | string;
  projected_penalty: number | string;
  projected_late_interest: number | string;
  projected_balance: number | string;
  daily_growth: number | string;
  overdue_days: number;
  start_date: string | null;
  due_date: string | null;
};

type Account = {
  id: string;
  name: string;
  balance: number | string;
  is_active: boolean;
};

type UnlinkedDebtObligation = {
  id: string;
  household_id: string;
  account_id: string;
  description: string;
  merchant: string | null;
  amount: number | string;
  original_amount: number | string | null;
  occurred_on: string;
  due_date: string | null;
  status: string;
};

type Props = {
  group: DebtGroup;
  title: string;
  description: string;
  emptyText: string;
};

type PaymentForm = {
  accountId: string;
  amount: string;
  date: string;
  countInstallment: boolean;
  notes: string;
};

type NewDebtForm = {
  creditor: string;
  description: string;
  originalAmount: string;
  installmentAmount: string;
  accountId: string;
  startDate: string;
  dueDate: string;
  interestEnabled: boolean;
  interestRate: string;
  interestPeriod: "daily" | "monthly" | "yearly";
  interestMethod: "simple" | "compound";
};

function today() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseAmount(value: string) {
  const normalized = value.trim().includes(",")
    ? value.trim().replace(/\./g, "").replace(",", ".")
    : value.trim();

  return Number(normalized);
}

function emptyNewDebtForm(): NewDebtForm {
  return {
    creditor: "",
    description: "",
    originalAmount: "",
    installmentAmount: "",
    accountId: "",
    startDate: today(),
    dueDate: today(),
    interestEnabled: false,
    interestRate: "",
    interestPeriod: "monthly",
    interestMethod: "simple",
  };
}

function clampPercentage(value: number | string) {
  const parsed = Number(value || 0);
  return Math.min(100, Math.max(0, Number.isFinite(parsed) ? parsed : 0));
}

function statusLabel(status: string) {
  if (status === "paid") return "Quitada";
  if (status === "negotiating") return "Negociando";
  return "Ativa";
}

function statusClasses(status: string) {
  if (status === "paid") return "bg-emerald-50 text-emerald-700";
  if (status === "negotiating") return "bg-blue-50 text-blue-700";
  return "bg-amber-50 text-amber-700";
}

export function DebtTrackingPanel({
  group,
  title,
  description,
  emptyText,
}: Props) {
  const { household, canWrite } = useHousehold();
  const [debts, setDebts] = useState<DebtProgress[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [unlinkedObligations, setUnlinkedObligations] = useState<UnlinkedDebtObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDebt, setSelectedDebt] = useState<DebtProgress | null>(null);
  const [showNewDebt, setShowNewDebt] = useState(false);
  const [editingDebt, setEditingDebt] = useState<DebtProgress | null>(null);
  const [debtToDelete, setDebtToDelete] = useState<DebtProgress | null>(null);
  const [newDebtForm, setNewDebtForm] = useState<NewDebtForm>(emptyNewDebtForm());
  const [paymentForm, setPaymentForm] = useState<PaymentForm>({
    accountId: "",
    amount: "",
    date: today(),
    countInstallment: false,
    notes: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [debtsResult, accountsResult, unlinkedResult] = await Promise.all([
      supabase
        .from("pf_debt_progress")
        .select("*")
        .eq("household_id", household.id)
        .eq("debt_group", group)
        .neq("status", "cancelled")
        .order("projected_balance", { ascending: false }),
      supabase
        .from("pf_accounts")
        .select("id, name, balance, is_active")
        .eq("household_id", household.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("pf_unlinked_debt_obligations")
        .select("id, household_id, account_id, description, merchant, amount, original_amount, occurred_on, due_date, status")
        .eq("household_id", household.id)
        .order("due_date", { ascending: true, nullsFirst: false }),
    ]);

    const firstError = debtsResult.error ?? accountsResult.error ?? unlinkedResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setDebts((debtsResult.data ?? []) as DebtProgress[]);
    setAccounts((accountsResult.data ?? []) as Account[]);
    setUnlinkedObligations((unlinkedResult.data ?? []) as UnlinkedDebtObligation[]);
    setLoading(false);
  }, [group, household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedDebt && !showNewDebt && !debtToDelete) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selectedDebt, showNewDebt, debtToDelete]);

  function openNewDebt() {
    setEditingDebt(null);
    setNewDebtForm({
      ...emptyNewDebtForm(),
      accountId: accounts[0]?.id ?? "",
    });
    setError(null);
    setShowNewDebt(true);
  }

  function openEditDebt(debt: DebtProgress) {
    setEditingDebt(debt);
    setNewDebtForm({
      creditor: debt.creditor,
      description: debt.description ?? "",
      originalAmount: toNumber(debt.original_amount).toFixed(2).replace(".", ","),
      installmentAmount:
        toNumber(debt.installment_amount) > 0
          ? toNumber(debt.installment_amount).toFixed(2).replace(".", ",")
          : "",
      accountId: "",
      startDate: debt.start_date ?? today(),
      dueDate: debt.due_date ?? today(),
      interestEnabled: debt.interest_enabled,
      interestRate: debt.interest_enabled
        ? Number(debt.interest_rate || 0).toString().replace(".", ",")
        : "",
      interestPeriod: debt.interest_period,
      interestMethod: debt.interest_method,
    });
    setError(null);
    setShowNewDebt(true);
  }

  async function promoteObligation(transactionId: string, targetGroup: DebtGroup) {
    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    setSaving(true);
    setError(null);

    const result = await supabase.rpc("pf_promote_transaction_to_debt_v1", {
      target_transaction_id: transactionId,
      target_debt_group: targetGroup,
    });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    await loadData();
    window.localStorage.setItem("pf:financial-data-version", String(Date.now()));
    window.dispatchEvent(new Event("pf:financial-data-changed"));
  }

  async function createDebt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    const creditor = newDebtForm.creditor.trim();
    const originalAmount = parseAmount(newDebtForm.originalAmount);
    const installmentAmount = newDebtForm.installmentAmount.trim()
      ? parseAmount(newDebtForm.installmentAmount)
      : 0;
    const interestRate = newDebtForm.interestEnabled
      ? parseAmount(newDebtForm.interestRate || "0")
      : 0;

    if (!creditor) {
      setError("Informe para quem você deve.");
      return;
    }

    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      setError("Informe um valor total maior que zero.");
      return;
    }

    if (!Number.isFinite(installmentAmount) || installmentAmount < 0) {
      setError("Informe uma mensalidade válida.");
      return;
    }

    if (!newDebtForm.accountId) {
      setError("Selecione a conta prevista para o pagamento.");
      return;
    }

    if (!newDebtForm.dueDate) {
      setError("Informe o próximo vencimento.");
      return;
    }

    if (newDebtForm.interestEnabled && (!Number.isFinite(interestRate) || interestRate < 0)) {
      setError("Informe uma taxa de juros válida.");
      return;
    }

    setSaving(true);
    setError(null);

    const result = await supabase.rpc("pf_create_debt_obligation_v1", {
      target_household_id: household.id,
      obligation_account_id: newDebtForm.accountId,
      debt_creditor: creditor,
      debt_description:
        newDebtForm.description.trim() || `Dívida com ${creditor}`,
      debt_original_amount: originalAmount,
      target_debt_group: group,
      debt_start_date: newDebtForm.startDate,
      debt_due_date: newDebtForm.dueDate,
      debt_installment_amount: installmentAmount > 0 ? installmentAmount : null,
      debt_interest_enabled: newDebtForm.interestEnabled,
      debt_auto_accrue_interest: newDebtForm.interestEnabled,
      debt_interest_rate: interestRate,
      debt_interest_period: newDebtForm.interestPeriod,
      debt_interest_method: newDebtForm.interestMethod,
      obligation_notes: null,
    });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setShowNewDebt(false);
    await loadData();

    window.localStorage.setItem("pf:financial-data-version", String(Date.now()));
    window.dispatchEvent(new Event("pf:financial-data-changed"));
  }

  async function updateDebt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDebt) return;

    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    const creditor = newDebtForm.creditor.trim();
    const originalAmount = parseAmount(newDebtForm.originalAmount);
    const installmentAmount = newDebtForm.installmentAmount.trim()
      ? parseAmount(newDebtForm.installmentAmount)
      : 0;
    const interestRate = newDebtForm.interestEnabled
      ? parseAmount(newDebtForm.interestRate || "0")
      : 0;

    if (!creditor) {
      setError("Informe para quem você deve.");
      return;
    }
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      setError("Informe um valor total maior que zero.");
      return;
    }
    if (!Number.isFinite(installmentAmount) || installmentAmount < 0) {
      setError("Informe uma mensalidade válida.");
      return;
    }
    if (!newDebtForm.dueDate) {
      setError("Informe o próximo vencimento.");
      return;
    }
    if (newDebtForm.interestEnabled && (!Number.isFinite(interestRate) || interestRate < 0)) {
      setError("Informe uma taxa de juros válida.");
      return;
    }

    setSaving(true);
    setError(null);

    const result = await supabase.rpc("pf_update_debt_v1", {
      target_debt_id: editingDebt.id,
      debt_creditor: creditor,
      debt_description: newDebtForm.description.trim(),
      debt_original_amount: originalAmount,
      debt_start_date: newDebtForm.startDate,
      debt_due_date: newDebtForm.dueDate,
      debt_installment_amount: installmentAmount > 0 ? installmentAmount : null,
      debt_interest_enabled: newDebtForm.interestEnabled,
      debt_auto_accrue_interest: newDebtForm.interestEnabled,
      debt_interest_rate: interestRate,
      debt_interest_period: newDebtForm.interestPeriod,
      debt_interest_method: newDebtForm.interestMethod,
    });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setShowNewDebt(false);
    setEditingDebt(null);
    await loadData();
    window.localStorage.setItem("pf:financial-data-version", String(Date.now()));
    window.dispatchEvent(new Event("pf:financial-data-changed"));
  }

  async function deleteDebt() {
    if (!debtToDelete) return;
    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    setSaving(true);
    setError(null);

    const result = await supabase.rpc("pf_delete_debt_v1", {
      target_debt_id: debtToDelete.id,
    });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setDebtToDelete(null);
    await loadData();
    window.localStorage.setItem("pf:financial-data-version", String(Date.now()));
    window.dispatchEvent(new Event("pf:financial-data-changed"));
  }

  function openPayment(debt: DebtProgress) {
    const installment = toNumber(debt.installment_amount);
    const balance = toNumber(debt.projected_balance);
    const suggested = installment > 0 ? Math.min(installment, balance) : balance;

    setSelectedDebt(debt);
    setPaymentForm({
      accountId: accounts[0]?.id ?? "",
      amount: suggested > 0 ? suggested.toFixed(2).replace(".", ",") : "",
      date: today(),
      countInstallment: false,
      notes: "",
    });
    setError(null);
  }

  async function registerPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDebt) return;

    const amount = parseAmount(paymentForm.amount);

    if (!paymentForm.accountId) {
      setError("Selecione a conta usada no pagamento.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Informe um valor de pagamento válido.");
      return;
    }

    if (amount > toNumber(selectedDebt.projected_balance) + 0.005) {
      setError("O pagamento não pode ser maior que o saldo atualizado.");
      return;
    }

    setSaving(true);
    setError(null);

    const result = await supabase.rpc("pf_register_debt_payment", {
      target_debt_id: selectedDebt.id,
      target_account_id: paymentForm.accountId,
      payment_amount: amount,
      payment_date: paymentForm.date,
      count_installment: paymentForm.countInstallment,
      payment_notes: paymentForm.notes.trim() || null,
    });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setSelectedDebt(null);
    await loadData();

    window.localStorage.setItem("pf:financial-data-version", String(Date.now()));
    window.dispatchEvent(new Event("pf:financial-data-changed"));
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
            Dívidas
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#3A3A3C]/65">
            {description}
          </p>
        </div>

        <button
          type="button"
          onClick={openNewDebt}
          disabled={!canWrite}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={16} />
          Nova dívida
        </button>
      </header>

      {error && !selectedDebt && !showNewDebt && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {unlinkedObligations.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
          <div className="flex items-start gap-3">
            <HandCoins size={20} className="mt-0.5 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-amber-950">
                Há lançamento em A pagar que ainda não está vinculado a uma dívida
              </h2>
              <p className="mt-1 text-xs leading-5 text-amber-900/70">
                Escolha a classificação. O lançamento continua em A pagar e passa a aparecer também no acompanhamento de dívidas.
              </p>
              <div className="mt-3 space-y-2">
                {unlinkedObligations.map((item) => (
                  <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#0D1B2A]">
                        {item.merchant || item.description}
                      </p>
                      <p className="mt-0.5 text-xs text-[#3A3A3C]/55">
                        {formatCurrency(item.amount)} · permanece em A pagar
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => void promoteObligation(item.id, "personal")} disabled={saving || !canWrite} className="h-9 rounded-lg border border-[#0D1B2A]/15 bg-white px-3 text-xs font-semibold text-[#0D1B2A] disabled:opacity-40">
                        Pessoal
                      </button>
                      <button type="button" onClick={() => void promoteObligation(item.id, "other")} disabled={saving || !canWrite} className="h-9 rounded-lg bg-[#0D1B2A] px-3 text-xs font-semibold text-white disabled:opacity-40">
                        Outras
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
        </div>
      ) : debts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-[#0D1B2A]/15 bg-white/70 px-6 py-14 text-center">
          <HandCoins size={38} className="mx-auto text-[#C8A15A]" />
          <h2 className="mt-4 text-lg font-semibold text-[#0D1B2A]">{emptyText}</h2>
          <p className="mt-2 text-sm text-[#3A3A3C]/55">
            Clique em Nova dívida para começar. O cadastro feito aqui entra diretamente no acompanhamento de dívidas.
          </p>
        </section>
      ) : (
        <section className="space-y-3">
          {debts.map((debt) => {
            const progress = clampPercentage(debt.progress_percentage);
            const interestAndFees =
              toNumber(debt.accrued_interest) +
              toNumber(debt.projected_penalty) +
              toNumber(debt.projected_late_interest);

            return (
              <article
                key={debt.id}
                className="rounded-2xl border border-[#0D1B2A]/10 bg-white px-4 py-3 shadow-sm"
              >
                <div className="grid gap-3 xl:grid-cols-[minmax(190px,1.1fr)_minmax(430px,2.3fr)_minmax(155px,0.8fr)_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-semibold text-[#0D1B2A]">
                        {debt.creditor}
                      </h2>
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                          statusClasses(debt.status),
                        ].join(" ")}
                      >
                        {statusLabel(debt.status)}
                      </span>
                      {debt.overdue_days > 0 && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-semibold text-red-700">
                          {debt.overdue_days} dias em atraso
                        </span>
                      )}
                    </div>
                    {debt.description && (
                      <p className="mt-1 truncate text-[11px] text-[#3A3A3C]/50">
                        {debt.description}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
                    <CompactMetric
                      label="Valor total"
                      value={formatCurrency(debt.original_amount)}
                    />
                    <CompactMetric
                      label="Já pago"
                      value={formatCurrency(debt.paid_amount)}
                      positive
                    />
                    <CompactMetric
                      label="Juros"
                      value={formatCurrency(interestAndFees)}
                      detail={
                        debt.interest_enabled
                          ? `${Number(debt.interest_rate || 0).toLocaleString("pt-BR")}% ${getInterestPeriodLabel(debt.interest_period)}`
                          : undefined
                      }
                    />
                    <CompactMetric
                      label="Mensalidade"
                      value={
                        toNumber(debt.installment_amount) > 0
                          ? formatCurrency(debt.installment_amount)
                          : "—"
                      }
                      detail={
                        debt.total_installments
                          ? `${debt.paid_installments}/${debt.total_installments} parcelas`
                          : undefined
                      }
                    />
                  </div>

                  <div className="xl:text-right">
                    <p className="text-[9px] uppercase tracking-wider text-[#3A3A3C]/40">
                      Falta pagar
                    </p>
                    <p className="mt-0.5 text-xl font-semibold text-red-800">
                      {formatCurrency(debt.projected_balance)}
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEditDebt(debt)}
                      disabled={!canWrite}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#0D1B2A]/10 bg-white text-[#0D1B2A] hover:bg-[#F7F5EF] disabled:opacity-40"
                      aria-label={`Editar dívida com ${debt.creditor}`}
                      title="Editar dívida"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setError(null); setDebtToDelete(debt); }}
                      disabled={!canWrite}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-40"
                      aria-label={`Excluir dívida com ${debt.creditor}`}
                      title="Excluir dívida"
                    >
                      <Trash2 size={14} />
                    </button>
                    {debt.status !== "paid" ? (
                      <button
                        type="button"
                        onClick={() => openPayment(debt)}
                        disabled={accounts.length === 0}
                        className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#0D1B2A] px-3 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        <WalletCards size={14} />
                        Registrar pagamento
                      </button>
                    ) : (
                      <span className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-emerald-50 px-3 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 size={14} />
                        Quitada
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#0D1B2A]/8">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[10px] font-semibold text-emerald-700">
                    {progress.toFixed(1)}%
                  </span>
                  <span
                    className={[
                      "hidden min-w-[150px] text-right text-[10px] sm:block",
                      toNumber(debt.daily_growth) > 0
                        ? "font-medium text-red-700"
                        : "text-[#3A3A3C]/45",
                    ].join(" ")}
                  >
                    {toNumber(debt.daily_growth) > 0
                      ? `+${formatCurrency(debt.daily_growth)}/dia`
                      : "Sem crescimento diário"}
                  </span>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {showNewDebt && (
        <div className="fixed inset-0 z-[300] overflow-y-auto bg-[#0D1B2A]/60 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center p-4 py-24">
            <div className="w-full max-w-2xl rounded-3xl border border-[#C8A15A]/20 bg-[#F7F5EF] shadow-2xl">
              <div className="flex items-start justify-between border-b border-[#0D1B2A]/10 px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C8A15A]">
                    {group === "personal" ? "Dívida pessoal" : "Outra dívida"}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#0D1B2A]">
                    {editingDebt ? "Editar dívida" : "Nova dívida"}
                  </h2>
                  <p className="mt-1 text-sm text-[#3A3A3C]/60">
                    {editingDebt
                      ? "Altere os dados da dívida. O lançamento vinculado em A pagar será atualizado junto."
                      : "Cadastre o saldo que você deve. Pagamentos serão registrados depois, sem duplicar a dívida."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { if (!saving) { setShowNewDebt(false); setEditingDebt(null); } }}
                  className="rounded-full p-2 text-[#3A3A3C]/60 hover:bg-white"
                  aria-label="Fechar"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={editingDebt ? updateDebt : createDebt} className="space-y-4 px-6 py-6">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Para quem você deve?</span>
                  <input
                    required
                    value={newDebtForm.creditor}
                    onChange={(event) =>
                      setNewDebtForm((current) => ({
                        ...current,
                        creditor: event.target.value,
                      }))
                    }
                    placeholder={group === "personal" ? "Ex.: Vanda" : "Ex.: Banco Santander"}
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium">Descrição <span className="font-normal text-[#3A3A3C]/45">(opcional)</span></span>
                  <input
                    value={newDebtForm.description}
                    onChange={(event) =>
                      setNewDebtForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Ex.: empréstimo pessoal"
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                  />
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Valor total</span>
                    <input
                      required
                      inputMode="decimal"
                      value={newDebtForm.originalAmount}
                      onChange={(event) =>
                        setNewDebtForm((current) => ({
                          ...current,
                          originalAmount: event.target.value,
                        }))
                      }
                      placeholder="0,00"
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Valor da mensalidade <span className="font-normal text-[#3A3A3C]/45">(opcional)</span></span>
                    <input
                      inputMode="decimal"
                      value={newDebtForm.installmentAmount}
                      onChange={(event) =>
                        setNewDebtForm((current) => ({
                          ...current,
                          installmentAmount: event.target.value,
                        }))
                      }
                      placeholder="0,00"
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                    />
                  </label>

{!editingDebt && (
                  <label className="block space-y-2 sm:col-span-2">
                    <span className="text-sm font-medium">Conta prevista para pagamento</span>
                    <select
                      required
                      value={newDebtForm.accountId}
                      onChange={(event) =>
                        setNewDebtForm((current) => ({
                          ...current,
                          accountId: event.target.value,
                        }))
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                    >
                      <option value="">Selecione</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </select>
                    <span className="block text-[11px] leading-4 text-[#3A3A3C]/45">
                      Define a conta da próxima obrigação exibida em A pagar.
                    </span>
                  </label>
                  )}

                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Data inicial</span>
                    <input
                      required
                      type="date"
                      value={newDebtForm.startDate}
                      onChange={(event) =>
                        setNewDebtForm((current) => ({
                          ...current,
                          startDate: event.target.value,
                        }))
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Próximo vencimento</span>
                    <input
                      required
                      type="date"
                      value={newDebtForm.dueDate}
                      onChange={(event) =>
                        setNewDebtForm((current) => ({
                          ...current,
                          dueDate: event.target.value,
                        }))
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>
                </div>

                <label className="flex items-center gap-3 rounded-xl border border-[#0D1B2A]/10 bg-white p-4">
                  <input
                    type="checkbox"
                    checked={newDebtForm.interestEnabled}
                    onChange={(event) =>
                      setNewDebtForm((current) => ({
                        ...current,
                        interestEnabled: event.target.checked,
                      }))
                    }
                    className="h-5 w-5 accent-[#0D1B2A]"
                  />
                  <div>
                    <p className="text-sm font-medium">Esta dívida possui juros</p>
                    <p className="mt-0.5 text-xs text-[#3A3A3C]/50">
                      O saldo será atualizado automaticamente conforme a taxa informada.
                    </p>
                  </div>
                </label>

                {newDebtForm.interestEnabled && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="block space-y-2">
                      <span className="text-sm font-medium">Taxa (%)</span>
                      <input
                        required
                        inputMode="decimal"
                        value={newDebtForm.interestRate}
                        onChange={(event) =>
                          setNewDebtForm((current) => ({
                            ...current,
                            interestRate: event.target.value,
                          }))
                        }
                        placeholder="1,00"
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-sm font-medium">Período</span>
                      <select
                        value={newDebtForm.interestPeriod}
                        onChange={(event) =>
                          setNewDebtForm((current) => ({
                            ...current,
                            interestPeriod: event.target.value as NewDebtForm["interestPeriod"],
                          }))
                        }
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                      >
                        <option value="daily">ao dia</option>
                        <option value="monthly">ao mês</option>
                        <option value="yearly">ao ano</option>
                      </select>
                    </label>

                    <label className="block space-y-2">
                      <span className="text-sm font-medium">Cálculo</span>
                      <select
                        value={newDebtForm.interestMethod}
                        onChange={(event) =>
                          setNewDebtForm((current) => ({
                            ...current,
                            interestMethod: event.target.value as NewDebtForm["interestMethod"],
                          }))
                        }
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                      >
                        <option value="simple">Juros simples</option>
                        <option value="compound">Juros compostos</option>
                      </select>
                    </label>
                  </div>
                )}

                {error && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingDebt ? (
                    <Pencil size={16} />
                  ) : (
                    <Plus size={16} />
                  )}
                  {editingDebt ? "Salvar alterações" : "Cadastrar dívida"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {debtToDelete && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-[#0D1B2A]/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-red-200 bg-[#F7F5EF] p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-50 p-2 text-red-700">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#0D1B2A]">Excluir esta dívida?</h2>
                <p className="mt-2 text-sm leading-6 text-[#3A3A3C]/65">
                  <strong>{debtToDelete.creditor}</strong> será removida do acompanhamento e o lançamento em A pagar criado junto com ela também será excluído.
                </p>
                <p className="mt-2 text-xs leading-5 text-[#3A3A3C]/50">
                  Por segurança, o sistema bloqueia a exclusão se já houver pagamentos ou outros movimentos financeiros reais.
                </p>
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { if (!saving) { setDebtToDelete(null); setError(null); } }}
                disabled={saving}
                className="h-10 rounded-xl border border-[#0D1B2A]/10 bg-white px-4 text-sm font-semibold text-[#0D1B2A] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void deleteDebt()}
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 size={15} />}
                Excluir dívida
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedDebt && (
        <div className="fixed inset-0 z-[250] overflow-y-auto bg-[#0D1B2A]/60 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center p-4 py-24">
            <div className="w-full max-w-xl rounded-3xl border border-[#C8A15A]/20 bg-[#F7F5EF] shadow-2xl">
              <div className="flex items-start justify-between border-b border-[#0D1B2A]/10 px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C8A15A]">
                    Pagamento de dívida
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#0D1B2A]">
                    {selectedDebt.creditor}
                  </h2>
                  <p className="mt-1 text-sm text-[#3A3A3C]/60">
                    Saldo atualizado: {formatCurrency(selectedDebt.projected_balance)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !saving && setSelectedDebt(null)}
                  className="rounded-full p-2 text-[#3A3A3C]/60 hover:bg-white"
                  aria-label="Fechar"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={registerPayment} className="space-y-4 px-6 py-6">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Conta usada no pagamento</span>
                  <select
                    required
                    value={paymentForm.accountId}
                    onChange={(event) =>
                      setPaymentForm((current) => ({
                        ...current,
                        accountId: event.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                  >
                    <option value="">Selecione</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} — {formatCurrency(account.balance)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Valor pago</span>
                    <input
                      required
                      inputMode="decimal"
                      value={paymentForm.amount}
                      onChange={(event) =>
                        setPaymentForm((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Data</span>
                    <input
                      required
                      type="date"
                      value={paymentForm.date}
                      onChange={(event) =>
                        setPaymentForm((current) => ({
                          ...current,
                          date: event.target.value,
                        }))
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>
                </div>

                {selectedDebt.installment_amount && selectedDebt.total_installments && (
                  <label className="flex items-center gap-3 rounded-xl border border-[#0D1B2A]/10 bg-white p-4">
                    <input
                      type="checkbox"
                      checked={paymentForm.countInstallment}
                      onChange={(event) =>
                        setPaymentForm((current) => ({
                          ...current,
                          countInstallment: event.target.checked,
                        }))
                      }
                      className="h-5 w-5 accent-[#0D1B2A]"
                    />
                    <div>
                      <p className="text-sm font-medium">Contar como parcela completa</p>
                      <p className="mt-0.5 text-xs text-[#3A3A3C]/50">
                        Marque apenas quando este pagamento quitar uma parcela inteira.
                      </p>
                    </div>
                  </label>
                )}

                <label className="block space-y-2">
                  <span className="text-sm font-medium">Observação</span>
                  <textarea
                    value={paymentForm.notes}
                    onChange={(event) =>
                      setPaymentForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    className="min-h-24 w-full rounded-xl border border-[#0D1B2A]/15 bg-white p-4 text-sm outline-none"
                  />
                </label>

                {error && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  Registrar pagamento
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompactMetric({
  label,
  value,
  detail,
  positive = false,
}: {
  label: string;
  value: string;
  detail?: string;
  positive?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wider text-[#3A3A3C]/40">
        {label}
      </p>
      <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5">
        <p
          className={[
            "truncate text-sm font-semibold",
            positive ? "text-emerald-700" : "text-[#0D1B2A]",
          ].join(" ")}
        >
          {value}
        </p>
        {detail && (
          <span className="hidden truncate text-[9px] text-[#3A3A3C]/40 2xl:inline">
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}
