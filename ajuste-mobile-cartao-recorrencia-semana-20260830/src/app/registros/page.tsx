"use client";

import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowRightLeft,
  CircleDollarSign,
  Landmark,
  Loader2,
  Pencil,
  PiggyBank,
  Plus,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
  type LucideIcon,
  HandCoins,
} from "lucide-react";
import {
  format,
  isSameMonth,
  isSameWeek,
  isSameYear,
  parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase, getSessionOnce } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";
import { UnifiedFinancialEntryModal } from "@/components/finance/UnifiedFinancialEntryModal";

type AccountType =
  | "checking"
  | "savings"
  | "cash"
  | "wallet"
  | "credit_card"
  | "investment";

type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "investment_contribution"
  | "investment_withdrawal";

type TransactionStatus =
  | "planned"
  | "paid"
  | "overdue"
  | "cancelled";

type TransactionSource =
  | "manual"
  | "ai"
  | "open_finance"
  | "import";

type CategoryKind =
  | "income"
  | "expense"
  | "debt"
  | "investment";

type Account = {
  id: string;
  household_id: string;
  owner_user_id: string | null;
  name: string;
  institution_name: string | null;
  type: AccountType;
  balance: number | string;
  is_active: boolean;
};

type Category = {
  id: string;
  household_id: string;
  name: string;
  kind: CategoryKind;
  group_type: string;
};

