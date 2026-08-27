"use client";

import {
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Power,
  RefreshCw,
  Repeat2,
  TrendingDown,
  TrendingUp,
  Variable,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type RecurringType =
  | "income"
  | "expense";

type TransactionStatus =
  | "planned"
  | "paid"
  | "overdue"
  | "cancelled";

type RecurringTemplate = {
  id: string;
  household_id: string;
  account_id: string;
  category_id: string | null;

  type: RecurringType;

  description: string;
  merchant: string | null;

  amount: number | string | null;
  day_of_month: number;

  is_variable: boolean;
  auto_generate: boolean;

  starts_on: string;
  ends_on: string | null;

  is_active: boolean;
  notes: string | null;
};

type RecurringTransaction = {
  id: string;
  recurrence_key: string | null;

  status: TransactionStatus;

  amount: number | string;

  due_date: string | null;
};

type EditForm = {
  amount: string;
  day_of_month: string;

  starts_on: string;
  ends_on: string;

  is_variable: boolean;
  is_active: boolean;
};

type VariableForm = {
  amount: string;
  status: "planned" | "paid";
};

function getMonthStart() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(
      now.getMonth() + 1,
    ).padStart(2, "0"),
    "01",
  ].join("-");
}

function getMonthEnd() {
  const now = new Date();

  const lastDay = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  );

  return [
    lastDay.getFullYear(),
    String(
      lastDay.getMonth() + 1,
    ).padStart(2, "0"),
    String(
      lastDay.getDate(),
    ).padStart(2, "0"),
  ].join("-");
}

function parseAmount(value: string) {
  const cleanedValue =
    value.trim();

  if (!cleanedValue) {
    return Number.NaN;
  }

  const normalizedValue =
    cleanedValue.includes(",")
      ? cleanedValue
          .replace(/\./g, "")
          .replace(",", ".")
      : cleanedValue;

  return Number(
    normalizedValue,
  );
}

function formatCurrency(
  value:
    | number
    | string
    | null,
) {
  const parsedValue =
    Number(value ?? 0);

  return new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    },
  ).format(
    Number.isFinite(parsedValue)
      ? parsedValue
      : 0,
  );
}

function getStatusLabel(
  status: TransactionStatus,
) {
  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  if (status === "planned") {
    return "Planejado";
  }

  if (status === "paid") {
    return "Realizado";
  }

  if (status === "overdue") {
    return "Atrasado";
  }

  if (status === "cancelled") {
    return "Cancelado";
  }

  return today;
}

function getStatusClasses(
  status: TransactionStatus,
) {
  const styles: Record<
    TransactionStatus,
    string
  > = {
    planned:
      "bg-amber-50 text-amber-700",

    paid:
      "bg-emerald-50 text-emerald-700",

    overdue:
      "bg-red-50 text-red-700",

    cancelled:
      "bg-gray-100 text-gray-500",
  };

  return styles[status];
}

