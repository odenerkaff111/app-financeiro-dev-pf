"use client";

import {
  ArrowRightLeft,
  BadgeDollarSign,
  CalendarDays,
  CircleDollarSign,
  HandCoins,
  Loader2,
  PiggyBank,
  Plus,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { supabase } from "@/lib/supabase";
import { KyraSelect } from "@/components/ui/KyraSelect";
import {
  formatCurrency,
  parsePtBrAmount,
  toNumber,
  type CommitmentProgress,
  type DebtPosition,
  type InterestMethod,
  type InterestPeriod,
} from "@/lib/financial-engine";

type EntryKind =
  | "expense"
  | "income"
  | "transfer"
  | "investment_contribution"
  | "investment_withdrawal"
  | "payable"
  | "receivable"
  | "settle_payable"
  | "settle_receivable"
  | "other_debt"
  | "debt_payment";

type Account = {
  id: string;
  name: string;
  institution_name: string | null;
  type: string;
  balance: number | string;
};

type Category = {
  id: string;
  name: string;
  kind: string;
};

type Budget = {
  id: string;
  category_id: string;
  name: string;
  month: string;
  amount: number | string;
};

type FormState = {
  kind: EntryKind;
  description: string;
  counterparty: string;
  amount: string;
  totalAmount: string;
  initialAmount: string;
  accountId: string;
  destinationAccountId: string;
  categoryId: string;
  budgetId: string;
  date: string;
  dueDate: string;
  status: "paid" | "planned";
  notes: string;
  isEssential: boolean;
  isRecurring: boolean;
  recurrenceEndsOn: string;
  isInstallmentPurchase: boolean;
  installmentPurchaseCount: string;
  installmentCardMode: "own" | "third_party";
  installmentCardAccountId: string;
  installmentCardHolder: string;
  installmentCardInstitution: string;
  installmentFirstDueDate: string;

  commitmentId: string;
  debtId: string;

  debtGroup: "personal" | "other";
  installmentAmount: string;
  totalInstallments: string;
  countInstallment: boolean;

  interestEnabled: boolean;
  autoAccrueInterest: boolean;
  interestRate: string;
  interestPeriod: InterestPeriod;
  interestMethod: InterestMethod;
  penaltyRate: string;
  dailyLateInterestRate: string;
  gracePeriodDays: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

type EntryDirection = "outgoing" | "incoming";

type EntryOption = {
  value: EntryKind;
  label: string;
};

const PRIMARY_OPTIONS: Record<EntryDirection, EntryOption[]> = {
  outgoing: [
    { value: "expense", label: "Despesa ou conta" },
    { value: "debt_payment", label: "Pagamento de dívida" },
    { value: "investment_contribution", label: "Investimento" },
  ],
  incoming: [
    { value: "income", label: "Receita ou salário" },
  ],
};

const SECONDARY_OPTIONS: EntryOption[] = [
  { value: "transfer", label: "Transferência entre contas" },
  { value: "investment_withdrawal", label: "Resgate de investimento" },
  { value: "payable", label: "Criar compromisso a pagar" },
  { value: "receivable", label: "Criar valor a receber" },
  { value: "settle_payable", label: "Pagar compromisso existente" },
  { value: "settle_receivable", label: "Receber compromisso existente" },
  { value: "other_debt", label: "Cadastrar nova dívida" },
];

function directionForKind(kind: EntryKind): EntryDirection {
  if ([
    "income",
    "receivable",
    "settle_receivable",
    "investment_withdrawal",
  ].includes(kind)) {
    return "incoming";
  }

  return "outgoing";
}


function today() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function nextMonthSameDay() {
  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastDay = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0,
  ).getDate();
  const day = Math.min(now.getDate(), lastDay);

  return [
    targetMonth.getFullYear(),
    String(targetMonth.getMonth() + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function emptyForm(kind: EntryKind = "expense"): FormState {
  const currentDate = today();

  return {
    kind,
    description: "",
    counterparty: "",
    amount: "",
    totalAmount: "",
    initialAmount: "",
    accountId: "",
    destinationAccountId: "",
    categoryId: "",
    budgetId: "",
    date: currentDate,
    dueDate: currentDate,
    status: "paid",
    notes: "",
    isEssential: false,
    isRecurring: false,
    recurrenceEndsOn: "",
    isInstallmentPurchase: false,
    installmentPurchaseCount: "2",
    installmentCardMode: "third_party",
    installmentCardAccountId: "",
    installmentCardHolder: "",
    installmentCardInstitution: "",
    installmentFirstDueDate: nextMonthSameDay(),
    commitmentId: "",
    debtId: "",
    debtGroup: "personal",
    installmentAmount: "",
    totalInstallments: "",
    countInstallment: false,
    interestEnabled: false,
    autoAccrueInterest: false,
    interestRate: "",
    interestPeriod: "monthly",
    interestMethod: "simple",
    penaltyRate: "",
    dailyLateInterestRate: "",
    gracePeriodDays: "0",
  };
}

function optionalAmount(value: string) {
  if (!value.trim()) return 0;
  return parsePtBrAmount(value);
}

function optionalNumber(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function notifyFinancialChange() {
  const version = String(Date.now());
  localStorage.setItem("pf:financial-data-version", version);
  window.dispatchEvent(new Event("pf:financial-data-changed"));
}

export function UnifiedFinancialEntryModal({
  open,
  onClose,
  onSaved,
}: Props) {
  const { household, canWrite } = useHousehold();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [debts, setDebts] = useState<DebtPosition[]>([]);
  const [commitments, setCommitments] = useState<CommitmentProgress[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  const loadReferenceData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [accountsResult, categoriesResult, budgetsResult, debtsResult, commitmentsResult] =
      await Promise.all([
        supabase
          .from("pf_accounts")
          .select("id, name, institution_name, type, balance")
          .eq("household_id", household.id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("pf_categories")
          .select("id, name, kind")
          .eq("household_id", household.id)
          .order("name"),
        supabase
          .from("pf_budgets")
          .select("id, category_id, name, month, amount")
          .eq("household_id", household.id),
        supabase
          .from("pf_debt_positions")
          .select("*")
          .eq("household_id", household.id)
          .neq("status", "cancelled")
          .gt("projected_balance", 0)
          .order("projected_balance", { ascending: false }),
        supabase
          .from("pf_commitment_progress")
          .select("*")
          .eq("household_id", household.id)
          .in("computed_status", ["pending", "partial", "overdue"])
          .order("due_date", { ascending: true, nullsFirst: false }),
      ]);

    const firstError =
      accountsResult.error ??
      categoriesResult.error ??
      budgetsResult.error ??
      debtsResult.error ??
      commitmentsResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const loadedAccounts = (accountsResult.data ?? []) as Account[];
    setAccounts(loadedAccounts);
    setCategories((categoriesResult.data ?? []) as Category[]);
    setBudgets((budgetsResult.data ?? []) as Budget[]);
    setDebts((debtsResult.data ?? []) as DebtPosition[]);
    setCommitments((commitmentsResult.data ?? []) as CommitmentProgress[]);

    setForm((current) => {
      const needsExplicitAccount = [
        "transfer",
        "investment_withdrawal",
        "debt_payment",
        "settle_payable",
        "settle_receivable",
      ].includes(current.kind);

      const preferredAccount =
        current.kind === "investment_withdrawal"
          ? loadedAccounts.find((account) => account.type === "investment")
          : loadedAccounts.find((account) => account.type !== "investment") ??
            loadedAccounts[0];

      return {
        ...current,
        accountId:
          current.accountId ||
          (needsExplicitAccount ? preferredAccount?.id ?? "" : ""),
      };
    });

    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    if (!open) return;

    setForm(emptyForm());
    setShowNewCategory(false);
    setNewCategoryName("");
    void loadReferenceData();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, loadReferenceData]);

  const payableCommitments = useMemo(
    () => commitments.filter((item) => item.direction === "payable"),
    [commitments],
  );

  const receivableCommitments = useMemo(
    () => commitments.filter((item) => item.direction === "receivable"),
    [commitments],
  );

  const selectedCommitment = useMemo(
    () => commitments.find((item) => item.id === form.commitmentId) ?? null,
    [commitments, form.commitmentId],
  );

  const selectedDebt = useMemo(
    () => debts.find((item) => item.id === form.debtId) ?? null,
    [debts, form.debtId],
  );

  const categoryOptions = useMemo(() => {
    if (form.kind === "income") {
      return categories.filter((category) => category.kind === "income");
    }

    if (form.kind === "expense") {
      return categories.filter((category) => category.kind === "expense");
    }

    if (
      form.kind === "investment_contribution" ||
      form.kind === "investment_withdrawal"
    ) {
      return categories.filter((category) => category.kind === "investment");
    }

    return [];
  }, [categories, form.kind]);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === form.categoryId) ?? null,
    [categories, form.categoryId],
  );

  const availablePlannings = useMemo(() => {
    if (form.kind !== "expense" || !form.categoryId) return [];

    const referenceDate = form.isInstallmentPurchase
      ? form.installmentFirstDueDate
      : form.status === "planned"
        ? form.dueDate || form.date
        : form.date;

    if (!referenceDate || referenceDate.length < 7) return [];
    const referenceMonth = referenceDate.slice(0, 7);

    return budgets.filter(
      (budget) =>
        budget.category_id === form.categoryId &&
        budget.month.slice(0, 7) === referenceMonth,
    );
  }, [
    budgets,
    form.categoryId,
    form.date,
    form.dueDate,
    form.installmentFirstDueDate,
    form.isInstallmentPurchase,
    form.kind,
    form.status,
  ]);

  useEffect(() => {
    if (form.kind !== "expense") return;

    if (
      form.budgetId &&
      !availablePlannings.some((plan) => plan.id === form.budgetId)
    ) {
      update("budgetId", "");
    }
  }, [availablePlannings, form.budgetId, form.kind]);


  const isDebtExpenseCategory =
    form.kind === "expense" &&
    selectedCategory?.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase() === "dividas";

  const sourceAccounts = useMemo(() => {
    if (form.kind === "investment_withdrawal") {
      return accounts.filter((account) => account.type === "investment");
    }

    if (form.kind === "investment_contribution") {
      return accounts.filter((account) => account.type !== "investment");
    }

    if (form.kind === "income") {
      return accounts.filter((account) => account.type !== "credit_card");
    }

    return accounts;
  }, [accounts, form.kind]);

  const creditCardAccounts = useMemo(
    () => accounts.filter((account) => account.type === "credit_card"),
    [accounts],
  );

  const destinationAccounts = useMemo(() => {
    if (form.kind === "investment_contribution") {
      return accounts.filter(
        (account) =>
          account.type === "investment" && account.id !== form.accountId,
      );
    }

    if (form.kind === "investment_withdrawal") {
      return accounts.filter(
        (account) =>
          account.type !== "investment" &&
          account.type !== "credit_card" &&
          account.id !== form.accountId,
      );
    }

    return accounts.filter((account) => account.id !== form.accountId);
  }, [accounts, form.accountId, form.kind]);

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function createCustomCategory() {
    const name = newCategoryName.trim().replace(/\s+/g, " ");

    if (!name) {
      setError("Informe o nome da nova categoria.");
      return;
    }

    const kind =
      form.kind === "income"
        ? "income"
        : form.kind === "investment_contribution" ||
            form.kind === "investment_withdrawal"
          ? "investment"
          : "expense";

    const existing = categories.find(
      (category) =>
        category.kind === kind &&
        category.name.localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0,
    );

    if (existing) {
      update("categoryId", existing.id);
      setShowNewCategory(false);
      setNewCategoryName("");
      setError(null);
      return;
    }

    setCreatingCategory(true);
    setError(null);

    try {
      const groupType =
        kind === "income"
          ? "income"
          : kind === "investment"
            ? "investment"
            : "other";

      const result = await supabase
        .from("pf_categories")
        .insert({
          household_id: household.id,
          name,
          kind,
          group_type: groupType,
          is_system: false,
        })
        .select("id, name, kind")
        .single();

      if (result.error) throw result.error;

      const created = result.data as Category;
      setCategories((current) =>
        [...current, created].sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR"),
        ),
      );
      update("categoryId", created.id);
      setShowNewCategory(false);
      setNewCategoryName("");
      // Nao dispare o refresh global aqui: o AppLayout remonta a pagina
      // quando recebe esse evento e isso fechava o modal no meio do cadastro.
      // A categoria ja foi adicionada ao estado local e o refresh global
      // acontecera normalmente quando o registro financeiro for salvo.
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível criar a categoria.",
      );
    } finally {
      setCreatingCategory(false);
    }
  }

  function changeKind(kind: EntryKind) {
    const next = emptyForm(kind);
    const needsExplicitAccount = [
      "transfer",
      "investment_withdrawal",
      "debt_payment",
      "settle_payable",
      "settle_receivable",
    ].includes(kind);

    const firstAccount =
      kind === "investment_withdrawal"
        ? accounts.find((account) => account.type === "investment")
        : accounts.find((account) => account.type !== "investment") ?? accounts[0];

    next.accountId = needsExplicitAccount ? firstAccount?.id ?? "" : "";

    if (kind === "investment_contribution") {
      next.categoryId =
        categories.find((category) => category.kind === "investment")?.id ?? "";
    }

    setForm(next);
    setError(null);
  }

  async function ensureInvestmentDestination(userId: string) {
    const institution = form.counterparty.trim().replace(/\s+/g, " ");

    if (!institution) {
      throw new Error("Informe onde você está investindo, por exemplo: Rico.");
    }

    const normalize = (value: string | null) =>
      (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();

    const normalizedInstitution = normalize(institution);
    const existing = accounts.find(
      (account) =>
        account.type === "investment" &&
        (normalize(account.institution_name) === normalizedInstitution ||
          normalize(account.name) === normalizedInstitution ||
          normalize(account.name) === normalize(`Investimentos - ${institution}`)),
    );

    if (existing) return existing.id;

    const result = await supabase
      .from("pf_accounts")
      .insert({
        household_id: household.id,
        owner_user_id: userId,
        name: `Investimentos - ${institution}`,
        institution_name: institution,
        type: "investment",
        balance: 0,
        source: "manual",
        is_shared: true,
        is_active: true,
      })
      .select("id, name, institution_name, type, balance")
      .single();

    if (result.error) throw result.error;

    const created = result.data as Account;
    setAccounts((current) => [...current, created]);
    return created.id;
  }

  async function saveInstallmentPurchase() {
    const amount = parsePtBrAmount(form.amount);
    const installments = Number.parseInt(form.installmentPurchaseCount, 10);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Informe o valor total da compra.");
    }
    if (!form.description.trim()) {
      throw new Error("Informe a descrição da compra parcelada.");
    }
    if (!form.categoryId) {
      throw new Error("Selecione uma categoria.");
    }
    if (!Number.isInteger(installments) || installments < 1 || installments > 120) {
      throw new Error("Informe entre 1 e 120 parcelas.");
    }
    if (!form.installmentFirstDueDate) {
      throw new Error("Informe o vencimento da primeira parcela.");
    }
    if (form.installmentCardMode === "own" && !form.installmentCardAccountId) {
      throw new Error("Selecione o cartão usado na compra.");
    }
    if (
      form.installmentCardMode === "third_party" &&
      !form.installmentCardHolder.trim()
    ) {
      throw new Error("Informe o titular do cartão de terceiro.");
    }

    const result = await supabase.rpc("pf_create_installment_purchase_v1", {
      target_household_id: household.id,
      purchase_description: form.description.trim(),
      purchase_merchant: form.counterparty.trim() || null,
      purchase_total_amount: amount,
      purchase_installments: installments,
      first_installment_due_date: form.installmentFirstDueDate,
      purchase_category_id: form.categoryId,
      credit_card_account_id:
        form.installmentCardMode === "own"
          ? form.installmentCardAccountId
          : null,
      third_party_card_holder:
        form.installmentCardMode === "third_party"
          ? form.installmentCardHolder.trim()
          : null,
      third_party_card_institution:
        form.installmentCardMode === "third_party"
          ? form.installmentCardInstitution.trim() || null
          : null,
      purchase_notes: form.notes.trim() || null,
      purchase_is_essential: form.isEssential,
    });

    if (result.error) throw result.error;
  }

  async function saveDirectTransaction(userId: string) {
    if (form.kind === "expense" && form.isInstallmentPurchase) {
      await saveInstallmentPurchase();
      return;
    }

    const amount = parsePtBrAmount(form.amount);
    const requiresDestination = [
      "transfer",
      "investment_withdrawal",
    ].includes(form.kind);
    const requiresSourceAccount = [
      "transfer",
      "investment_withdrawal",
    ].includes(form.kind);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Informe um valor maior que zero.");
    }
    if (requiresSourceAccount && !form.accountId) {
      throw new Error("Selecione uma conta.");
    }
    if (requiresDestination && !form.destinationAccountId) {
      throw new Error("Selecione a conta de destino.");
    }
    if (requiresDestination && form.accountId === form.destinationAccountId) {
      throw new Error("Origem e destino precisam ser diferentes.");
    }
    if (
      ["income", "expense", "investment_contribution"].includes(form.kind) &&
      !form.categoryId
    ) {
      throw new Error("Selecione uma categoria.");
    }

    if (isDebtExpenseCategory) {
      if (form.status !== "planned") {
        throw new Error(
          "Para pagar uma dívida já existente, use Pagamento de dívida. Para cadastrar uma dívida nova, deixe como A pagar.",
        );
      }

      if (!form.counterparty.trim()) {
        throw new Error("Informe para quem você deve.");
      }

      const fallbackAccountId =
        form.accountId ||
        accounts.find((account) => account.type !== "investment")?.id ||
        accounts[0]?.id ||
        "";

      if (!fallbackAccountId) {
        throw new Error(
          "Cadastre ao menos uma conta para concluir o vínculo técnico desta dívida.",
        );
      }

      const debtResult = await supabase.rpc("pf_create_debt_obligation_v1", {
        target_household_id: household.id,
        obligation_account_id: fallbackAccountId,
        debt_creditor: form.counterparty.trim(),
        debt_description:
          form.description.trim() || `Dívida com ${form.counterparty.trim()}`,
        debt_original_amount: amount,
        target_debt_group: form.debtGroup,
        debt_start_date: today(),
        debt_due_date: form.dueDate || form.date,
        debt_installment_amount: null,
        debt_interest_enabled: false,
        debt_auto_accrue_interest: false,
        debt_interest_rate: 0,
        debt_interest_period: "monthly",
        debt_interest_method: "simple",
        obligation_notes: form.notes.trim() || null,
      });

      if (debtResult.error) throw debtResult.error;

      if (!form.accountId) {
        const created = Array.isArray(debtResult.data)
          ? debtResult.data[0]
          : debtResult.data;
        const transactionId = created?.obligation_transaction_id as
          | string
          | undefined;

        if (transactionId) {
          const clearAccountResult = await supabase
            .from("pf_transactions")
            .update({ account_id: null })
            .eq("id", transactionId)
            .eq("household_id", household.id);

          if (clearAccountResult.error) throw clearAccountResult.error;
        }
      }

      return;
    }

    const movementDate = form.status === "paid" ? form.date : today();
    const paidAt =
      form.status === "paid"
        ? new Date(`${movementDate}T12:00:00-03:00`).toISOString()
        : null;

    const effectiveDueDate =
      (form.kind === "income" ||
        form.kind === "expense" ||
        form.kind === "investment_contribution") &&
      form.status === "planned"
        ? form.dueDate || form.date
        : null;

    let destinationAccountId: string | null = requiresDestination
      ? form.destinationAccountId
      : null;

    if (form.kind === "investment_contribution") {
      destinationAccountId = await ensureInvestmentDestination(userId);
    }

    const result = await supabase
      .from("pf_transactions")
      .insert({
      household_id: household.id,
      account_id: form.accountId || null,
      destination_account_id: destinationAccountId,
      category_id: form.categoryId || null,
      budget_id: form.kind === "expense" ? form.budgetId || null : null,
      created_by: userId,
      responsible_user_id: userId,
      type: form.kind,
      status: form.status,
      description: form.description.trim(),
      merchant: form.counterparty.trim() || null,
      amount,
      original_amount: amount,
      occurred_on: movementDate,
      due_date: effectiveDueDate,
      paid_at: paidAt,
      source: "manual",
      notes: form.notes.trim() || null,
      is_essential: form.kind === "expense" ? form.isEssential : false,
      metadata: { origin: "unified_entry" },
    })
      .select("id")
      .single();

    if (result.error) throw result.error;

    if (
      form.isRecurring &&
      (form.kind === "expense" || form.kind === "income") &&
      !isDebtExpenseCategory
    ) {
      const recurrenceStart =
        form.status === "planned"
          ? form.dueDate || form.date
          : form.date;

      if (
        form.recurrenceEndsOn &&
        recurrenceStart &&
        form.recurrenceEndsOn < recurrenceStart
      ) {
        throw new Error(
          "A recorrência não pode terminar antes do primeiro lançamento.",
        );
      }

      const recurringResult = await supabase.rpc(
        "pf_make_transaction_monthly_recurring_v3",
        {
          target_transaction_id: result.data.id,
          recurrence_ends_on: form.recurrenceEndsOn || null,
        },
      );

      if (recurringResult.error) {
        await supabase
          .from("pf_transactions")
          .delete()
          .eq("id", result.data.id)
          .eq("household_id", household.id);
        throw recurringResult.error;
      }
    }
  }

  async function saveCommitment(direction: "payable" | "receivable") {
    const totalAmount = parsePtBrAmount(form.totalAmount);
    const initialAmount = optionalAmount(form.initialAmount);

    if (!form.counterparty.trim()) throw new Error("Informe a pessoa ou empresa.");
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new Error("Informe um valor total maior que zero.");
    }
    if (!Number.isFinite(initialAmount) || initialAmount < 0) {
      throw new Error("O valor já liquidado é inválido.");
    }
    if (initialAmount > totalAmount) {
      throw new Error("O valor já liquidado não pode superar o total.");
    }
    if (initialAmount > 0 && !form.accountId) {
      throw new Error("Selecione a conta usada no pagamento ou recebimento.");
    }

    const result = await supabase.rpc(
      "pf_create_commitment_with_initial_settlement_v2",
      {
        target_household_id: household.id,
        commitment_direction: direction,
        commitment_counterparty: form.counterparty.trim(),
        commitment_description: form.description.trim(),
        commitment_total_amount: totalAmount,
        commitment_due_date: form.dueDate || null,
        commitment_category_id: null,
        commitment_default_account_id: form.accountId || null,
        commitment_responsible_user_id: null,
        commitment_visibility_scope: "family",
        commitment_notes: form.notes.trim() || null,
        commitment_source: "manual",
        commitment_is_essential:
          direction === "payable" ? form.isEssential : false,
        initial_settlement_amount: initialAmount,
        initial_settlement_account_id: initialAmount > 0 ? form.accountId : null,
        initial_settlement_date: form.date,
        initial_settlement_notes: form.notes.trim() || null,
      },
    );

    if (result.error) throw result.error;
  }

  async function settleCommitment(direction: "payable" | "receivable") {
    const amount = parsePtBrAmount(form.amount);
    const item = selectedCommitment;

    if (!item || item.direction !== direction) {
      throw new Error("Selecione o compromisso correto.");
    }
    if (!form.accountId) throw new Error("Selecione uma conta.");
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Informe um valor maior que zero.");
    }
    if (amount > toNumber(item.remaining_amount) + 0.005) {
      throw new Error("O valor não pode superar o saldo restante.");
    }

    const result = await supabase.rpc("pf_register_commitment_settlement", {
      target_commitment_id: item.id,
      target_account_id: form.accountId,
      settlement_amount: amount,
      settlement_date: form.date,
      settlement_notes: form.notes.trim() || null,
      settlement_source: "manual",
    });

    if (result.error) throw result.error;
  }

  async function saveOtherDebt() {
    const totalAmount = parsePtBrAmount(form.totalAmount);
    const initialAmount = optionalAmount(form.initialAmount);
    const installmentAmount = optionalAmount(form.installmentAmount);
    const interestRate = optionalNumber(form.interestRate);
    const penaltyRate = optionalNumber(form.penaltyRate);
    const lateRate = optionalNumber(form.dailyLateInterestRate);

    if (!form.counterparty.trim()) throw new Error("Informe o credor.");
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      throw new Error("Informe um valor original maior que zero.");
    }
    if (!Number.isFinite(initialAmount) || initialAmount < 0) {
      throw new Error("O pagamento inicial é inválido.");
    }
    if (initialAmount > totalAmount) {
      throw new Error("O pagamento inicial não pode superar o valor original.");
    }
    if (initialAmount > 0 && !form.accountId) {
      throw new Error("Selecione a conta do pagamento inicial.");
    }
    if (
      [installmentAmount, interestRate, penaltyRate, lateRate].some(
        (value) => !Number.isFinite(value) || value < 0,
      )
    ) {
      throw new Error("Revise os valores e as taxas informadas.");
    }

    const result = await supabase.rpc(
      "pf_create_debt_with_initial_payment_v2",
      {
        target_household_id: household.id,
        debt_creditor: form.counterparty.trim(),
        debt_description:
          form.description.trim() || `Dívida com ${form.counterparty.trim()}`,
        debt_original_amount: totalAmount,
        target_debt_group: form.debtGroup,
        debt_start_date: form.date,
        debt_due_date: form.dueDate || null,
        debt_installment_amount: installmentAmount > 0 ? installmentAmount : null,
        debt_total_installments:
          Number(form.totalInstallments) > 0
            ? Number(form.totalInstallments)
            : null,
        debt_interest_enabled: form.interestEnabled,
        debt_auto_accrue_interest:
          form.interestEnabled && form.autoAccrueInterest,
        debt_interest_rate: form.interestEnabled ? interestRate : 0,
        debt_interest_period: form.interestPeriod,
        debt_interest_method: form.interestMethod,
        debt_penalty_rate: penaltyRate,
        debt_daily_late_interest_rate: lateRate,
        debt_grace_period_days: Number(form.gracePeriodDays || 0),
        debt_responsible_user_id: null,
        debt_visibility_scope: "family",
        initial_payment_amount: initialAmount,
        initial_payment_account_id: initialAmount > 0 ? form.accountId : null,
        initial_payment_date: form.date,
        initial_payment_count_installment: form.countInstallment,
        initial_payment_notes: form.notes.trim() || null,
      },
    );

    if (result.error) throw result.error;
  }

  async function payDebt() {
    const amount = parsePtBrAmount(form.amount);

    if (!selectedDebt) throw new Error("Selecione uma dívida.");
    if (!form.accountId) throw new Error("Selecione a conta do pagamento.");
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Informe um valor maior que zero.");
    }
    if (amount > toNumber(selectedDebt.projected_balance) + 0.005) {
      throw new Error("O pagamento não pode superar o saldo atualizado.");
    }

    const result = await supabase.rpc("pf_register_debt_payment", {
      target_debt_id: selectedDebt.id,
      target_account_id: form.accountId,
      payment_amount: amount,
      payment_date: form.date,
      count_installment: form.countInstallment,
      payment_notes: form.notes.trim() || null,
    });

    if (result.error) throw result.error;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data, error: userError } = await supabase.auth.getUser();
      if (userError || !data.user) throw new Error("Sua sessão expirou.");

      if (
        [
          "expense",
          "income",
          "transfer",
          "investment_contribution",
          "investment_withdrawal",
        ].includes(form.kind)
      ) {
        await saveDirectTransaction(data.user.id);
      } else if (form.kind === "payable") {
        await saveCommitment("payable");
      } else if (form.kind === "receivable") {
        await saveCommitment("receivable");
      } else if (form.kind === "settle_payable") {
        await settleCommitment("payable");
      } else if (form.kind === "settle_receivable") {
        await settleCommitment("receivable");
      } else if (form.kind === "other_debt") {
        await saveOtherDebt();
      } else if (form.kind === "debt_payment") {
        await payDebt();
      }

      notifyFinancialChange();
      await onSaved();
      onClose();
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : typeof saveError === "object" &&
              saveError !== null &&
              "message" in saveError &&
              typeof (saveError as { message?: unknown }).message === "string"
            ? (saveError as { message: string }).message
            : "Não foi possível salvar o registro.";

      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const isDirect = [
    "expense",
    "income",
    "transfer",
    "investment_contribution",
    "investment_withdrawal",
  ].includes(form.kind);

  const isNewCommitment = ["payable", "receivable"].includes(form.kind);
  const isSettlement = ["settle_payable", "settle_receivable"].includes(
    form.kind,
  );
  const requiresDestination = [
    "transfer",
    "investment_withdrawal",
  ].includes(form.kind);
  const selectedSettlementOptions =
    form.kind === "settle_payable" ? payableCommitments : receivableCommitments;

  const entryDirection = directionForKind(form.kind);
  const primaryOptions = PRIMARY_OPTIONS[entryDirection];
  const isPrimaryKind = primaryOptions.some(
    (option) => option.value === form.kind,
  );

  function changeDirection(direction: EntryDirection) {
    changeKind(direction === "outgoing" ? "expense" : "income");
  }

  const modal = (
    <div className="fixed inset-0 z-[500] overflow-y-auto bg-[#0D1B2A]/60 p-2 backdrop-blur-sm sm:p-6">
      <div className="mx-auto flex min-h-full max-w-4xl items-start justify-center">
        <div className="flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-[#C8A15A]/25 bg-[#F7F5EF] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#0D1B2A]/10 px-6 py-5 sm:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
                Porta única de cadastro
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[#0D1B2A]">
                Novo registro financeiro
              </h2>
              <p className="mt-1 text-sm text-[#3A3A3C]/60">
                Registre uma vez. O sistema atualiza saldos, dívidas e pendências.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-full p-2 text-[#3A3A3C]/55 hover:bg-white"
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </header>

          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-[#0D1B2A]">
                    O que vai acontecer?
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-[#0D1B2A]/10 bg-white p-1.5">
                    <button
                      type="button"
                      onClick={() => changeDirection("outgoing")}
                      className={[
                        "h-11 rounded-xl text-sm font-semibold transition",
                        entryDirection === "outgoing"
                          ? "bg-[#0D1B2A] text-white shadow-sm"
                          : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF]",
                      ].join(" ")}
                    >
                      Vou pagar
                    </button>
                    <button
                      type="button"
                      onClick={() => changeDirection("incoming")}
                      className={[
                        "h-11 rounded-xl text-sm font-semibold transition",
                        entryDirection === "incoming"
                          ? "bg-[#0D1B2A] text-white shadow-sm"
                          : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF]",
                      ].join(" ")}
                    >
                      Vou receber
                    </button>
                  </div>
                </div>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    Tipo do registro
                  </span>
                  <KyraSelect
                    value={isPrimaryKind ? form.kind : ""}
                    onChange={(value) => changeKind(value as EntryKind)}
                    placeholder={
                      isPrimaryKind ? "Selecione" : "Registro avançado selecionado"
                    }
                    options={primaryOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    ariaLabel="Tipo do registro"
                    className="h-12"
                  />
                </label>

                <details className="rounded-xl border border-[#0D1B2A]/8 bg-white/60 px-4 py-3">
                  <summary className="cursor-pointer text-xs font-semibold text-[#3A3A3C]/60">
                    Outros tipos de registro
                  </summary>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SECONDARY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => changeKind(option.value)}
                        className={[
                          "rounded-lg border px-3 py-2 text-left text-xs font-medium transition",
                          form.kind === option.value
                            ? "border-[#C8A15A] bg-[#C8A15A]/10 text-[#0D1B2A]"
                            : "border-[#0D1B2A]/10 bg-white text-[#3A3A3C]/65 hover:border-[#C8A15A]/50",
                        ].join(" ")}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </details>
              </div>

              {loading ? (
                <div className="flex min-h-56 items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
                </div>
              ) : (
                <>
                  {isDirect && (
                    <>
                      <SectionTitle
                        icon={
                          form.kind === "expense"
                            ? TrendingDown
                            : form.kind === "income"
                              ? TrendingUp
                              : form.kind === "transfer"
                                ? ArrowRightLeft
                                : PiggyBank
                        }
                        title={
                          form.kind === "expense"
                            ? "Despesa ou conta"
                            : form.kind === "income"
                              ? "Receita ou salário"
                              : form.kind === "investment_contribution"
                                ? "Investimento"
                                : "Movimentação"
                        }
                      />

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <TextField
                          label="Descrição"
                          value={form.description}
                          onChange={(value) => update("description", value)}
                          placeholder="Ex.: supermercado, salário ou transferência"
                          required
                        />
                        <TextField
                          label={
                            form.kind === "investment_contribution"
                              ? "Onde você investiu?"
                              : "Pessoa ou estabelecimento"
                          }
                          value={form.counterparty}
                          onChange={(value) => update("counterparty", value)}
                          placeholder={
                            form.kind === "investment_contribution"
                              ? "Ex.: Rico"
                              : "Opcional"
                          }
                          required={form.kind === "investment_contribution"}
                        />
                        <MoneyField
                          label="Valor"
                          value={form.amount}
                          onChange={(value) => update("amount", value)}
                          required
                        />
                        {(form.kind === "income" ||
                          form.kind === "investment_contribution" ||
                          (form.kind === "expense" && !form.isInstallmentPurchase)) && (
                          <SelectField
                            label={
                              form.kind === "expense"
                                ? "Status do pagamento"
                                : form.kind === "investment_contribution"
                                  ? "Status do investimento"
                                  : "Status do recebimento"
                            }
                            value={form.status}
                            onChange={(value) =>
                              update("status", value as "paid" | "planned")
                            }
                            options={
                              form.kind === "expense"
                                ? [
                                    { value: "paid", label: "Pago" },
                                    { value: "planned", label: "A pagar" },
                                  ]
                                : form.kind === "investment_contribution"
                                  ? [
                                      { value: "paid", label: "Já investido" },
                                      { value: "planned", label: "A investir" },
                                    ]
                                  : [
                                      { value: "paid", label: "Recebido" },
                                      { value: "planned", label: "A receber" },
                                    ]
                            }
                          />
                        )}
                        {(form.kind === "transfer" ||
                          form.kind === "investment_withdrawal") && (
                          <AccountSelect
                            label={
                              form.kind === "investment_withdrawal"
                                ? "Investimento de origem"
                                : "Conta de origem"
                            }
                            value={form.accountId}
                            onChange={(value) => {
                              update("accountId", value);
                              if (form.destinationAccountId === value) {
                                update("destinationAccountId", "");
                              }
                            }}
                            accounts={sourceAccounts}
                          />
                        )}
                        {requiresDestination && (
                          <AccountSelect
                            label="Conta de destino"
                            value={form.destinationAccountId}
                            onChange={(value) => update("destinationAccountId", value)}
                            accounts={destinationAccounts}
                          />
                        )}
                        {((form.kind === "expense" && !form.isInstallmentPurchase) ||
                          form.kind === "income" ||
                          form.kind === "investment_contribution") && (
                          <details className="rounded-xl border border-[#0D1B2A]/10 bg-white/60 px-4 py-3 md:col-span-2">
                            <summary className="cursor-pointer text-xs font-semibold text-[#3A3A3C]/60">
                              Conta bancária (opcional)
                            </summary>
                            <div className="mt-3">
                              <AccountSelect
                                label={
                                  form.kind === "income"
                                    ? "Conta que recebe"
                                    : "Conta de origem ou pagamento"
                                }
                                value={form.accountId}
                                onChange={(value) => update("accountId", value)}
                                accounts={sourceAccounts}
                                optional
                              />
                            </div>
                          </details>
                        )}
                        {form.kind === "investment_contribution" && (
                          <div className="rounded-xl border border-[#C8A15A]/25 bg-[#C8A15A]/8 px-4 py-3 text-xs leading-5 text-[#0D1B2A]/70 md:col-span-2">
                            O investimento de destino será organizado automaticamente pela instituição informada acima. Você não precisa cadastrar uma conta de investimento antes.
                          </div>
                        )}
                        {form.kind === "expense" && !isDebtExpenseCategory && (
                          <div className="space-y-3 rounded-xl border border-[#C8A15A]/25 bg-[#C8A15A]/8 px-4 py-4 md:col-span-2">
                            <label className="flex cursor-pointer items-start gap-3">
                              <input
                                type="checkbox"
                                checked={form.isInstallmentPurchase}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  update("isInstallmentPurchase", checked);
                                  if (checked) {
                                    update("status", "planned");
                                    update("isRecurring", false);
                                  }
                                }}
                                className="mt-0.5 h-4 w-4 accent-[#0D1B2A]"
                              />
                              <span>
                                <span className="block text-sm font-semibold text-[#0D1B2A]">
                                  Compra no cartão / parcelada
                                </span>
                                <span className="mt-1 block text-xs leading-5 text-[#3A3A3C]/60">
                                  Registre 1x ou parcelado. Cria os vencimentos automaticamente e funciona com cartão seu ou de outra pessoa.
                                </span>
                              </span>
                            </label>

                            {form.isInstallmentPurchase && (
                              <div className="grid grid-cols-1 gap-3 border-t border-[#C8A15A]/20 pt-3 md:grid-cols-2">
                                <TextField
                                  label="Número de parcelas"
                                  value={form.installmentPurchaseCount}
                                  onChange={(value) => update("installmentPurchaseCount", value)}
                                  placeholder="Ex.: 6"
                                  required
                                />
                                <div>
                                  <DateField
                                    label="Vencimento da primeira parcela"
                                    value={form.installmentFirstDueDate}
                                    onChange={(value) => update("installmentFirstDueDate", value)}
                                  />
                                  <p className="mt-1 text-[10px] leading-4 text-[#3A3A3C]/55">
                                    Informe quando a primeira parcela entra na fatura. Uma compra feita hoje pode começar somente no próximo mês.
                                  </p>
                                </div>
                                <SelectField
                                  label="De quem é o cartão?"
                                  value={form.installmentCardMode}
                                  onChange={(value) =>
                                    update(
                                      "installmentCardMode",
                                      value as "own" | "third_party",
                                    )
                                  }
                                  options={[
                                    { value: "own", label: "Meu / da família" },
                                    { value: "third_party", label: "De outra pessoa" },
                                  ]}
                                />

                                {form.installmentCardMode === "own" ? (
                                  <SelectField
                                    label="Cartão usado"
                                    value={form.installmentCardAccountId}
                                    onChange={(value) => update("installmentCardAccountId", value)}
                                    options={creditCardAccounts.map((account) => ({
                                      value: account.id,
                                      label: account.institution_name
                                        ? `${account.name} · ${account.institution_name}`
                                        : account.name,
                                    }))}
                                    emptyLabel={
                                      creditCardAccounts.length > 0
                                        ? "Selecione"
                                        : "Nenhum cartão cadastrado"
                                    }
                                  />
                                ) : (
                                  <TextField
                                    label="Titular do cartão"
                                    value={form.installmentCardHolder}
                                    onChange={(value) => update("installmentCardHolder", value)}
                                    placeholder="Ex.: Tia Maria"
                                    required
                                  />
                                )}

                                {form.installmentCardMode === "third_party" && (
                                  <TextField
                                    label="Banco / cartão (opcional)"
                                    value={form.installmentCardInstitution}
                                    onChange={(value) =>
                                      update("installmentCardInstitution", value)
                                    }
                                    placeholder="Ex.: Nubank"
                                  />
                                )}

                                {(() => {
                                  const total = parsePtBrAmount(form.amount || "0");
                                  const count = Number.parseInt(
                                    form.installmentPurchaseCount || "0",
                                    10,
                                  );
                                  if (!Number.isFinite(total) || total <= 0 || count < 1) {
                                    return null;
                                  }
                                  return (
                                    <div className="rounded-xl bg-white px-3 py-3 text-xs text-[#0D1B2A]/70 md:col-span-2">
                                      Aproximadamente <strong>{count}x de {formatCurrency(total / count)}</strong>. O sistema ajusta centavos automaticamente para o total fechar exatamente.
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        )}
                        {form.kind !== "transfer" && (
                          <div className="space-y-2">
                            <SelectField
                              label="Categoria"
                              value={form.categoryId}
                              onChange={(value) => {
                                update("categoryId", value);
                                update("budgetId", "");
                                const category = categories.find((item) => item.id === value);
                                const normalizedName = category?.name
                                  .normalize("NFD")
                                  .replace(/[\u0300-\u036f]/g, "")
                                  .toLowerCase();

                                if (form.kind === "expense" && normalizedName === "dividas") {
                                  update("status", "planned");
                                  update("isRecurring", false);
                                  update("isInstallmentPurchase", false);
                                }
                              }}
                              options={categoryOptions.map((category) => ({
                                value: category.id,
                                label: category.name,
                              }))}
                              emptyLabel="Selecione"
                            />

                            {availablePlannings.length > 0 && form.kind === "expense" && (
                              <div className="rounded-xl border border-[#C8A15A]/25 bg-[#F7F5EF] p-3">
                                <SelectField
                                  label="Esta movimentaÃ§Ã£o faz parte de um planejamento?"
                                  value={form.budgetId || "__none__"}
                                  onChange={(value) =>
                                    update(
                                      "budgetId",
                                      value === "__none__" ? "" : value,
                                    )
                                  }
                                  options={[
                                    {
                                      value: "__none__",
                                      label: "NÃ£o Â· deixar fora do planejamento",
                                    },
                                    ...availablePlannings.map((plan) => ({
                                      value: plan.id,
                                      label: "Sim Â· " + plan.name + " Â· " + formatCurrency(plan.amount),
                                    })),
                                  ]}
                                  emptyLabel="NÃ£o Â· deixar fora do planejamento"
                                />
                                <p className="mt-2 text-[11px] leading-4 text-[#3A3A3C]/60">
                                  Ter a mesma categoria nÃ£o Ã© suficiente para consumir a reserva. O gasto sÃ³ entra no planejamento que vocÃª escolher aqui.
                                </p>
                              </div>
                            )}

                            {isDebtExpenseCategory && (
                              <div className="space-y-3 rounded-xl border border-[#C8A15A]/35 bg-[#C8A15A]/10 px-3 py-3">
                                <p className="text-xs leading-5 text-[#0D1B2A]/75">
                                  Este registro será criado nos dois lugares: <strong>A pagar</strong> e <strong>Dívidas</strong>. O vínculo evita duplicidade quando você registrar pagamentos depois.
                                </p>
                                <SelectField
                                  label="Classificação da dívida"
                                  value={form.debtGroup}
                                  onChange={(value) =>
                                    update("debtGroup", value as "personal" | "other")
                                  }
                                  options={[
                                    { value: "personal", label: "Pessoal · amigos ou familiares" },
                                    { value: "other", label: "Outras · bancos, lojas ou terceiros" },
                                  ]}
                                />
                              </div>
                            )}

                            {!showNewCategory ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowNewCategory(true);
                                  setError(null);
                                }}
                                disabled={!canWrite}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0D1B2A]/65 transition hover:text-[#0D1B2A] disabled:opacity-40"
                              >
                                <Plus size={14} />
                                Adicionar categoria
                              </button>
                            ) : (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={newCategoryName}
                                  onChange={(event) =>
                                    setNewCategoryName(event.target.value)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void createCustomCategory();
                                    }
                                  }}
                                  placeholder="Nome da nova categoria"
                                  autoFocus
                                  className="h-10 min-w-0 flex-1 rounded-xl border border-[#0D1B2A]/15 bg-white px-3 text-sm outline-none focus:border-[#C8A15A]"
                                />
                                <button
                                  type="button"
                                  onClick={() => void createCustomCategory()}
                                  disabled={creatingCategory || !newCategoryName.trim()}
                                  className="h-10 rounded-xl bg-[#0D1B2A] px-3 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                  {creatingCategory ? "Criando..." : "Adicionar"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowNewCategory(false);
                                    setNewCategoryName("");
                                  }}
                                  disabled={creatingCategory}
                                  className="h-10 rounded-xl border border-[#0D1B2A]/15 px-3 text-xs font-semibold text-[#0D1B2A] disabled:opacity-50"
                                >
                                  Cancelar
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {(form.kind === "expense" ||
                          form.kind === "income" ||
                          form.kind === "investment_contribution") ? (
                          form.kind === "expense" && form.isInstallmentPurchase ? null :
                          form.status === "planned" ? (
                            <DateField
                              label={
                                form.kind === "expense"
                                  ? "Vencimento"
                                  : form.kind === "investment_contribution"
                                    ? "Data prevista do investimento"
                                    : "Data prevista do recebimento"
                              }
                              value={form.dueDate}
                              onChange={(value) => update("dueDate", value)}
                            />
                          ) : (
                            <DateField
                              label={
                                form.kind === "expense"
                                  ? "Data do pagamento"
                                  : form.kind === "investment_contribution"
                                    ? "Data do investimento"
                                    : "Data do recebimento"
                              }
                              value={form.date}
                              onChange={(value) => update("date", value)}
                            />
                          )
                        ) : (
                          <DateField
                            label="Data da movimentação"
                            value={form.date}
                            onChange={(value) => update("date", value)}
                          />
                        )}
                      </div>

                      {(form.kind === "expense" || form.kind === "income") &&
                        !isDebtExpenseCategory &&
                        !form.isInstallmentPurchase && (
                          <RecurringToggle
                            checked={form.isRecurring}
                            onChange={(checked) => {
                              update("isRecurring", checked);
                              if (!checked) update("recurrenceEndsOn", "");
                            }}
                            day={Number(
                              (form.status === "planned"
                                ? form.dueDate || form.date
                                : form.date
                              ).slice(8, 10),
                            )}
                            endsOn={form.recurrenceEndsOn}
                            onEndsOnChange={(value) =>
                              update("recurrenceEndsOn", value)
                            }
                          />
                        )}

                      {form.kind === "expense" && (
                        <EssentialToggle
                          checked={form.isEssential}
                          onChange={(checked) => update("isEssential", checked)}
                          description="Use para moradia, alimentação básica, escola, saúde, transporte e outras despesas que compõem seu custo de vida."
                        />
                      )}
                    </>
                  )}

                  {isNewCommitment && (
                    <>
                      <SectionTitle
                        icon={form.kind === "payable" ? ReceiptText : BadgeDollarSign}
                        title={
                          form.kind === "payable"
                            ? "Nova conta a pagar"
                            : "Novo valor a receber"
                        }
                      />
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <TextField
                          label={
                            form.kind === "payable"
                              ? "Credor ou fornecedor"
                              : "Quem deve pagar"
                          }
                          value={form.counterparty}
                          onChange={(value) => update("counterparty", value)}
                          required
                        />
                        <TextField
                          label="Descrição"
                          value={form.description}
                          onChange={(value) => update("description", value)}
                          required
                        />
                        <MoneyField
                          label="Valor total"
                          value={form.totalAmount}
                          onChange={(value) => update("totalAmount", value)}
                          required
                        />
                        <MoneyField
                          label={
                            form.kind === "payable"
                              ? "Valor já pago"
                              : "Valor já recebido"
                          }
                          value={form.initialAmount}
                          onChange={(value) => update("initialAmount", value)}
                          hint="Deixe vazio quando ainda não houve liquidação."
                        />
                        <AccountSelect
                          label={
                            form.kind === "payable"
                              ? "Conta usada ou prevista"
                              : "Conta de recebimento"
                          }
                          value={form.accountId}
                          onChange={(value) => update("accountId", value)}
                          accounts={accounts}
                          optional
                        />
                        <DateField
                          label="Data da liquidação inicial"
                          value={form.date}
                          onChange={(value) => update("date", value)}
                        />
                        <DateField
                          label="Vencimento"
                          value={form.dueDate}
                          onChange={(value) => update("dueDate", value)}
                        />
                      </div>

                      {form.kind === "payable" && (
                        <EssentialToggle
                          checked={form.isEssential}
                          onChange={(checked) => update("isEssential", checked)}
                          description="Marque quando esta conta fizer parte do seu custo de vida essencial. O dashboard usará somente contas marcadas para calcular a média."
                        />
                      )}
                    </>
                  )}

                  {isSettlement && (
                    <>
                      <SectionTitle
                        icon={WalletCards}
                        title={
                          form.kind === "settle_payable"
                            ? "Pagar conta existente"
                            : "Receber valor existente"
                        }
                      />
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <SelectField
                          label="Compromisso"
                          value={form.commitmentId}
                          onChange={(value) => {
                            update("commitmentId", value);
                            const item = commitments.find((row) => row.id === value);
                            update(
                              "amount",
                              item
                                ? toNumber(item.remaining_amount)
                                    .toFixed(2)
                                    .replace(".", ",")
                                : "",
                            );
                            if (item?.default_account_id) {
                              update("accountId", item.default_account_id);
                            }
                          }}
                          options={selectedSettlementOptions.map((item) => ({
                            value: item.id,
                            label: `${item.counterparty} — ${item.description} — ${formatCurrency(
                              item.remaining_amount,
                            )}`,
                          }))}
                          emptyLabel="Selecione"
                        />
                        <MoneyField
                          label={
                            form.kind === "settle_payable"
                              ? "Valor pago"
                              : "Valor recebido"
                          }
                          value={form.amount}
                          onChange={(value) => update("amount", value)}
                          required
                        />
                        <AccountSelect
                          label={
                            form.kind === "settle_payable"
                              ? "Conta que pagou"
                              : "Conta que recebeu"
                          }
                          value={form.accountId}
                          onChange={(value) => update("accountId", value)}
                          accounts={accounts}
                        />
                        <DateField
                          label="Data"
                          value={form.date}
                          onChange={(value) => update("date", value)}
                        />
                      </div>
                    </>
                  )}

                  {form.kind === "other_debt" && (
                    <>
                      <SectionTitle icon={HandCoins} title="Nova dívida" />
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <TextField
                          label="Credor"
                          value={form.counterparty}
                          onChange={(value) => update("counterparty", value)}
                          required
                        />
                        <TextField
                          label="Descrição"
                          value={form.description}
                          onChange={(value) => update("description", value)}
                        />
                        <SelectField
                          label="Classificação"
                          value={form.debtGroup}
                          onChange={(value) =>
                            update(
                              "debtGroup",
                              value as "personal" | "other",
                            )
                          }
                          options={[
                            {
                              value: "personal",
                              label: "Pessoal — amigos ou familiares",
                            },
                            {
                              value: "other",
                              label: "Outras dívidas — bancos ou terceiros",
                            },
                          ]}
                        />
                        <MoneyField
                          label="Valor original"
                          value={form.totalAmount}
                          onChange={(value) => update("totalAmount", value)}
                          required
                        />
                        <MoneyField
                          label="Pagamento inicial"
                          value={form.initialAmount}
                          onChange={(value) => update("initialAmount", value)}
                          hint="Use quando parte da dívida já foi paga agora."
                        />
                        <AccountSelect
                          label="Conta do pagamento inicial"
                          value={form.accountId}
                          onChange={(value) => update("accountId", value)}
                          accounts={accounts}
                          optional
                        />
                        <MoneyField
                          label="Valor da parcela"
                          value={form.installmentAmount}
                          onChange={(value) => update("installmentAmount", value)}
                        />
                        <TextField
                          label="Número de parcelas"
                          value={form.totalInstallments}
                          onChange={(value) => update("totalInstallments", value)}
                          inputMode="numeric"
                        />
                        <DateField
                          label="Data inicial"
                          value={form.date}
                          onChange={(value) => update("date", value)}
                        />
                        <DateField
                          label="Vencimento"
                          value={form.dueDate}
                          onChange={(value) => update("dueDate", value)}
                        />
                      </div>

                      <label className="flex items-center justify-between rounded-xl border border-[#0D1B2A]/10 bg-white p-4">
                        <div>
                          <p className="text-sm font-medium text-[#0D1B2A]">
                            Possui juros recorrentes
                          </p>
                          <p className="mt-1 text-xs text-[#3A3A3C]/50">
                            O saldo projetado evolui automaticamente com o tempo.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={form.interestEnabled}
                          onChange={(event) =>
                            update("interestEnabled", event.target.checked)
                          }
                          className="h-5 w-5 accent-[#0D1B2A]"
                        />
                      </label>

                      {form.interestEnabled && (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <TextField
                            label="Taxa de juros (%)"
                            value={form.interestRate}
                            onChange={(value) => update("interestRate", value)}
                            inputMode="decimal"
                            required
                          />
                          <SelectField
                            label="Periodicidade"
                            value={form.interestPeriod}
                            onChange={(value) =>
                              update("interestPeriod", value as InterestPeriod)
                            }
                            options={[
                              { value: "daily", label: "Ao dia" },
                              { value: "monthly", label: "Ao mês" },
                              { value: "yearly", label: "Ao ano" },
                            ]}
                          />
                          <SelectField
                            label="Método"
                            value={form.interestMethod}
                            onChange={(value) =>
                              update("interestMethod", value as InterestMethod)
                            }
                            options={[
                              { value: "simple", label: "Juros simples" },
                              { value: "compound", label: "Juros compostos" },
                            ]}
                          />
                          <label className="flex items-center justify-between rounded-xl border border-[#0D1B2A]/10 bg-white p-4">
                            <span className="text-sm font-medium text-[#0D1B2A]">
                              Calcular automaticamente
                            </span>
                            <input
                              type="checkbox"
                              checked={form.autoAccrueInterest}
                              onChange={(event) =>
                                update("autoAccrueInterest", event.target.checked)
                              }
                              className="h-5 w-5 accent-[#0D1B2A]"
                            />
                          </label>
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <TextField
                          label="Multa (%)"
                          value={form.penaltyRate}
                          onChange={(value) => update("penaltyRate", value)}
                          inputMode="decimal"
                        />
                        <TextField
                          label="Juros de atraso ao dia (%)"
                          value={form.dailyLateInterestRate}
                          onChange={(value) =>
                            update("dailyLateInterestRate", value)
                          }
                          inputMode="decimal"
                        />
                        <TextField
                          label="Carência em dias"
                          value={form.gracePeriodDays}
                          onChange={(value) => update("gracePeriodDays", value)}
                          inputMode="numeric"
                        />
                      </div>
                    </>
                  )}

                  {form.kind === "debt_payment" && (
                    <>
                      <SectionTitle icon={CircleDollarSign} title="Pagar dívida" />
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <SelectField
                          label="Dívida"
                          value={form.debtId}
                          onChange={(value) => {
                            update("debtId", value);
                            const debt = debts.find((item) => item.id === value);
                            update(
                              "amount",
                              debt
                                ? toNumber(debt.projected_balance)
                                    .toFixed(2)
                                    .replace(".", ",")
                                : "",
                            );
                          }}
                          options={debts.map((debt) => ({
                            value: debt.id,
                            label: `${debt.creditor} — ${formatCurrency(
                              debt.projected_balance,
                            )}`,
                          }))}
                          emptyLabel="Selecione"
                        />
                        <MoneyField
                          label="Valor pago"
                          value={form.amount}
                          onChange={(value) => update("amount", value)}
                          required
                        />
                        <AccountSelect
                          label="Conta que pagou"
                          value={form.accountId}
                          onChange={(value) => update("accountId", value)}
                          accounts={accounts}
                        />
                        <DateField
                          label="Data do pagamento"
                          value={form.date}
                          onChange={(value) => update("date", value)}
                        />
                        {selectedDebt?.total_installments && (
                          <label className="flex items-center gap-3 rounded-xl border border-[#0D1B2A]/10 bg-white p-4 md:col-span-2">
                            <input
                              type="checkbox"
                              checked={form.countInstallment}
                              onChange={(event) =>
                                update("countInstallment", event.target.checked)
                              }
                              className="h-5 w-5 accent-[#0D1B2A]"
                            />
                            <span className="text-sm text-[#0D1B2A]">
                              Contar como uma parcela paga
                            </span>
                          </label>
                        )}
                      </div>
                    </>
                  )}

                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Observações
                    </span>
                    <textarea
                      rows={3}
                      value={form.notes}
                      onChange={(event) => update("notes", event.target.value)}
                      placeholder="Informações adicionais..."
                      className="w-full resize-none rounded-xl border border-[#0D1B2A]/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#C8A15A]"
                    />
                  </label>
                </>
              )}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-[#0D1B2A]/10 px-6 py-4 sm:flex-row sm:justify-end sm:px-8">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="h-11 rounded-xl border border-[#0D1B2A]/15 px-5 text-sm font-semibold text-[#0D1B2A] hover:bg-white disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || loading || !canWrite}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-6 text-sm font-semibold text-[#F7F5EF] hover:bg-[#172D43] disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar registro
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

type IconType = typeof CircleDollarSign;

function SectionTitle({ icon: Icon, title }: { icon: IconType; title: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-[#0D1B2A]/8 pb-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D1B2A] text-[#C8A15A]">
        <Icon size={17} />
      </div>
      <h3 className="font-semibold text-[#0D1B2A]">{title}</h3>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: "text" | "numeric" | "decimal";
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-[#0D1B2A]">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
      />
    </label>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-[#0D1B2A]">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0,00"
        className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
      />
      {hint && <span className="block text-xs text-[#3A3A3C]/50">{hint}</span>}
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-[#0D1B2A]">{label}</span>
      <div className="relative">
        <CalendarDays
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#3A3A3C]/40"
        />
        <input
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white pl-10 pr-4 text-sm outline-none focus:border-[#C8A15A]"
        />
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  emptyLabel?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-[#0D1B2A]">{label}</span>
      <KyraSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={emptyLabel ?? "Selecione"}
        ariaLabel={label}
      />
    </label>
  );
}

function RecurringToggle({
  checked,
  onChange,
  day,
  endsOn,
  onEndsOnChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  day: number;
  endsOn: string;
  onEndsOnChange: (value: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[#0D1B2A]/10 bg-white p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#0D1B2A]"
        />
        <span>
          <span className="block text-sm font-semibold text-[#0D1B2A]">
            Repetir todo mês
          </span>
          <span className="mt-1 block text-xs leading-5 text-[#3A3A3C]/60">
            {Number.isFinite(day) && day > 0
              ? `O sistema criará automaticamente um novo lançamento por volta do dia ${day} de cada mês.`
              : "O sistema criará automaticamente um novo lançamento mensal."}
          </span>
        </span>
      </label>

      {checked && (
        <label className="mt-4 block border-t border-[#0D1B2A]/8 pt-4">
          <span className="block text-xs font-semibold text-[#0D1B2A]">
            Repetir até (opcional)
          </span>
          <input
            type="date"
            value={endsOn}
            onChange={(event) => onEndsOnChange(event.target.value)}
            className="mt-2 h-10 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-3 text-sm outline-none focus:border-[#C8A15A] sm:max-w-xs"
          />
          <span className="mt-1.5 block text-[11px] leading-5 text-[#3A3A3C]/55">
            Deixe vazio para continuar sem data final. Para uma escola contratada por 12 meses, informe o último mês do contrato.
          </span>
        </label>
      )}
    </div>
  );
}

function EssentialToggle({
  checked,
  onChange,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#C8A15A]/25 bg-[#C8A15A]/8 p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[#0D1B2A]"
      />
      <span>
        <span className="block text-sm font-semibold text-[#0D1B2A]">
          Despesa essencial
        </span>
        <span className="mt-1 block text-xs leading-5 text-[#3A3A3C]/60">
          {description}
        </span>
      </span>
    </label>
  );
}

function AccountSelect({
  label,
  value,
  onChange,
  accounts,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accounts: Account[];
  optional?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-[#0D1B2A]">{label}</span>
      <KyraSelect
        value={value}
        onChange={onChange}
        placeholder={optional ? "Opcional" : "Selecione"}
        ariaLabel={label}
        options={accounts.map((account) => ({
          value: account.id,
          label: `${account.name}${account.institution_name ? ` · ${account.institution_name}` : ""}`,
          description: formatCurrency(account.balance),
        }))}
      />
    </label>
  );
}
