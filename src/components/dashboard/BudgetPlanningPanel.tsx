"use client";

import {
  CalendarRange,
  Loader2,
  Pencil,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";
import { KyraSelect } from "@/components/ui/KyraSelect";

type Category = {
  id: string;
  name: string;
};

type Budget = {
  id: string;
  category_id: string;
  name: string;
  month: string;
  amount: number | string;
};

type ExpenseTransaction = {
  category_id: string | null;
  budget_id: string | null;
  status: "paid" | "planned" | "overdue" | "cancelled";
  amount: number | string;
  occurred_on: string;
  due_date: string | null;
};

type BudgetPlanningPanelProps = {
  defaultMonth: string;
};

function formatCurrency(value: number | string | null) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function parseAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  return Number(normalized);
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function formatMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function notifyFinancialDataChanged() {
  const version = String(Date.now());
  window.localStorage.setItem("pf:financial-data-version", version);
  window.dispatchEvent(
    new CustomEvent("pf:financial-data-changed", {
      detail: { version, source: "budget_planning" },
    }),
  );
}

export function BudgetPlanningPanel({
  defaultMonth,
}: BudgetPlanningPanelProps) {
  const { household, canWrite } = useHousehold();
  const [month, setMonth] = useState(defaultMonth);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<ExpenseTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [planCategoryId, setPlanCategoryId] = useState("");
  const [planName, setPlanName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [planAmount, setPlanAmount] = useState("");
  const [planMonth, setPlanMonth] = useState(defaultMonth);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(defaultMonth)) {
      setMonth(defaultMonth);
      setPlanMonth(defaultMonth);
    }
  }, [defaultMonth]);

  const loadData = useCallback(async () => {
    if (!month) return;

    setLoading(true);
    setError(null);

    const [categoriesResult, budgetsResult, transactionsResult] =
      await Promise.all([
        supabase
          .from("pf_categories")
          .select("id, name")
          .eq("household_id", household.id)
          .eq("kind", "expense")
          .order("name"),
        supabase
          .from("pf_budgets")
          .select("id, category_id, name, month, amount")
          .eq("household_id", household.id)
          .eq("month", `${month}-01`),
        supabase
          .from("pf_transactions")
          .select("category_id, budget_id, status, amount, occurred_on, due_date")
          .eq("household_id", household.id)
          .eq("type", "expense")
          .eq("status", "paid"),
      ]);

    const firstError =
      categoriesResult.error ?? budgetsResult.error ?? transactionsResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setCategories((categoriesResult.data ?? []) as Category[]);
    setBudgets((budgetsResult.data ?? []) as Budget[]);
    setTransactions((transactionsResult.data ?? []) as ExpenseTransaction[]);
    setLoading(false);
  }, [household.id, month]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const rows = useMemo(() => {
    const categoryMap = new Map(categories.map((category) => [category.id, category]));
    const budgetsByCategory = new Map<string, Budget[]>();
    const committedByBudget = new Map<string, number>();

    budgets.forEach((budget) => {
      const current = budgetsByCategory.get(budget.category_id) ?? [];
      current.push(budget);
      budgetsByCategory.set(budget.category_id, current);
    });

    transactions.forEach((transaction) => {
      if (!transaction.category_id || transaction.status !== "paid") return;
      if (monthKey(transaction.occurred_on) !== month) return;

      let budgetId = transaction.budget_id;

      if (!budgetId) {
        const categoryBudgets = budgetsByCategory.get(transaction.category_id) ?? [];
        if (categoryBudgets.length === 1) {
          budgetId = categoryBudgets[0].id;
        }
      }

      if (!budgetId) return;

      committedByBudget.set(
        budgetId,
        (committedByBudget.get(budgetId) ?? 0) + Number(transaction.amount || 0),
      );
    });

    return budgets
      .map((budget) => {
        const planned = Number(budget.amount || 0);
        const committed = committedByBudget.get(budget.id) ?? 0;
        return {
          ...budget,
          planName: budget.name,
          categoryName: categoryMap.get(budget.category_id)?.name ?? "Categoria removida",
          planned,
          committed,
          remaining: planned - committed,
        };
      })
      .sort((first, second) => first.planName.localeCompare(second.planName, "pt-BR"));
  }, [budgets, categories, transactions, month]);

  const summary = useMemo(() => {
    const planned = rows.reduce((total, row) => total + row.planned, 0);
    const committed = rows.reduce((total, row) => total + row.committed, 0);
    const difference = planned - committed;

    return {
      planned,
      committed,
      difference,
      exceeded: difference < 0,
    };
  }, [rows]);

  function resetForm() {
    setShowForm(false);
    setPlanCategoryId("");
    setPlanName("");
    setNewCategoryName("");
    setPlanAmount("");
    setPlanMonth(month);
    setEditingBudgetId(null);
    setError(null);
  }

  function startNewPlan() {
    setPlanCategoryId("");
    setPlanName("");
    setNewCategoryName("");
    setPlanAmount("");
    setPlanMonth(month);
    setEditingBudgetId(null);
    setShowForm(true);
    setError(null);
  }

  function startEdit(row: (typeof rows)[number]) {
    setPlanCategoryId(row.category_id);
    setPlanName(row.planName);
    setNewCategoryName("");
    setPlanAmount(row.planned.toFixed(2).replace(".", ","));
    setPlanMonth(row.month.slice(0, 7));
    setEditingBudgetId(row.id);
    setShowForm(true);
    setError(null);
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    const categoryName = newCategoryName.trim().replace(/\s+/g, " ");
    const normalizedPlanName = planName.trim().replace(/\s+/g, " ");
    const amount = parseAmount(planAmount);

    if (!normalizedPlanName) {
      setError("Informe um nome para o planejamento.");
      return;
    }

    if (!planCategoryId) {
      setError("Selecione a categoria que este planejamento vai controlar.");
      return;
    }

    if (planCategoryId === "__new__" && !categoryName) {
      setError("Informe o nome da nova categoria.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Informe um valor planejado maior que zero.");
      return;
    }

    if (!/^\d{4}-\d{2}$/.test(planMonth)) {
      setError("Selecione o mês do planejamento.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let categoryId =
        planCategoryId === "__new__" ? null : planCategoryId;

      if (!categoryId) {
        const existing = categories.find(
          (category) =>
            category.name.localeCompare(categoryName, "pt-BR", {
              sensitivity: "base",
            }) === 0,
        );

        if (existing) {
          categoryId = existing.id;
        } else {
          const categoryResult = await supabase
            .from("pf_categories")
            .insert({
              household_id: household.id,
              name: categoryName,
              kind: "expense",
              group_type: "other",
              is_system: false,
            })
            .select("id, name")
            .single();

          if (categoryResult.error) throw categoryResult.error;
          categoryId = categoryResult.data.id;
        }
      }

      if (!categoryId) {
        throw new Error("Não foi possível definir a categoria do planejamento.");
      }

      if (editingBudgetId) {
        const updateResult = await supabase
          .from("pf_budgets")
          .update({
            category_id: categoryId,
            name: normalizedPlanName,
            amount,
            month: `${planMonth}-01`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingBudgetId)
          .eq("household_id", household.id);

        if (updateResult.error) throw updateResult.error;
      } else {
        const budgetResult = await supabase.from("pf_budgets").upsert(
          {
            household_id: household.id,
            category_id: categoryId,
            name: normalizedPlanName,
            month: `${planMonth}-01`,
            amount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "household_id,category_id,month,name" },
        );

        if (budgetResult.error) throw budgetResult.error;
      }

      setMonth(planMonth);
      resetForm();
      notifyFinancialDataChanged();
      await loadData();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar o planejamento.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deletePlan(row: (typeof rows)[number]) {
    if (!canWrite) {
      setError("Seu acesso é somente leitura.");
      return;
    }

    if (!window.confirm(`Excluir o planejamento "${row.planName}" deste mês?`)) {
      return;
    }

    setSaving(true);
    setError(null);

    const result = await supabase
      .from("pf_budgets")
      .delete()
      .eq("id", row.id)
      .eq("household_id", household.id);

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    notifyFinancialDataChanged();
    await loadData();
    setSaving(false);
  }

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
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#3A3A3C]/60">
            Reserve um valor para uma categoria. Somente gastos efetivamente pagos nessa categoria e nesse mês consomem o planejamento.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <CalendarRange
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#3A3A3C]/45"
            />
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="h-10 rounded-xl border border-[#0D1B2A]/12 bg-white pl-9 pr-3 text-xs font-medium text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
            />
          </label>
          <button
            type="button"
            onClick={startNewPlan}
            disabled={!canWrite}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Plus size={15} />
            Planejar gasto
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={savePlan}
          className="mt-5 rounded-xl border border-[#C8A15A]/25 bg-[#F7F5EF] p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(190px,0.9fr)_minmax(220px,1.1fr)_180px_180px_auto] lg:items-end">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-[#0D1B2A]">
                Nome do planejamento
              </span>
              <input
                type="text"
                value={planName}
                onChange={(event) => setPlanName(event.target.value)}
                placeholder="Ex.: Roupa"
                className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-3 text-sm outline-none focus:border-[#C8A15A]"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-[#0D1B2A]">
                Categoria do planejamento
              </span>
              <KyraSelect
                value={planCategoryId}
                onChange={(value) => {
                  setPlanCategoryId(value);
                  if (value !== "__new__") {
                    setNewCategoryName("");
                  }
                }}
                placeholder="Selecione uma categoria"
                options={[
                  ...categories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                  {
                    value: "__new__",
                    label: "+ Criar nova categoria",
                    description: "Crie uma categoria específica para este planejamento.",
                  },
                ]}
                ariaLabel="Categoria do planejamento"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-[#0D1B2A]">
                Valor planejado
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={planAmount}
                onChange={(event) => setPlanAmount(event.target.value)}
                placeholder="0,00"
                className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-3 text-sm outline-none focus:border-[#C8A15A]"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-[#0D1B2A]">
                Mês do planejamento
              </span>
              <input
                type="month"
                value={planMonth}
                onChange={(event) => setPlanMonth(event.target.value)}
                className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-3 text-sm outline-none focus:border-[#C8A15A]"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0D1B2A] px-4 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : "Salvar"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#0D1B2A]/12 bg-white text-[#0D1B2A] disabled:opacity-50"
                aria-label="Cancelar"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {planCategoryId === "__new__" && (
            <label className="mt-3 block max-w-xl space-y-1.5">
              <span className="text-xs font-semibold text-[#0D1B2A]">
                Nome da nova categoria
              </span>
              <input
                type="text"
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Ex.: Aniversário da minha filha"
                className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-3 text-sm outline-none focus:border-[#C8A15A]"
              />
              <span className="block text-[11px] leading-4 text-[#3A3A3C]/55">
                As movimentações dessa categoria, no mesmo mês, consumirão este planejamento automaticamente.
              </span>
            </label>
          )}
        </form>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-28 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[#C8A15A]" />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-[#0D1B2A]/15 px-4 py-8 text-center">
          <p className="text-sm font-medium text-[#0D1B2A]">
            Nenhum gasto planejado para este mês.
          </p>
          <p className="mt-1 text-xs text-[#3A3A3C]/55">
            Ex.: R$ 500 para aniversário ou R$ 2.350 reservados para contabilidade.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PlanningSummaryCard label="Planejado" value={summary.planned} />
            <PlanningSummaryCard
              label="Usado/pago"
              value={summary.committed}
            />
            <PlanningSummaryCard
              label={summary.exceeded ? "Excesso vs planejado" : "Economia / saldo"}
              value={Math.abs(summary.difference)}
              negative={summary.exceeded}
              detail={
                summary.exceeded
                  ? "acima do valor planejado"
                  : "abaixo do valor planejado até agora"
              }
            />
          </div>

          <div className="mt-5 divide-y divide-[#0D1B2A]/8">
          {rows.map((row) => {
            const exceeded = row.remaining < 0;
            const remaining = Math.abs(row.remaining);
            const percentage =
              row.planned > 0
                ? Math.min(100, (row.committed / row.planned) * 100)
                : 0;

            return (
              <div
                key={row.id}
                className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[1.4fr_repeat(3,minmax(120px,0.7fr))_auto] lg:items-center"
              >
                <div>
                  <p className="font-semibold text-[#0D1B2A]">{row.planName}</p>
                  <p className="mt-0.5 text-xs text-[#3A3A3C]/50">{row.categoryName}</p>
                  <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-[#0D1B2A]/8">
                    <div
                      className={[
                        "h-full rounded-full",
                        exceeded ? "bg-red-600" : "bg-[#C8A15A]",
                      ].join(" ")}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
                <PlanningValue label="Planejado" value={row.planned} />
                <PlanningValue label="Usado/pago" value={row.committed} />
                <PlanningValue
                  label={exceeded ? "Excedido" : "Ainda reservado"}
                  value={remaining}
                  negative={exceeded}
                />
                <div className="flex items-center gap-1 lg:justify-end">
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    disabled={!canWrite || saving}
                    className="rounded-lg p-2 text-[#3A3A3C]/55 transition hover:bg-[#F7F5EF] hover:text-[#0D1B2A] disabled:opacity-40"
                    title="Ajustar valor planejado"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deletePlan(row)}
                    disabled={!canWrite || saving}
                    className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                    title="Excluir planejamento"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}

      <div className="mt-5 rounded-xl bg-[#F7F5EF] px-4 py-3 text-xs leading-5 text-[#3A3A3C]/60">
        O planejamento pertence a <strong>{formatMonth(month)}</strong> e possui nome + categoria. Ao registrar uma despesa paga, o Kyra permite vinculá-la ao planejamento correto. Quando existe apenas um planejamento daquela categoria no mês, o vínculo é automático. Uma conta apenas A pagar ainda não reduz a reserva.
      </div>
    </section>
  );
}

function PlanningSummaryCard({
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
      <p
        className={[
          "mt-1 text-lg font-semibold",
          negative ? "text-red-700" : "text-[#0D1B2A]",
        ].join(" ")}
      >
        {formatCurrency(value)}
      </p>
      {detail && (
        <p className="mt-1 text-[11px] text-[#3A3A3C]/50">{detail}</p>
      )}
    </div>
  );
}

function PlanningValue({
  label,
  value,
  negative = false,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
        {label}
      </p>
      <p
        className={[
          "mt-1 text-sm font-semibold",
          negative ? "text-red-700" : "text-[#0D1B2A]",
        ].join(" ")}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}
