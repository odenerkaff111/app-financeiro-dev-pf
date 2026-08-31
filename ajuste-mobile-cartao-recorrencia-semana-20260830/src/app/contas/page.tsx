"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Banknote,
  Building2,
  ChartNoAxesCombined,
  CircleDollarSign,
  CreditCard,
  Landmark,
  Loader2,
  Pencil,
  PiggyBank,
  Plus,
  Power,
  Trash2,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { supabase, getSessionOnce } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type AccountType =
  | "checking"
  | "savings"
  | "cash"
  | "wallet"
  | "credit_card"
  | "investment";

type AccountSource =
  | "manual"
  | "open_finance"
  | "import";

type Account = {
  id: string;
  household_id: string;
  owner_user_id: string | null;
  name: string;
  institution_name: string | null;
  type: AccountType;
  balance: number | string;
  credit_limit: number | string | null;
  available_credit: number | string | null;
  closing_day: number | null;
  due_day: number | null;
  source: AccountSource;
  external_id: string | null;
  is_shared: boolean;
  is_active: boolean;
  balance_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

type AccountForm = {
  name: string;
  institution_name: string;
  type: AccountType;
  balance: string;
  credit_limit: string;
  closing_day: string;
  due_day: string;
  is_shared: boolean;
  is_active: boolean;
};

type AccountTypeOption = {
  value: AccountType;
  label: string;
  description: string;
  icon: LucideIcon;
};

const ACCOUNT_TYPE_OPTIONS: AccountTypeOption[] = [
  {
    value: "checking",
    label: "Conta corrente",
    description: "Conta bancária usada no dia a dia",
    icon: Landmark,
  },
  {
    value: "savings",
    label: "Poupança",
    description: "Conta poupança ou reserva bancária",
    icon: PiggyBank,
  },
  {
    value: "cash",
    label: "Dinheiro",
    description: "Dinheiro guardado em espécie",
    icon: Banknote,
  },
  {
    value: "wallet",
    label: "Carteira digital",
    description: "Mercado Pago, PicPay e similares",
    icon: WalletCards,
  },
  {
    value: "credit_card",
    label: "Cartão de crédito",
    description: "Cartão, limite e fatura atual",
    icon: CreditCard,
  },
  {
    value: "investment",
    label: "Investimento",
    description: "Corretora, Tesouro, CDB e similares",
    icon: ChartNoAxesCombined,
  },
];

const EMPTY_FORM: AccountForm = {
  name: "",
  institution_name: "",
  type: "checking",
  balance: "0",
  credit_limit: "",
  closing_day: "",
  due_day: "",
  is_shared: true,
  is_active: true,
};

function parseAmount(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return 0;
  }

  const normalizedValue = trimmedValue.includes(",")
    ? trimmedValue
        .replace(/\./g, "")
        .replace(",", ".")
    : trimmedValue;

  return Number(normalizedValue);
}

function parseOptionalInteger(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsedValue = Number.parseInt(value, 10);

  return Number.isFinite(parsedValue)
    ? parsedValue
    : null;
}