type Transaction = {
  id: string;
  household_id: string;
  account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  debt_id: string | null;
  created_by: string;
  responsible_user_id: string | null;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  merchant: string | null;
  amount: number | string;
  original_amount: number | string | null;
  occurred_on: string;
  due_date: string | null;
  paid_at: string | null;
  source: TransactionSource;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type TransactionForm = {
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  merchant: string;
  amount: string;
  account_id: string;
  destination_account_id: string;
  category_id: string;
  occurred_on: string;
  due_date: string;
  notes: string;
};

type TypeOption = {
  value: TransactionType;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
};


const TYPE_OPTIONS: TypeOption[] = [
  {
    value: "income",
    label: "Receita",
    shortLabel: "Entrada",
    icon: TrendingUp,
  },
  {
    value: "expense",
    label: "Despesa",
    shortLabel: "Saída",
    icon: TrendingDown,
  },
  {
    value: "transfer",
    label: "Transferência",
    shortLabel: "Transferência",
    icon: ArrowRightLeft,
  },
  {
    value: "investment_contribution",
    label: "Aporte em investimento",
    shortLabel: "Aporte",
    icon: PiggyBank,
  },
  {
    value: "investment_withdrawal",
    label: "Resgate de investimento",
    shortLabel: "Resgate",
    icon: TrendingUp,
  },
];


const MERCHANT_OPTIONS = [
  // Pessoas para quem existem dívidas pessoais
  "SAMUEL",
  "VALDETE",
  "GU",
  "DIRCE",
  "ATLIMARJOM",
  "MARCELA",
  "JOSÉ GERALDO",
  "MARIA",
  "VANDA",
  "Mary",

  // Moradia e contas da casa
  "Sr. Jurandir",
  "Copasa",
  "Cemig",
  "Vanete",

  // Educação
  "Ipê Amarelo",

  // Renda
  "Power of Data",

  // Supermercados e compras
  "Supernosso",
  "Verdemar",
  "ABC",
  "Atacadão",
  "Mercado Livre",
  "Amazon",

  // Cuidados pessoais e saúde
  "Ricoy Barber",
  "Allp Fit",

  // Transporte e financiamento
  "Uber",
  "BV",

  // Investimentos
  "Rico",

  // Empréstimos e crédito
  "Blipay",
  "Ágil",
  "Zippi",
  "Brasilcard",
  "Facio",
].sort((first, second) =>
  first.localeCompare(second, "pt-BR"),
);

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getMonthKey(offset = 0) {
  const reference = new Date();
  reference.setDate(1);
  reference.setMonth(reference.getMonth() + offset);
  return `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
}

function createEmptyForm(): TransactionForm {
  const today = getToday();

  return {
    type: "expense",
    status: "paid",
    description: "",
    merchant: "",
    amount: "",
    account_id: "",
    destination_account_id: "",
    category_id: "",
    occurred_on: today,
    due_date: today,
    notes: "",
  };
}


function parseAmount(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return Number.NaN;
  }

  const normalizedValue = trimmedValue.includes(",")
    ? trimmedValue
        .replace(/\./g, "")
        .replace(",", ".")
    : trimmedValue;

  return Number(normalizedValue);
}

function formatCurrency(value: number | string | null) {
  const numberValue = Number(value ?? 0);

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(
    Number.isFinite(numberValue)
      ? numberValue
      : 0,
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  try {
    return format(parseISO(value), "dd/MM/yyyy", {
      locale: ptBR,
    });
  } catch {
    return value;
  }
}

function getTypeOption(type: TransactionType | string): TypeOption {
  if (type === "debt_payment") {
    return {
      value: "expense",
      label: "Pagamento de dívida",
      shortLabel: "Saída",
      icon: TrendingDown,
    };
  }

  if (type === "debt_received") {
    return {
      value: "income",
      label: "Empréstimo recebido",
      shortLabel: "Empréstimo",
      icon: HandCoins,
    };
  }

  return (
    TYPE_OPTIONS.find(
      (option) => option.value === type,
    ) ?? TYPE_OPTIONS[0]
  );
}

function getEffectiveStatus(
  transaction: Transaction,
): TransactionStatus {
  const today = getToday();

  if (
    transaction.status === "planned" &&
    transaction.due_date &&
    transaction.due_date < today
  ) {
    return "overdue";
  }

  return transaction.status;
}

function getStatusLabel(status: TransactionStatus) {
  const labels: Record<TransactionStatus, string> = {
    planned: "Planejado",
    paid: "Realizado",
    overdue: "Atrasado",
    cancelled: "Cancelado",
  };

  return labels[status];
}

function getStatusClasses(status: TransactionStatus) {
  const classes: Record<TransactionStatus, string> = {
    planned: "bg-amber-50 text-amber-700",
    paid: "bg-emerald-50 text-emerald-700",
    overdue: "bg-red-50 text-red-700",
    cancelled: "bg-gray-100 text-gray-500",
  };

  return classes[status];
}

function getAmountClasses(type: TransactionType | string) {
  if (type === "income" || type === "debt_received") {
    return "text-emerald-700";
  }

  if (type === "expense" || type === "debt_payment") {
    return "text-red-700";
  }

  return "text-[#0D1B2A]";
}

function getAmountPrefix(type: TransactionType | string) {
  if (type === "income" || type === "debt_received") {
    return "+";
  }

  if (type === "expense" || type === "debt_payment") {
    return "−";
  }

  return "";
}

export default function TransactionsPage() {
  const { household, canWrite } = useHousehold();

  const [transactions, setTransactions] = useState<
    Transaction[]
  >([]);

  const [accounts, setAccounts] = useState<Account[]>(
    [],
  );

  const [categories, setCategories] = useState<
    Category[]
  >([]);

  const [currentUserId, setCurrentUserId] = useState<
    string | null
  >(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [pageError, setPageError] = useState<
    string | null
  >(null);

  const [modalError, setModalError] = useState<
    string | null
  >(null);

  const [modalOpen, setModalOpen] = useState(false);

  const [unifiedModalOpen, setUnifiedModalOpen] = useState(false);

  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);

  const [form, setForm] = useState<TransactionForm>(
    createEmptyForm(),
  );

  const [search, setSearch] = useState("");

  const [periodFilter, setPeriodFilter] = useState<
    "week" | "month" | "next_month" | "year" | "custom" | "all"
  >("month");
  const [customStart, setCustomStart] = useState(getToday());
  const [customEnd, setCustomEnd] = useState(getToday());

  const [typeFilter, setTypeFilter] = useState<
    "all" | TransactionType
  >("all");

  const [statusFilter, setStatusFilter] = useState<
    "all" | TransactionStatus
  >("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    setPageError(null);

    const recurringGenerations = await Promise.all([
      supabase.rpc("pf_generate_recurring_transactions", {
        target_month: `${getMonthKey()}-01`,
      }),
      supabase.rpc("pf_generate_recurring_transactions", {
        target_month: `${getMonthKey(1)}-01`,
      }),
    ]);

    recurringGenerations.forEach((generation, index) => {
      if (generation.error) {
        console.warn(
          `Não foi possível gerar recorrências do ${index === 0 ? "mês atual" : "próximo mês"}:`,
          generation.error,
        );
      }
    });

    const [
      sessionResult,
      accountsResult,
      categoriesResult,
      transactionsResult,
    ] = await Promise.all([
      getSessionOnce(),

      supabase
        .from("pf_accounts")
        .select(
          "id, household_id, owner_user_id, name, institution_name, type, balance, is_active",
        )
        .eq("household_id", household.id)
        .order("is_active", {
          ascending: false,
        })
        .order("name", {
          ascending: true,
        }),

      supabase
        .from("pf_categories")
        .select(
          "id, household_id, name, kind, group_type",
        )
        .eq("household_id", household.id)
        .order("name", {
          ascending: true,
        }),

      supabase
        .from("pf_transactions")
        .select("*")
        .eq("household_id", household.id)
        .order("occurred_on", {
          ascending: false,
        })
        .order("created_at", {
          ascending: false,
        }),
    ]);

    if (
      sessionResult.error ||
      !sessionResult.data.session
    ) {
      setPageError(
        "Não foi possível identificar o usuário logado.",
      );

      setLoading(false);
      return;
    }

    if (accountsResult.error) {
      console.error(
        "Erro ao carregar contas:",
        accountsResult.error,
      );

      setPageError(
        "Não foi possível carregar suas contas.",
      );

      setLoading(false);
      return;
    }

    if (categoriesResult.error) {
      console.error(
        "Erro ao carregar categorias:",
        categoriesResult.error,
      );

      setPageError(
        "Não foi possível carregar as categorias.",
      );

      setLoading(false);
      return;
    }

    if (transactionsResult.error) {
      console.error(
        "Erro ao carregar movimentações:",
        transactionsResult.error,
      );

      setPageError(
        "Não foi possível carregar as movimentações.",
      );

      setLoading(false);
      return;
    }

    setCurrentUserId(
      sessionResult.data.session.user.id,
    );

    setAccounts(
      (accountsResult.data ?? []) as Account[],
    );

    setCategories(
      (categoriesResult.data ?? []) as Category[],
    );

    setTransactions(
      (transactionsResult.data ?? []) as Transaction[],
    );

    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const accountMap = useMemo(() => {
    return new Map(
      accounts.map((account) => [
        account.id,
        account,
      ]),
    );
  }, [accounts]);

  const categoryMap = useMemo(() => {
    return new Map(
      categories.map((category) => [
        category.id,
        category,
      ]),
    );
  }, [categories]);

  const filteredTransactions = useMemo(() => {
    const today = new Date();

    const normalizedSearch = search
      .trim()
      .toLowerCase();

    const filtered = transactions.filter((transaction) => {
      const account = transaction.account_id
        ? accountMap.get(transaction.account_id)
        : undefined;

      const category = transaction.category_id
        ? categoryMap.get(transaction.category_id)
        : null;

      const searchableText = [
        transaction.description,
        transaction.merchant,
        transaction.notes,
        account?.name,
        account?.institution_name,
        category?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (
        normalizedSearch &&
        !searchableText.includes(normalizedSearch)
      ) {
        return false;
      }

      if (typeFilter !== "all") {
        const matchesType =
          typeFilter === "expense"
            ? ["expense", "debt_payment"].includes(String(transaction.type))
            : typeFilter === "income"
              ? ["income", "debt_received"].includes(String(transaction.type))
              : transaction.type === typeFilter;

        if (!matchesType) {
          return false;
        }
      }

      const effectiveStatus =
        getEffectiveStatus(transaction);

      if (
        statusFilter !== "all" &&
        effectiveStatus !== statusFilter
      ) {
        return false;
      }

      if (periodFilter === "all") {
        return true;
      }

      try {
        const referenceDate =
          effectiveStatus === "planned" || effectiveStatus === "overdue"
            ? transaction.due_date ?? transaction.occurred_on
            : transaction.occurred_on;
        const transactionDate = parseISO(referenceDate);

        if (periodFilter === "week") {
          return isSameWeek(transactionDate, today, {
            weekStartsOn: 0,
          });
        }

        if (periodFilter === "month") {
          return isSameMonth(
            transactionDate,
            today,
          );
        }

        if (periodFilter === "next_month") {
          return referenceDate.slice(0, 7) === getMonthKey(1);
        }

        if (periodFilter === "year") {
          return isSameYear(
            transactionDate,
            today,
          );
        }

        if (periodFilter === "custom") {
          if (!customStart || !customEnd || customStart > customEnd) {
            return false;
          }

          return referenceDate >= customStart && referenceDate <= customEnd;
        }
      } catch {
        return true;
      }

      return true;
    });

    return filtered.sort((first, second) => {
      const firstStatus = getEffectiveStatus(first);
      const secondStatus = getEffectiveStatus(second);
      const firstReference =
        firstStatus === "planned" || firstStatus === "overdue"
          ? first.due_date ?? first.occurred_on
          : first.occurred_on;
      const secondReference =
        secondStatus === "planned" || secondStatus === "overdue"
          ? second.due_date ?? second.occurred_on
          : second.occurred_on;

      return secondReference.localeCompare(firstReference);
    });
  }, [
    transactions,
    accountMap,
    categoryMap,
    search,
    typeFilter,
    statusFilter,
    periodFilter,
    customStart,
    customEnd,
  ]);

  const activeAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.is_active,
      ),
    [accounts],
  );

  const selectableAccounts = useMemo(() => {
    return accounts.filter(
      (account) =>
        account.is_active ||
        account.id === form.account_id ||
        account.id ===
          form.destination_account_id,
    );
  }, [
    accounts,
    form.account_id,
    form.destination_account_id,
  ]);

  const sourceAccountOptions = useMemo(() => {
    if (form.type === "income") {
      return selectableAccounts.filter(
        (account) =>
          account.type !== "credit_card",
      );
    }

    if (
      form.type === "investment_contribution"
    ) {
      return selectableAccounts.filter(
        (account) =>
          account.type !== "investment",
      );
    }

    if (
      form.type === "investment_withdrawal"
    ) {
      return selectableAccounts.filter(
        (account) =>
          account.type === "investment",
      );
    }

    return selectableAccounts;
  }, [selectableAccounts, form.type]);

  const destinationAccountOptions = useMemo(() => {
    if (
      form.type === "investment_contribution"
    ) {
      return selectableAccounts.filter(
        (account) =>
          account.type === "investment" &&
          account.id !== form.account_id,
      );
    }

    if (
      form.type === "investment_withdrawal"
    ) {
      return selectableAccounts.filter(
        (account) =>
          account.type !== "investment" &&
          account.type !== "credit_card" &&
          account.id !== form.account_id,
      );
    }

    return selectableAccounts.filter(
      (account) =>
        account.id !== form.account_id,
    );
  }, [
    selectableAccounts,
    form.type,
    form.account_id,
  ]);

  const categoryOptions = useMemo(() => {
    if (form.type === "income") {
      return categories.filter(
        (category) =>
          category.kind === "income",
      );
    }

    if (form.type === "expense") {
      return categories.filter(
        (category) =>
          category.kind === "expense",
      );
    }

    if (
      form.type ===
        "investment_contribution" ||
      form.type ===
        "investment_withdrawal"
    ) {
      return categories.filter(
        (category) =>
          category.kind === "investment",
      );
    }

    return [];
  }, [categories, form.type]);

  const requiresDestination =
    form.type === "transfer" ||
    form.type ===
      "investment_contribution" ||
    form.type ===
      "investment_withdrawal";

  const requiresCategory =
    form.type === "income" ||
    form.type === "expense";

  function updateForm<
    K extends keyof TransactionForm,
  >(
    field: K,
    value: TransactionForm[K],
  ) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }


  function openCreateModal() {
    if (!canWrite) {
      setPageError("Seu acesso é somente leitura.");
      return;
    }

    setUnifiedModalOpen(true);
  }

  function openEditModal(
    transaction: Transaction,
  ) {
    if (
      transaction.debt_id ||
      ["debt_payment", "debt_received"].includes(String(transaction.type)) ||
      Boolean(transaction.metadata?.commitment_id)
    ) {
      setPageError(
        "Este registro está ligado a uma dívida ou compromisso e não pode ser alterado isoladamente.",
      );
      return;
    }

    setSelectedTransaction(transaction);

    setForm({
      type: transaction.type,
      status:
        getEffectiveStatus(transaction),
      description: transaction.description,
      merchant:
        transaction.merchant ?? "",
      amount: String(transaction.amount),
      account_id: transaction.account_id ?? "",
      destination_account_id:
        transaction.destination_account_id ??
        "",
      category_id:
        transaction.category_id ?? "",
      occurred_on:
        transaction.occurred_on,
      due_date:
        transaction.due_date ??
        transaction.occurred_on,
      notes:
        transaction.notes ?? "",
    });

    setModalError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) {
      return;
    }

    setModalOpen(false);
    setSelectedTransaction(null);
    setModalError(null);
    setForm(createEmptyForm());
  }

  function handleTypeChange(
    type: TransactionType,
  ) {
    let firstSourceAccount:
      | Account
      | undefined;

    if (
      type === "investment_withdrawal"
    ) {
      firstSourceAccount =
        activeAccounts.find(
          (account) =>
            account.type === "investment",
        );
    } else if (
      type === "investment_contribution"
    ) {
      firstSourceAccount =
        activeAccounts.find(
          (account) =>
            account.type !== "investment",
        );
    } else if (type === "income") {
      firstSourceAccount =
        activeAccounts.find(
          (account) =>
            account.type !== "credit_card" &&
            account.type !== "investment",
        );
    } else {
      firstSourceAccount =
        activeAccounts[0];
    }

    setForm((currentForm) => ({
      ...currentForm,
      type,
      account_id:
        firstSourceAccount?.id ?? "",
      destination_account_id: "",
      category_id: "",
    }));

    setModalError(null);
  }

  async function saveTransaction(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!currentUserId) {
      setModalError(
        "O usuário logado ainda não foi identificado.",
      );

      return;
    }

    if (!form.description.trim()) {
      setModalError(
        "Informe a descrição.",
      );

      return;
    }

    const parsedAmount = parseAmount(
      form.amount,
    );

    if (
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0
    ) {
      setModalError(
        "Informe um valor maior que zero.",
      );

      return;
    }

    const requiresSourceAccount = [
      "transfer",
      "investment_withdrawal",
    ].includes(form.type);

    if (requiresSourceAccount && !form.account_id) {
      setModalError(
        "Selecione a conta de origem.",
      );

      return;
    }

    if (
      requiresDestination &&
      !form.destination_account_id
    ) {
      setModalError(
        "Selecione a conta de destino.",
      );

      return;
    }

    if (
      requiresDestination &&
      form.account_id ===
        form.destination_account_id
    ) {
      setModalError(
        "A conta de origem e a conta de destino precisam ser diferentes.",
      );

      return;
    }

    if (
      requiresCategory &&
      !form.category_id
    ) {
      setModalError(
        "Selecione uma categoria.",
      );

      return;
    }

    if (
      (form.status === "planned" ||
        form.status === "overdue") &&
      !form.due_date
    ) {
      setModalError(
        "Informe a data de vencimento.",
      );

      return;
    }

    if (
      selectedTransaction &&
      !["manual", "ai"].includes(
        selectedTransaction.source,
      )
    ) {
      setModalError(
        "Movimentações importadas não podem ser editadas manualmente.",
      );

      return;
    }

    setSaving(true);
    setModalError(null);

    const paidAt =
      form.status === "paid"
        ? new Date(
            `${form.occurred_on}T12:00:00`,
          ).toISOString()
        : null;

    const payload = {
      household_id: household.id,
      account_id: form.account_id || null,
      destination_account_id:
        requiresDestination
          ? form.destination_account_id
          : null,
      category_id:
        form.category_id || null,
      responsible_user_id:
        currentUserId,
      type: form.type,
      status: form.status,
      description:
        form.description.trim(),
      merchant:
        form.merchant.trim() || null,
      amount: parsedAmount,
      original_amount: parsedAmount,
      occurred_on: form.occurred_on,
      due_date:
        form.due_date ||
        form.occurred_on,
      paid_at: paidAt,
      source:
        selectedTransaction?.source ??
        "manual",
      notes:
        form.notes.trim() || null,
      metadata:
        selectedTransaction?.metadata ??
        {},
      updated_at:
        new Date().toISOString(),
    };

    const result = selectedTransaction
      ? await supabase
          .from("pf_transactions")
          .update(payload)
          .eq(
            "id",
            selectedTransaction.id,
          )
          .eq(
            "household_id",
            household.id,
          )
      : await supabase
          .from("pf_transactions")
          .insert({
            ...payload,
            created_by: currentUserId,
          });

    if (result.error) {
      console.error(
        "Erro ao salvar movimentação:",
        result.error,
      );

      setModalError(
        result.error.message ||
          "Não foi possível salvar a movimentação.",
      );

      setSaving(false);
      return;
    }

    setSaving(false);
    closeModal();

    await loadData();
  }

  async function deleteSelectedTransaction() {
    if (!selectedTransaction) {
      return;
    }

    if (
      !["manual", "ai"].includes(
        selectedTransaction.source,
      )
    ) {
      setModalError(
        "Movimentações importadas não podem ser excluídas manualmente.",
      );

      return;
    }

    const confirmed = window.confirm(
      `Excluir a movimentação "${selectedTransaction.description}"?`,
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setModalError(null);

    const { error } = await supabase
      .from("pf_transactions")
      .delete()
      .eq(
        "id",
        selectedTransaction.id,
      )
      .eq(
        "household_id",
        household.id,
      );

    if (error) {
      console.error(
        "Erro ao excluir movimentação:",
        error,
      );

      setModalError(
        error.message ||
          "Não foi possível excluir a movimentação.",
      );

      setSaving(false);
      return;
    }

    setSaving(false);
    closeModal();

    await loadData();
  }

  return (
    <div className="space-y-6 pb-10">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
            Financeiro do dia a dia
          </p>

          <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
            Movimentações
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/70">
            Esta é a porta única para registrar movimentações, contas, recebíveis e dívidas.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          disabled={!canWrite}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-5 text-sm font-semibold text-[#F7F5EF] shadow-lg transition hover:-translate-y-0.5 hover:bg-[#172D43] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={18} />

          Novo registro
        </button>
      </section>

      {pageError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      )}

      {accounts.length === 0 &&
        !loading && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="font-semibold text-amber-900">
              Você ainda não cadastrou contas
            </p>

            <p className="mt-1 text-sm text-amber-700">
              Conta bancária é opcional para receitas e despesas, mas vale cadastrar cartões e contas quando quiser acompanhar saldo ou limite.
            </p>

            <Link
              href="/contas"
              className="mt-4 inline-flex rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Ir para contas
            </Link>
          </div>
        )}

      <section className="grid grid-cols-1 gap-3 rounded-2xl border border-[#0D1B2A]/10 bg-white/80 p-4 shadow-sm md:grid-cols-[minmax(240px,1fr)_auto_auto_auto]">
        <div className="relative">
          <Search
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#3A3A3C]/45"
          />

          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
            placeholder="Buscar descrição, estabelecimento ou conta..."
            className="h-11 w-full rounded-xl border border-[#0D1B2A]/12 bg-white pl-10 pr-4 text-sm text-[#0D1B2A] outline-none transition focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
          />
        </div>

        <select
          value={periodFilter}
          onChange={(event) =>
            setPeriodFilter(
              event.target.value as
                | "week"
                | "month"
                | "next_month"
                | "year"
                | "custom"
                | "all",
            )
          }
          className="h-11 rounded-xl border border-[#0D1B2A]/12 bg-white px-4 text-sm text-[#0D1B2A] outline-none"
        >
          <option value="week">
            Esta semana
          </option>

          <option value="month">
            Este mês
          </option>

          <option value="next_month">
            Próximo mês
          </option>

          <option value="year">
            Este ano
          </option>

          <option value="custom">
            Personalizado
          </option>

          <option value="all">
            Todo o histórico
          </option>
        </select>

        <select
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(
              event.target.value as
                | "all"
                | TransactionType,
            )
          }
          className="h-11 rounded-xl border border-[#0D1B2A]/12 bg-white px-4 text-sm text-[#0D1B2A] outline-none"
        >
          <option value="all">
            Todos os tipos
          </option>

          {TYPE_OPTIONS.map(
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

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(
              event.target.value as
                | "all"
                | TransactionStatus,
            )
          }
          className="h-11 rounded-xl border border-[#0D1B2A]/12 bg-white px-4 text-sm text-[#0D1B2A] outline-none"
        >
          <option value="all">
            Todos os status
          </option>

          <option value="paid">
            Realizados
          </option>

          <option value="planned">
            Planejados
          </option>

          <option value="overdue">
            Atrasados
          </option>

          <option value="cancelled">
            Cancelados
          </option>
        </select>

        {periodFilter === "custom" && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] p-3 md:col-span-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-[#0D1B2A]/65">De</span>
              <input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="h-10 w-full rounded-lg border border-[#0D1B2A]/12 bg-white px-3 text-sm text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-[#0D1B2A]/65">Até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="h-10 w-full rounded-lg border border-[#0D1B2A]/12 bg-white px-3 text-sm text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
              />
            </label>
            {customStart && customEnd && customStart > customEnd && (
              <p className="text-xs text-red-600 sm:col-span-2">
                A data inicial precisa ser anterior ou igual à data final.
              </p>
            )}
          </div>
        )}
      </section>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
        </div>
      ) : filteredTransactions.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-[#0D1B2A]/20 bg-white/70 px-6 py-16 text-center">
          <CircleDollarSign
            size={38}
            className="mx-auto text-[#C8A15A]"
          />

          <h2 className="mt-4 text-xl font-semibold text-[#0D1B2A]">
            Nenhuma movimentação encontrada
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#3A3A3C]/65">
            Registre o primeiro movimento
            financeiro ou altere os filtros.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-[#0D1B2A]/10 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="border-b border-[#0D1B2A]/8 bg-[#F7F5EF]">
                <tr>
                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Movimentação real
                  </th>

                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Vencimento
                  </th>

                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Descrição
                  </th>

                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Conta
                  </th>

                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Categoria
                  </th>

                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Tipo
                  </th>

                  <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Status
                  </th>

                  <th className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Valor
                  </th>

                  <th className="px-5 py-4 text-center text-xs font-semibold uppercase tracking-wider text-[#3A3A3C]/60">
                    Ação
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredTransactions.map(
                  (transaction) => {
                    const account = transaction.account_id
                      ? accountMap.get(transaction.account_id)
                      : undefined;

                    const destinationAccount =
                      transaction.destination_account_id
                        ? accountMap.get(
                            transaction.destination_account_id,
                          )
                        : null;

                    const category =
                      transaction.category_id
                        ? categoryMap.get(
                            transaction.category_id,
                          )
                        : null;

                    const typeOption =
                      getTypeOption(
                        transaction.type,
                      );

                    const TypeIcon =
                      typeOption.icon;

                    const effectiveStatus =
                      getEffectiveStatus(
                        transaction,
                      );

                    return (
                      <tr
                        key={transaction.id}
                        className="border-b border-[#0D1B2A]/7 last:border-0 hover:bg-[#F7F5EF]/70"
                      >
                        <td className="whitespace-nowrap px-5 py-4 text-[#3A3A3C]/70">
                          {transaction.status === "paid" ? (
                            formatDate(transaction.occurred_on)
                          ) : (
                            <div>
                              <p className="text-xs font-medium text-[#3A3A3C]/65">
                                Ainda não realizada
                              </p>
                              <p className="mt-0.5 text-[10px] text-[#3A3A3C]/40">
                                Registrada em {formatDate(transaction.created_at)}
                              </p>
                            </div>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-5 py-4 text-[#3A3A3C]/70">
                          {transaction.due_date
                            ? formatDate(transaction.due_date)
                            : "—"}
                        </td>

                        <td className="px-5 py-4">
                          <p className="font-medium text-[#0D1B2A]">
                            {
                              transaction.description
                            }
                          </p>

                          {transaction.merchant && (
                            <p className="mt-0.5 text-xs text-[#3A3A3C]/55">
                              {
                                transaction.merchant
                              }
                            </p>
                          )}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <Landmark
                              size={15}
                              className="text-[#C8A15A]"
                            />

                            <div>
                              <p className="text-[#0D1B2A]">
                                {account?.name ?? "Não informada"}
                              </p>

                              {account?.institution_name && (
                                <p className="mt-0.5 text-xs text-[#3A3A3C]/55">
                                  {account.institution_name}
                                </p>
                              )}

                              {destinationAccount && (
                                <p className="mt-0.5 text-xs text-[#3A3A3C]/55">
                                  →{" "}
                                  {
                                    destinationAccount.name
                                  }
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4 text-[#3A3A3C]/70">
                          {category?.name ??
                            "—"}
                        </td>

                        <td className="px-5 py-4">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F7F5EF] px-2.5 py-1 text-xs font-semibold text-[#0D1B2A]">
                            <TypeIcon
                              size={13}
                            />

                            {
                              typeOption.shortLabel
                            }
                          </span>
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider",
                              getStatusClasses(
                                effectiveStatus,
                              ),
                            ].join(" ")}
                          >
                            {getStatusLabel(
                              effectiveStatus,
                            )}
                          </span>
                        </td>

                        <td
                          className={[
                            "whitespace-nowrap px-5 py-4 text-right font-semibold",
                            getAmountClasses(
                              transaction.type,
                            ),
                          ].join(" ")}
                        >
                          {getAmountPrefix(
                            transaction.type,
                          )}

                          {formatCurrency(
                            transaction.amount,
                          )}
                        </td>

                        <td className="px-5 py-4 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              openEditModal(
                                transaction,
                              )
                            }
                            className="rounded-lg p-2 text-[#3A3A3C]/55 transition hover:bg-[#F7F5EF] hover:text-[#0D1B2A]"
                            title="Editar movimentação"
                          >
                            <Pencil size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <UnifiedFinancialEntryModal
        open={unifiedModalOpen}
        onClose={() => setUnifiedModalOpen(false)}
        onSaved={loadData}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-[#0D1B2A]/55 backdrop-blur-sm">
          <div className="flex min-h-full items-start justify-center px-4 pb-28 pt-4 sm:px-6 sm:pt-8">
            <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-[#C8A15A]/25 bg-[#F7F5EF] shadow-2xl sm:max-h-[calc(100vh-4rem)]">
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#0D1B2A]/10 bg-[#F7F5EF] px-6 py-5 sm:px-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
                    {selectedTransaction
                      ? "Editar registro"
                      : "Novo registro"}
                  </p>

                  <h2 className="mt-2 text-2xl font-semibold text-[#0D1B2A]">
                    {selectedTransaction
                      ? "Editar movimentação"
                      : "Adicionar movimentação"}
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
                onSubmit={saveTransaction}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[#0D1B2A]">
                        Tipo
                      </span>

                      <select
                        value={form.type}
                        onChange={(event) =>
                          handleTypeChange(
                            event.target
                              .value as TransactionType,
                          )
                        }
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                      >
                        {TYPE_OPTIONS.map(
                          (option) => (
                            <option
                              key={
                                option.value
                              }
                              value={
                                option.value
                              }
                            >
                              {option.label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[#0D1B2A]">
                        Status
                      </span>

                      <select
                        value={form.status}
                        onChange={(event) =>
                          updateForm(
                            "status",
                            event.target
                              .value as TransactionStatus,
                          )
                        }
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                      >
                        <option value="paid">
                          Realizado
                        </option>

                        <option value="planned">
                          Planejado
                        </option>

                        <option value="overdue">
                          Atrasado
                        </option>

                        <option value="cancelled">
                          Cancelado
                        </option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[#0D1B2A]">
                        Descrição
                      </span>

                      <input
                        type="text"
                        required
                        value={
                          form.description
                        }
                        onChange={(event) =>
                          updateForm(
                            "description",
                            event.target.value,
                          )
                        }
                        placeholder="Ex.: Compra no sacolão"
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[#0D1B2A]">
                        Estabelecimento ou pessoa
                      </span>

                      <input
                        type="text"
                        list="merchant-options"
                        value={form.merchant}
                        onChange={(event) =>
                          updateForm(
                            "merchant",
                            event.target.value,
                          )
                        }
                        placeholder="Selecione ou digite um nome"
                        autoComplete="off"
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                      />

                      <datalist id="merchant-options">
                        {MERCHANT_OPTIONS.map((merchant) => (
                          <option
                            key={merchant}
                            value={merchant}
                          />
                        ))}
                      </datalist>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[#0D1B2A]">
                        Valor
                      </span>

                      <input
                        type="text"
                        inputMode="decimal"
                        required
                        value={form.amount}
                        onChange={(event) =>
                          updateForm(
                            "amount",
                            event.target.value,
                          )
                        }
                        placeholder="0,00"
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                      />
                    </label>

                    {form.type !==
                      "transfer" && (
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-[#0D1B2A]">
                          Categoria
                        </span>

                        <select
                          value={
                            form.category_id
                          }
                          onChange={(event) =>
                            updateForm(
                              "category_id",
                              event.target.value,
                            )
                          }
                          className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                        >
                          <option value="">
                            Selecione
                          </option>

                          {categoryOptions.map(
                            (category) => (
                              <option
                                key={
                                  category.id
                                }
                                value={
                                  category.id
                                }
                              >
                                {
                                  category.name
                                }
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-medium text-[#0D1B2A]">
                        {form.type === "investment_withdrawal"
                          ? "Investimento de origem"
                          : form.type === "transfer"
                            ? "Conta de origem"
                            : "Conta bancária (opcional)"}
                      </span>

                      <select
                        required={["transfer", "investment_withdrawal"].includes(form.type)}
                        value={form.account_id}
                        onChange={(event) => {
                          const accountId =
                            event.target.value;

                          setForm(
                            (currentForm) => ({
                              ...currentForm,
                              account_id:
                                accountId,
                              destination_account_id:
                                currentForm.destination_account_id ===
                                accountId
                                  ? ""
                                  : currentForm.destination_account_id,
                            }),
                          );
                        }}
                        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                      >
                        <option value="">
                          {["transfer", "investment_withdrawal"].includes(form.type)
                            ? "Selecione"
                            : "Não informada"}
                        </option>

                        {sourceAccountOptions.map(
                          (account) => (
                            <option
                              key={account.id}
                              value={
                                account.id
                              }
                            >
                              {account.name}
                              {account.institution_name
                                ? ` · ${account.institution_name}`
                                : ""}
                              {` — ${formatCurrency(account.balance)}`}
                            </option>
                          ),
                        )}
                      </select>
                    </label>

                    {requiresDestination && (
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-[#0D1B2A]">
                          {form.type ===
                          "investment_contribution"
                            ? "Investimento de destino"
                            : "Conta de destino"}
                        </span>

                        <select
                          required
                          value={
                            form.destination_account_id
                          }
                          onChange={(event) =>
                            updateForm(
                              "destination_account_id",
                              event.target.value,
                            )
                          }
                          className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                        >
                          <option value="">
                            Selecione
                          </option>

                          {destinationAccountOptions.map(
                            (account) => (
                              <option
                                key={
                                  account.id
                                }
                                value={
                                  account.id
                                }
                              >
                                {
                                  account.name
                                }{" "}
                                —{" "}
                                {formatCurrency(
                                  account.balance,
                                )}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {form.status === "paid" ? (
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-[#0D1B2A]">
                          Data da movimentação
                        </span>

                        <input
                          type="date"
                          required
                          value={form.occurred_on}
                          onChange={(event) =>
                            updateForm("occurred_on", event.target.value)
                          }
                          className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                        />
                      </label>
                    ) : (
                      <label className="space-y-2">
                        <span className="text-sm font-medium text-[#0D1B2A]">
                          Vencimento
                        </span>

                        <input
                          type="date"
                          required
                          value={form.due_date}
                          onChange={(event) =>
                            updateForm("due_date", event.target.value)
                          }
                          className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                        />
                      </label>
                    )}
                  </div>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Observações
                    </span>

                    <textarea
                      rows={3}
                      value={form.notes}
                      onChange={(event) =>
                        updateForm(
                          "notes",
                          event.target.value,
                        )
                      }
                      placeholder="Informações adicionais..."
                      className="w-full resize-none rounded-xl border border-[#0D1B2A]/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/20"
                    />
                  </label>

                  {modalError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {modalError}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-[#0D1B2A]/10 bg-[#F7F5EF] px-6 py-4 sm:flex-row sm:justify-between sm:px-8">
                  <div>
                    {selectedTransaction && (
                      <button
                        type="button"
                        onClick={() =>
                          void deleteSelectedTransaction()
                        }
                        disabled={saving}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 px-5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50 sm:w-auto"
                      >
                        <Trash2
                          size={17}
                        />

                        Excluir
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col-reverse gap-3 sm:flex-row">
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

                      {selectedTransaction
                        ? "Salvar alterações"
                        : "Criar movimentação"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}