export function RecurringTransactionsPanel() {
  const { household } =
    useHousehold();

  const [
    templates,
    setTemplates,
  ] = useState<
    RecurringTemplate[]
  >([]);



  const [
    recurringTransactions,
    setRecurringTransactions,
  ] = useState<
    RecurringTransaction[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    generating,
    setGenerating,
  ] = useState(false);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const [
    editingTemplate,
    setEditingTemplate,
  ] = useState<
    RecurringTemplate | null
  >(null);

  const [
    variableTemplate,
    setVariableTemplate,
  ] = useState<
    RecurringTemplate | null
  >(null);

  const [
    editForm,
    setEditForm,
  ] = useState<EditForm>({
    amount: "",
    day_of_month: "",
    starts_on: "",
    ends_on: "",
    is_variable: false,
    is_active: true,
  });

  const [
    variableForm,
    setVariableForm,
  ] = useState<VariableForm>({
    amount: "",
    status: "planned",
  });

  const loadData =
    useCallback(
      async (
        generateMonth = true,
      ) => {
        setLoading(true);
        setError(null);

        if (generateMonth) {
          const {
            error:
              generationError,
          } = await supabase.rpc(
            "pf_generate_recurring_transactions",
            {
              target_month:
                getMonthStart(),
            },
          );

          if (generationError) {
            console.error(
              "Erro ao gerar recorrências:",
              generationError,
            );
          }
        }

        const [
          templatesResult,
          transactionsResult,
        ] = await Promise.all([
          supabase
            .from(
              "pf_recurring_templates",
            )
            .select("*")
            .eq(
              "household_id",
              household.id,
            )
            .order(
              "day_of_month",
              {
                ascending: true,
              },
            ),

          supabase
            .from(
              "pf_transactions",
            )
            .select("id, recurrence_key, status, amount, due_date")
            .eq(
              "household_id",
              household.id,
            )
            .not(
              "recurrence_key",
              "is",
              null,
            )
            .gte(
              "due_date",
              getMonthStart(),
            )
            .lte(
              "due_date",
              getMonthEnd(),
            ),
        ]);

        if (
          templatesResult.error
        ) {
          console.error(
            "Erro ao carregar recorrências:",
            templatesResult.error,
          );

          setError(
            "Não foi possível carregar os lançamentos recorrentes.",
          );

          setLoading(false);
          return;
        }



        if (
          transactionsResult.error
        ) {
          console.error(
            "Erro ao carregar recorrências do mês:",
            transactionsResult.error,
          );

          setError(
            "Não foi possível carregar os lançamentos do mês.",
          );

          setLoading(false);
          return;
        }

        setTemplates(
          (
            templatesResult.data ??
            []
          ) as unknown as RecurringTemplate[],
        );



        setRecurringTransactions(
          (
            transactionsResult.data ??
            []
          ) as unknown as RecurringTransaction[],
        );

        setLoading(false);
      },
      [household.id],
    );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (
      !editingTemplate &&
      !variableTemplate
    ) {
      return;
    }

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, [
    editingTemplate,
    variableTemplate,
  ]);

  const transactionMap =
    useMemo(() => {
      return new Map(
        recurringTransactions
          .filter(
            (transaction) =>
              transaction.recurrence_key,
          )
          .map(
            (transaction) => [
              transaction.recurrence_key as string,
              transaction,
            ],
          ),
      );
    }, [
      recurringTransactions,
    ]);


  async function generateMonth() {
    setGenerating(true);
    setError(null);

    const {
      error:
        generationError,
    } = await supabase.rpc(
      "pf_generate_recurring_transactions",
      {
        target_month:
          getMonthStart(),
      },
    );

    if (generationError) {
      console.error(
        "Erro ao gerar mês:",
        generationError,
      );

      setError(
        generationError.message ||
          "Não foi possível gerar os lançamentos.",
      );

      setGenerating(false);
      return;
    }

    setGenerating(false);

    await loadData(false);
  }

  async function toggleTemplate(
    template:
      RecurringTemplate,
  ) {
    setError(null);

    const {
      error: updateError,
    } = await supabase
      .from(
        "pf_recurring_templates",
      )
      .update({
        is_active:
          !template.is_active,

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        template.id,
      )
      .eq(
        "household_id",
        household.id,
      );

    if (updateError) {
      console.error(
        "Erro ao alterar recorrência:",
        updateError,
      );

      setError(
        "Não foi possível alterar a recorrência.",
      );

      return;
    }

    await loadData(false);
  }

  function openEdit(
    template:
      RecurringTemplate,
  ) {
    setEditingTemplate(
      template,
    );

    setEditForm({
      amount:
        template.amount ===
        null
          ? ""
          : String(
              template.amount,
            ),

      day_of_month:
        String(
          template.day_of_month,
        ),

      starts_on:
        template.starts_on,

      ends_on:
        template.ends_on ??
        "",

      is_variable:
        template.is_variable,

      is_active:
        template.is_active,
    });

    setError(null);
  }

  function openVariable(
    template:
      RecurringTemplate,
  ) {
    const currentTransaction =
      transactionMap.get(
        template.id,
      );

    setVariableTemplate(
      template,
    );

    setVariableForm({
      amount:
        currentTransaction
          ? String(
              currentTransaction.amount,
            )
          : "",

      status:
        currentTransaction
          ?.status === "paid"
          ? "paid"
          : "planned",
    });

    setError(null);
  }

  async function saveTemplate(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!editingTemplate) {
      return;
    }

    const day =
      Number.parseInt(
        editForm.day_of_month,
        10,
      );

    if (
      !Number.isFinite(day) ||
      day < 1 ||
      day > 31
    ) {
      setError(
        "Informe um dia entre 1 e 31.",
      );

      return;
    }

    let parsedAmount:
      | number
      | null = null;

    if (
      !editForm.is_variable
    ) {
      parsedAmount =
        parseAmount(
          editForm.amount,
        );

      if (
        !Number.isFinite(
          parsedAmount,
        ) ||
        parsedAmount <= 0
      ) {
        setError(
          "Informe um valor válido.",
        );

        return;
      }
    }

    setSaving(true);
    setError(null);

    const {
      error: updateError,
    } = await supabase
      .from(
        "pf_recurring_templates",
      )
      .update({
        amount:
          editForm.is_variable
            ? null
            : parsedAmount,

        day_of_month:
          day,

        is_variable:
          editForm.is_variable,

        auto_generate:
          !editForm.is_variable,

        starts_on:
          editForm.starts_on,

        ends_on:
          editForm.ends_on ||
          null,

        is_active:
          editForm.is_active,

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        editingTemplate.id,
      )
      .eq(
        "household_id",
        household.id,
      );

    if (updateError) {
      console.error(
        "Erro ao salvar recorrência:",
        updateError,
      );

      setError(
        updateError.message ||
          "Não foi possível salvar a recorrência.",
      );

      setSaving(false);
      return;
    }

    setSaving(false);
    setEditingTemplate(null);

    await loadData(false);
  }

  async function saveVariable(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!variableTemplate) {
      return;
    }

    const amount =
      parseAmount(
        variableForm.amount,
      );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setError(
        "Informe um valor maior que zero.",
      );

      return;
    }

    setSaving(true);
    setError(null);

    const {
      error:
        registerError,
    } = await supabase.rpc(
      "pf_register_variable_recurring",
      {
        target_template_id:
          variableTemplate.id,

        target_amount:
          amount,

        target_month:
          getMonthStart(),

        target_status:
          variableForm.status,
      },
    );

    if (registerError) {
      console.error(
        "Erro ao registrar valor variável:",
        registerError,
      );

      setError(
        registerError.message ||
          "Não foi possível registrar o valor.",
      );

      setSaving(false);
      return;
    }

    setSaving(false);
    setVariableTemplate(null);

    await loadData(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}



      <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#0D1B2A]">
              Lançamentos recorrentes
            </h2>

            <p className="mt-1 text-sm text-[#3A3A3C]/60">
              Valores fixos são gerados como
              planejados. Água e luz aguardam o
              valor real do mês.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void generateMonth()
            }
            disabled={generating}
            className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}

            Gerar este mês
          </button>
        </div>

        <div className="mt-5 divide-y divide-[#0D1B2A]/8">
          {templates.map(
            (template) => {
              const transaction =
                transactionMap.get(
                  template.id,
                );

              return (
                <article
                  key={template.id}
                  className={[
                    "grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(220px,1.4fr)_minmax(120px,.65fr)_minmax(100px,.55fr)_minmax(130px,.7fr)_auto] lg:items-center",
                    template.is_active
                      ? ""
                      : "opacity-55",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {template.type ===
                      "income" ? (
                        <TrendingUp
                          size={16}
                          className="shrink-0 text-emerald-700"
                        />
                      ) : (
                        <TrendingDown
                          size={16}
                          className="shrink-0 text-red-700"
                        />
                      )}

                      <p className="truncate font-semibold text-[#0D1B2A]">
                        {
                          template.description
                        }
                      </p>
                    </div>

                    <p className="mt-1 truncate pl-6 text-xs text-[#3A3A3C]/55">
                      {template.merchant ||
                        "Sem estabelecimento"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
                      Valor
                    </p>

                    <p className="mt-1 text-sm font-semibold text-[#0D1B2A]">
                      {template.is_variable
                        ? "Variável"
                        : formatCurrency(
                            template.amount,
                          )}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
                      Vencimento
                    </p>

                    <p className="mt-1 text-sm font-semibold text-[#0D1B2A]">
                      Dia{" "}
                      {
                        template.day_of_month
                      }
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
                      Neste mês
                    </p>

                    {transaction ? (
                      <span
                        className={[
                          "mt-1 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
                          getStatusClasses(
                            transaction.status,
                          ),
                        ].join(" ")}
                      >
                        {getStatusLabel(
                          transaction.status,
                        )}
                      </span>
                    ) : template.is_variable ? (
                      <span className="mt-1 inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                        Aguardando valor
                      </span>
                    ) : template.is_active ? (
                      <span className="mt-1 inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                        Não gerado
                      </span>
                    ) : (
                      <span className="mt-1 inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                        Inativo
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                    {template.is_variable &&
                      template.is_active && (
                        <button
                          type="button"
                          onClick={() =>
                            openVariable(
                              template,
                            )
                          }
                          className="flex h-9 items-center gap-2 rounded-lg bg-[#0D1B2A] px-3 text-xs font-semibold text-white"
                        >
                          <Variable
                            size={15}
                          />

                          Informar valor
                        </button>
                      )}

                    <button
                      type="button"
                      onClick={() =>
                        openEdit(
                          template,
                        )
                      }
                      className="flex h-9 items-center justify-center rounded-lg p-2 text-[#3A3A3C]/60 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]"
                      title="Editar recorrência"
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void toggleTemplate(
                          template,
                        )
                      }
                      className={[
                        "flex h-9 items-center justify-center rounded-lg p-2",
                        template.is_active
                          ? "text-emerald-700 hover:bg-emerald-50"
                          : "text-gray-500 hover:bg-gray-100",
                      ].join(" ")}
                      title={
                        template.is_active
                          ? "Desativar recorrência"
                          : "Ativar recorrência"
                      }
                    >
                      <Power size={16} />
                    </button>
                  </div>
                </article>
              );
            },
          )}
        </div>
      </section>



      {editingTemplate && (
        <div className="fixed inset-0 z-[140] overflow-y-auto bg-[#0D1B2A]/55 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center p-4 pb-28">
            <div className="w-full max-w-xl rounded-3xl border border-[#C8A15A]/25 bg-[#F7F5EF] shadow-2xl">
              <div className="flex items-start justify-between border-b border-[#0D1B2A]/10 px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#C8A15A]">
                    Configurar recorrência
                  </p>

                  <h2 className="mt-2 text-2xl font-semibold text-[#0D1B2A]">
                    {
                      editingTemplate.description
                    }
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!saving) {
                      setEditingTemplate(
                        null,
                      );

                      setError(null);
                    }
                  }}
                  className="rounded-full p-2 text-[#3A3A3C]/60 hover:bg-white"
                  aria-label="Fechar"
                >
                  <X size={20} />
                </button>
              </div>

              <form
                onSubmit={saveTemplate}
                className="space-y-5 px-6 py-6"
              >
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#0D1B2A]/10 bg-white p-4">
                  <div>
                    <p className="text-sm font-medium text-[#0D1B2A]">
                      Valor variável
                    </p>

                    <p className="mt-1 text-xs text-[#3A3A3C]/55">
                      Solicita o valor real a cada
                      mês.
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={
                      editForm.is_variable
                    }
                    onChange={(event) =>
                      setEditForm(
                        (
                          currentForm,
                        ) => ({
                          ...currentForm,

                          is_variable:
                            event.target
                              .checked,
                        }),
                      )
                    }
                    className="h-5 w-5 accent-[#0D1B2A]"
                  />
                </label>

                {!editForm.is_variable && (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Valor mensal
                    </span>

                    <input
                      type="text"
                      inputMode="decimal"
                      value={
                        editForm.amount
                      }
                      onChange={(event) =>
                        setEditForm(
                          (
                            currentForm,
                          ) => ({
                            ...currentForm,

                            amount:
                              event.target
                                .value,
                          }),
                        )
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>
                )}

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    Dia do mês
                  </span>

                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={
                      editForm.day_of_month
                    }
                    onChange={(event) =>
                      setEditForm(
                        (
                          currentForm,
                        ) => ({
                          ...currentForm,

                          day_of_month:
                            event.target
                              .value,
                        }),
                      )
                    }
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                  />
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Início
                    </span>

                    <input
                      type="date"
                      value={
                        editForm.starts_on
                      }
                      onChange={(event) =>
                        setEditForm(
                          (
                            currentForm,
                          ) => ({
                            ...currentForm,

                            starts_on:
                              event.target
                                .value,
                          }),
                        )
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-medium text-[#0D1B2A]">
                      Encerrar em
                    </span>

                    <input
                      type="date"
                      value={
                        editForm.ends_on
                      }
                      onChange={(event) =>
                        setEditForm(
                          (
                            currentForm,
                          ) => ({
                            ...currentForm,

                            ends_on:
                              event.target
                                .value,
                          }),
                        )
                      }
                      className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                    />
                  </label>
                </div>

                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#0D1B2A]/10 bg-white p-4">
                  <div>
                    <p className="text-sm font-medium text-[#0D1B2A]">
                      Recorrência ativa
                    </p>

                    <p className="mt-1 text-xs text-[#3A3A3C]/55">
                      Desative quando a cobrança
                      deixar de existir.
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={
                      editForm.is_active
                    }
                    onChange={(event) =>
                      setEditForm(
                        (
                          currentForm,
                        ) => ({
                          ...currentForm,

                          is_active:
                            event.target
                              .checked,
                        }),
                      )
                    }
                    className="h-5 w-5 accent-[#0D1B2A]"
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
                    onClick={() => {
                      if (!saving) {
                        setEditingTemplate(
                          null,
                        );

                        setError(null);
                      }
                    }}
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

                    Salvar configuração
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {variableTemplate && (
        <div className="fixed inset-0 z-[140] overflow-y-auto bg-[#0D1B2A]/55 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center p-4 pb-28">
            <div className="w-full max-w-lg rounded-3xl border border-[#C8A15A]/25 bg-[#F7F5EF] shadow-2xl">
              <div className="flex items-start justify-between border-b border-[#0D1B2A]/10 px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#C8A15A]">
                    Valor do mês
                  </p>

                  <h2 className="mt-2 text-2xl font-semibold text-[#0D1B2A]">
                    {
                      variableTemplate.description
                    }
                  </h2>

                  <p className="mt-1 text-sm text-[#3A3A3C]/60">
                    {
                      variableTemplate.merchant
                    }{" "}
                    • dia{" "}
                    {
                      variableTemplate.day_of_month
                    }
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!saving) {
                      setVariableTemplate(
                        null,
                      );

                      setError(null);
                    }
                  }}
                  className="rounded-full p-2 text-[#3A3A3C]/60 hover:bg-white"
                  aria-label="Fechar"
                >
                  <X size={20} />
                </button>
              </div>

              <form
                onSubmit={saveVariable}
                className="space-y-5 px-6 py-6"
              >
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    Valor
                  </span>

                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={
                      variableForm.amount
                    }
                    onChange={(event) =>
                      setVariableForm(
                        (
                          currentForm,
                        ) => ({
                          ...currentForm,

                          amount:
                            event.target
                              .value,
                        }),
                      )
                    }
                    placeholder="0,00"
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-[#0D1B2A]">
                    Status
                  </span>

                  <select
                    value={
                      variableForm.status
                    }
                    onChange={(event) =>
                      setVariableForm(
                        (
                          currentForm,
                        ) => ({
                          ...currentForm,

                          status:
                            event.target
                              .value as
                              | "planned"
                              | "paid",
                        }),
                      )
                    }
                    className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none"
                  >
                    <option value="planned">
                      Planejado
                    </option>

                    <option value="paid">
                      Já foi pago
                    </option>
                  </select>
                </label>

                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (!saving) {
                        setVariableTemplate(
                          null,
                        );

                        setError(null);
                      }
                    }}
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

                    Registrar valor
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