function formatCurrency(value: number | string | null) {
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

function getAccountTypeMeta(type: AccountType) {
  return (
    ACCOUNT_TYPE_OPTIONS.find(
      (option) => option.value === type,
    ) ?? ACCOUNT_TYPE_OPTIONS[0]
  );
}

export default function AccountsPage() {
  const { household, canWrite } = useHousehold();

  const [accounts, setAccounts] = useState<Account[]>(
    [],
  );

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(
    null,
  );

  const [modalOpen, setModalOpen] = useState(false);

  const [editingAccount, setEditingAccount] =
    useState<Account | null>(null);

  const [creditUpdateAccount, setCreditUpdateAccount] =
    useState<Account | null>(null);
  const [creditPaidAmount, setCreditPaidAmount] = useState("");
  const [creditReleasedAmount, setCreditReleasedAmount] = useState("");
  const [updatingCredit, setUpdatingCredit] = useState(false);

  const [form, setForm] = useState<AccountForm>({
    ...EMPTY_FORM,
  });

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: accountsError } =
      await supabase
        .from("pf_accounts")
        .select("*")
        .eq("household_id", household.id)
        .order("is_active", {
          ascending: false,
        })
        .order("created_at", {
          ascending: true,
        });

    if (accountsError) {
      console.error(
        "Erro ao carregar contas:",
        accountsError,
      );

      setError(
        "Não foi possível carregar suas contas.",
      );

      setLoading(false);
      return;
    }

    setAccounts((data ?? []) as Account[]);
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    let active = true;

    async function initializePage() {
      const {
        data: { session },
        error: sessionError,
      } = await getSessionOnce();

      if (!active) {
        return;
      }

      if (sessionError || !session) {
        console.error(
          "Erro ao obter usuário:",
          sessionError,
        );

        setError(
          "Não foi possível identificar o usuário logado.",
        );

        setLoading(false);
        return;
      }

      setCurrentUserId(session.user.id);

      await loadAccounts();
    }

    void initializePage();

    return () => {
      active = false;
    };
  }, [loadAccounts]);


  function updateForm<K extends keyof AccountForm>(
    field: K,
    value: AccountForm[K],
  ) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function openCreateModal() {
    setEditingAccount(null);

    setForm({
      ...EMPTY_FORM,
    });

    setError(null);
    setModalOpen(true);
  }

  function openEditModal(account: Account) {
    setEditingAccount(account);

    setForm({
      name: account.name,
      institution_name:
        account.institution_name ?? "",
      type: account.type,
      balance: String(account.balance ?? 0),
      credit_limit:
        account.credit_limit === null
          ? ""
          : String(account.credit_limit),
      closing_day:
        account.closing_day === null
          ? ""
          : String(account.closing_day),
      due_day:
        account.due_day === null
          ? ""
          : String(account.due_day),
      is_shared: account.is_shared,
      is_active: account.is_active,
    });

    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) {
      return;
    }

    setModalOpen(false);
    setEditingAccount(null);

    setForm({
      ...EMPTY_FORM,
    });

    setError(null);
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!currentUserId) {
      setError(
        "O usuário logado ainda não foi identificado.",
      );

      return;
    }

    if (!form.name.trim()) {
      setError("Informe o nome da conta.");

      return;
    }

    const parsedBalance = parseAmount(form.balance);

    const parsedCreditLimit = parseAmount(
      form.credit_limit,
    );

    if (!Number.isFinite(parsedBalance)) {
      setError("Informe um saldo válido.");

      return;
    }

    if (
      form.type === "credit_card" &&
      !Number.isFinite(parsedCreditLimit)
    ) {
      setError(
        "Informe um limite válido para o cartão.",
      );

      return;
    }

    const closingDay = parseOptionalInteger(
      form.closing_day,
    );

    const dueDay = parseOptionalInteger(
      form.due_day,
    );

    if (
      closingDay !== null &&
      (closingDay < 1 || closingDay > 31)
    ) {
      setError(
        "O dia de fechamento precisa estar entre 1 e 31.",
      );

      return;
    }

    if (
      dueDay !== null &&
      (dueDay < 1 || dueDay > 31)
    ) {
      setError(
        "O dia de vencimento precisa estar entre 1 e 31.",
      );

      return;
    }

    setSaving(true);
    setError(null);

    const isCreditCard =
      form.type === "credit_card";

    const payload = {
      household_id: household.id,
      owner_user_id: currentUserId,
      name: form.name.trim(),
      institution_name:
        form.institution_name.trim() || null,
      type: form.type,
      balance: parsedBalance,
      credit_limit: isCreditCard
        ? parsedCreditLimit
        : null,
      available_credit: isCreditCard
        ? Math.max(
            0,
            Math.min(
              parsedCreditLimit,
              editingAccount?.available_credit === null ||
                editingAccount?.available_credit === undefined
                ? parsedCreditLimit - parsedBalance
                : Number(editingAccount.available_credit),
            ),
          )
        : null,
      closing_day: isCreditCard
        ? closingDay
        : null,
      due_day: isCreditCard
        ? dueDay
        : null,
      source:
        editingAccount?.source ?? "manual",
      is_shared: form.is_shared,
      is_active: form.is_active,
      balance_updated_at:
        new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = editingAccount
      ? await supabase
          .from("pf_accounts")
          .update(payload)
          .eq("id", editingAccount.id)
          .eq("household_id", household.id)
      : await supabase
          .from("pf_accounts")
          .insert(payload);

    if (result.error) {
      console.error(
        "Erro ao salvar conta:",
        result.error,
      );

      setError(
        result.error.message ||
          "Não foi possível salvar a conta.",
      );

      setSaving(false);
      return;
    }

    setSaving(false);
    closeModal();

    await loadAccounts();
  }

  function openCreditUpdate(account: Account) {
    const currentBill = Math.max(0, Number(account.balance || 0));
    const suggested = currentBill > 0 ? currentBill : 0;

    setCreditUpdateAccount(account);
    setCreditPaidAmount(String(suggested).replace(".", ","));
    setCreditReleasedAmount(String(suggested).replace(".", ","));
    setError(null);
  }

  async function saveCreditUpdate() {
    if (!creditUpdateAccount || !canWrite) return;

    const paidAmount = parseAmount(creditPaidAmount);
    const releasedAmount = parseAmount(creditReleasedAmount);
    const creditLimit = Number(creditUpdateAccount.credit_limit || 0);
    const currentBill = Math.max(0, Number(creditUpdateAccount.balance || 0));
    const currentAvailable =
      creditUpdateAccount.available_credit === null ||
      creditUpdateAccount.available_credit === undefined
        ? Math.max(creditLimit - currentBill, 0)
        : Math.max(0, Number(creditUpdateAccount.available_credit));

    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      setError("Informe um valor pago válido.");
      return;
    }

    if (!Number.isFinite(releasedAmount) || releasedAmount < 0) {
      setError("Informe quanto de limite foi efetivamente liberado.");
      return;
    }

    const nextBill = Math.max(0, currentBill - paidAmount);
    const nextAvailable = Math.max(
      0,
      Math.min(creditLimit || Number.MAX_SAFE_INTEGER, currentAvailable + releasedAmount),
    );

    setUpdatingCredit(true);
    setError(null);

    const result = await supabase
      .from("pf_accounts")
      .update({
        balance: nextBill,
        available_credit: nextAvailable,
        balance_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", creditUpdateAccount.id)
      .eq("household_id", household.id);

    if (result.error) {
      setError(result.error.message || "Não foi possível atualizar o cartão.");
      setUpdatingCredit(false);
      return;
    }

    setUpdatingCredit(false);
    setCreditUpdateAccount(null);
    await loadAccounts();
  }

  async function toggleAccountStatus(
    account: Account,
  ) {
    const { error: updateError } =
      await supabase
        .from("pf_accounts")
        .update({
          is_active: !account.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id)
        .eq("household_id", household.id);

    if (updateError) {
      console.error(
        "Erro ao alterar conta:",
        updateError,
      );

      setError(
        "Não foi possível alterar o status da conta.",
      );

      return;
    }

    await loadAccounts();
  }

  async function deleteAccount(
    account: Account,
  ) {
    const confirmed = window.confirm(
      `Deseja realmente excluir "${account.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    const { error: deleteError } =
      await supabase
        .from("pf_accounts")
        .delete()
        .eq("id", account.id)
        .eq("household_id", household.id);

    if (deleteError) {
      console.error(
        "Erro ao excluir conta:",
        deleteError,
      );

      setError(
        "Não foi possível excluir a conta. Ela pode possuir movimentações vinculadas.",
      );

      return;
    }

    await loadAccounts();
  }

  return (
    <div className="space-y-6 pb-10">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
            Organização financeira
          </p>

          <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
            Contas e cartões
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/70">
            Registre onde seu dinheiro está,
            seus cartões e seus investimentos.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-5 text-sm font-semibold text-[#F7F5EF] shadow-lg transition hover:-translate-y-0.5 hover:bg-[#172D43]"
        >
          <Plus size={18} />

          Nova conta
        </button>
      </section>

      {error && !modalOpen && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
        </div>
      ) : accounts.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-[#0D1B2A]/20 bg-white/70 px-6 py-16 text-center">
          <CircleDollarSign
            size={38}
            className="mx-auto text-[#C8A15A]"
          />

          <h2 className="mt-4 text-xl font-semibold text-[#0D1B2A]">
            Nenhuma conta cadastrada
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#3A3A3C]/65">
            Cadastre sua primeira conta,
            cartão, dinheiro ou investimento.
          </p>

          <button
            type="button"
            onClick={openCreateModal}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#0D1B2A] px-5 py-3 text-sm font-semibold text-[#F7F5EF]"
          >
            <Plus size={18} />

            Criar primeira conta
          </button>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => {
            const typeMeta = getAccountTypeMeta(
              account.type,
            );

            const Icon = typeMeta.icon;

            const valueLabel =
              account.type === "credit_card"
                ? "Fatura atual"
                : account.type === "investment"
                  ? "Total investido"
                  : "Saldo atual";

            return (
              <article
                key={account.id}
                className={[
                  "rounded-2xl border bg-white p-5 shadow-sm transition",
                  account.is_active
                    ? "border-[#0D1B2A]/10"
                    : "border-[#0D1B2A]/5 opacity-60",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0D1B2A] text-[#F7F5EF]">
                      <Icon size={21} />
                    </div>

                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-[#0D1B2A]">
                        {account.name}
                      </h2>

                      <p className="mt-0.5 truncate text-xs text-[#3A3A3C]/60">
                        {account.institution_name ||
                          typeMeta.label}
                      </p>
                    </div>
                  </div>

                  <span
                    className={[
                      "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
                      account.is_active
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-gray-100 text-gray-500",
                    ].join(" ")}
                  >
                    {account.is_active
                      ? "Ativa"
                      : "Inativa"}
                  </span>
                </div>

                <div className="mt-6">
                  <p className="text-xs text-[#3A3A3C]/60">
                    {valueLabel}
                  </p>

                  <p
                    className={[
                      "mt-1 text-2xl font-semibold",
                      account.type ===
                        "credit_card"
                        ? "text-red-700"
                        : "text-[#0D1B2A]",
                    ].join(" ")}
                  >
                    {formatCurrency(account.balance)}
                  </p>
                </div>

                {account.type === "credit_card" && (
                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-[#F7F5EF] p-3 text-center sm:grid-cols-4">
                    <div>
                      <p className="text-[10px] uppercase text-[#3A3A3C]/55">
                        Limite
                      </p>

                      <p className="mt-1 text-xs font-semibold text-[#0D1B2A]">
                        {formatCurrency(
                          account.credit_limit,
                        )}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase text-[#3A3A3C]/55">
                        Disponível
                      </p>

                      <p className="mt-1 text-xs font-semibold text-emerald-700">
                        {formatCurrency(
                          account.available_credit ??
                            Math.max(
                              Number(account.credit_limit || 0) -
                                Number(account.balance || 0),
                              0,
                            ),
                        )}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase text-[#3A3A3C]/55">
                        Fecha
                      </p>

                      <p className="mt-1 text-xs font-semibold text-[#0D1B2A]">
                        {account.closing_day
                          ? `Dia ${account.closing_day}`
                          : "â€”"}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase text-[#3A3A3C]/55">
                        Vence
                      </p>

                      <p className="mt-1 text-xs font-semibold text-[#0D1B2A]">
                        {account.due_day
                          ? `Dia ${account.due_day}`
                          : "â€”"}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-[#0D1B2A]/8 pt-4">
                  <span className="text-xs text-[#3A3A3C]/55">
                    {account.is_shared
                      ? "Compartilhada com a família"
                      : "Conta pessoal"}
                  </span>

                  <div className="flex items-center gap-1">
                    {account.type === "credit_card" && (
                      <button
                        type="button"
                        onClick={() => openCreditUpdate(account)}
                        disabled={!canWrite}
                        className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[#8A6426] transition hover:bg-[#C8A15A]/10 disabled:opacity-40"
                        title="Confirmar fatura paga e limite liberado"
                      >
                        Atualizar limite
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void toggleAccountStatus(
                          account,
                        )
                      }
                      className="rounded-lg p-2 text-[#3A3A3C]/55 transition hover:bg-[#F7F5EF] hover:text-[#0D1B2A]"
                      title={
                        account.is_active
                          ? "Desativar"
                          : "Ativar"
                      }
                    >
                      <Power size={16} />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        openEditModal(account)
                      }
                      className="rounded-lg p-2 text-[#3A3A3C]/55 transition hover:bg-[#F7F5EF] hover:text-[#0D1B2A]"
                      title="Editar"
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void deleteAccount(account)
                      }
                      className="rounded-lg p-2 text-[#3A3A3C]/55 transition hover:bg-red-50 hover:text-red-700"
                      title="Excluir"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {creditUpdateAccount && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center overflow-y-auto bg-[#0D1B2A]/55 p-3 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#C8A15A]/25 bg-[#F7F5EF] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C8A15A]">
                  Cartão de crédito
                </p>
                <h2 className="mt-1 text-xl font-semibold text-[#0D1B2A]">
                  Atualizar após pagamento
                </h2>
                <p className="mt-1 text-xs leading-5 text-[#3A3A3C]/60">
                  {creditUpdateAccount.name} · {creditUpdateAccount.institution_name || "Cartão"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreditUpdateAccount(null)}
                disabled={updatingCredit}
                className="rounded-full p-2 text-[#3A3A3C]/60 hover:bg-white"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-[#0D1B2A]">Valor pago da fatura</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={creditPaidAmount}
                  onChange={(event) => {
                    setCreditPaidAmount(event.target.value);
                    setCreditReleasedAmount(event.target.value);
                  }}
                  className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-[#0D1B2A]">Quanto de limite foi liberado?</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={creditReleasedAmount}
                  onChange={(event) => setCreditReleasedAmount(event.target.value)}
                  className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                />
                <span className="block text-[11px] leading-5 text-[#3A3A3C]/55">
                  O sistema sugere o mesmo valor pago, mas você pode corrigir se o banco tiver liberado outro valor. Esta ação só ajusta a fatura e o limite do cartão; não cria uma segunda saída financeira.
                </span>
              </label>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setCreditUpdateAccount(null)}
                  disabled={updatingCredit}
                  className="h-10 rounded-xl border border-[#0D1B2A]/15 px-4 text-sm font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void saveCreditUpdate()}
                  disabled={updatingCredit}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {updatingCredit && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirmar atualização
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-[#0D1B2A]/55 p-3 backdrop-blur-sm sm:p-4">
          <div className="my-6 w-full max-w-2xl rounded-3xl border border-[#C8A15A]/25 bg-[#F7F5EF] p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
                  {editingAccount
                    ? "Editar cadastro"
                    : "Novo cadastro"}
                </p>

                <h2 className="mt-2 text-2xl font-semibold text-[#0D1B2A]">
                  {editingAccount
                    ? "Editar conta"
                    : "Adicionar conta ou cartão"}
                </h2>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-full p-2 text-[#3A3A3C]/60 transition hover:bg-white hover:text-[#0D1B2A]"
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="mt-7 space-y-5"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    Nome da conta
                  </span>

                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(event) =>
                      updateForm(
                        "name",
                        event.target.value,
                      )
                    }
                    placeholder="Ex.: Santander principal"
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    Instituição
                  </span>

                  <input
                    type="text"
                    value={form.institution_name}
                    onChange={(event) =>
                      updateForm(
                        "institution_name",
                        event.target.value,
                      )
                    }
                    placeholder="Ex.: Santander"
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                  />
                </label>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[#0D1B2A]">
                  Tipo
                </span>

                <select
                  value={form.type}
                  onChange={(event) =>
                    updateForm(
                      "type",
                      event.target
                        .value as AccountType,
                    )
                  }
                  className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                >
                  {ACCOUNT_TYPE_OPTIONS.map(
                    (option) => (
                      <option
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    {form.type === "credit_card"
                      ? "Fatura atual"
                      : form.type === "investment"
                        ? "Valor investido"
                        : "Saldo atual"}
                  </span>

                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.balance}
                    onChange={(event) =>
                      updateForm(
                        "balance",
                        event.target.value,
                      )
                    }
                    placeholder="0,00"
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                  />
                </label>

                {form.type === "credit_card" && (
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Limite total
                    </span>

                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.credit_limit}
                      onChange={(event) =>
                        updateForm(
                          "credit_limit",
                          event.target.value,
                        )
                      }
                      placeholder="0,00"
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                    />
                  </label>
                )}
              </div>

              {form.type === "credit_card" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Dia de fechamento
                    </span>

                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={form.closing_day}
                      onChange={(event) =>
                        updateForm(
                          "closing_day",
                          event.target.value,
                        )
                      }
                      placeholder="Ex.: 5"
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Dia de vencimento
                    </span>

                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={form.due_day}
                      onChange={(event) =>
                        updateForm(
                          "due_day",
                          event.target.value,
                        )
                      }
                      placeholder="Ex.: 12"
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                    />
                  </label>
                </div>
              )}

              <div className="space-y-3 rounded-2xl border border-[#0D1B2A]/10 bg-white/70 p-4">
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#0D1B2A]">
                      Compartilhar com a família
                    </p>

                    <p className="mt-1 text-xs text-[#3A3A3C]/60">
                      Você e sua esposa poderão visualizar esta conta.
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={form.is_shared}
                    onChange={(event) =>
                      updateForm(
                        "is_shared",
                        event.target.checked,
                      )
                    }
                    className="h-5 w-5 accent-[#0D1B2A]"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-[#0D1B2A]/8 pt-3">
                  <div>
                    <p className="text-sm font-medium text-[#0D1B2A]">
                      Conta ativa
                    </p>

                    <p className="mt-1 text-xs text-[#3A3A3C]/60">
                      Contas inativas não entram nos totais.
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) =>
                      updateForm(
                        "is_active",
                        event.target.checked,
                      )
                    }
                    className="h-5 w-5 accent-[#0D1B2A]"
                  />
                </label>
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
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
                  disabled={saving}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-6 text-sm font-semibold text-[#F7F5EF] transition hover:bg-[#172D43] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}

                  {editingAccount
                    ? "Salvar alterações"
                    : "Criar conta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}