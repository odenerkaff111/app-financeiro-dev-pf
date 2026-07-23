"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type AccountRow = {
  balance: number | string;
  type: string;
  is_active: boolean;
};

type TransactionRow = {
  type: string;
  status: string;
  amount: number | string;
  occurred_on: string;
  due_date: string | null;
  recurrence_key: string | null;
};

type DebtRow = {
  installment_amount:
    | number
    | string
    | null;

  status: string;
};

type RecurringTemplateRow = {
  id: string;

  type:
    | "income"
    | "expense";

  amount:
    | number
    | string
    | null;

  is_variable: boolean;
  is_active: boolean;

  starts_on: string;
  ends_on: string | null;
};

function formatCurrency(
  value: number,
) {
  return new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency: "BRL",
    },
  ).format(
    Number.isFinite(value)
      ? value
      : 0,
  );
}

function toDateKey(
  date: Date,
) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      date.getDate(),
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getCurrentMonthBounds() {
  const now =
    new Date();

  const start =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    );

  const next =
    new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
    );

  const end =
    new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    );

  return {
    start:
      toDateKey(start),

    next:
      toDateKey(next),

    end:
      toDateKey(end),
  };
}

function isPending(
  transaction:
    TransactionRow,
) {
  return (
    transaction.status ===
      "planned" ||
    transaction.status ===
      "overdue"
  );
}

function isPaid(
  transaction:
    TransactionRow,
) {
  return (
    transaction.status ===
    "paid"
  );
}

function isCashIncome(
  transaction:
    TransactionRow,
) {
  return (
    transaction.type ===
      "income" ||
    transaction.type ===
      "investment_withdrawal"
  );
}

function isCashExpense(
  transaction:
    TransactionRow,
) {
  return (
    transaction.type ===
      "expense" ||
    transaction.type ===
      "debt_payment" ||
    transaction.type ===
      "investment_contribution"
  );
}

function sumTransactions(
  transactions:
    TransactionRow[],

  predicate: (
    transaction:
      TransactionRow,
  ) => boolean,
) {
  return transactions.reduce(
    (
      total,
      transaction,
    ) => {
      if (
        !predicate(
          transaction,
        )
      ) {
        return total;
      }

      return (
        total +
        Number(
          transaction.amount ||
            0,
        )
      );
    },
    0,
  );
}

export function MonthlyClosingSection() {
  const { household } =
    useHousehold();

  const [
    accounts,
    setAccounts,
  ] = useState<
    AccountRow[]
  >([]);

  const [
    transactions,
    setTransactions,
  ] = useState<
    TransactionRow[]
  >([]);

  const [
    debts,
    setDebts,
  ] = useState<
    DebtRow[]
  >([]);

  const [
    templates,
    setTemplates,
  ] = useState<
    RecurringTemplateRow[]
  >([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const monthBounds =
    useMemo(
      () =>
        getCurrentMonthBounds(),
      [],
    );

  const loadData =
    useCallback(
      async () => {
        setLoading(true);
        setError(null);

        const [
          accountsResult,
          transactionsResult,
          debtsResult,
          templatesResult,
        ] =
          await Promise.all([
            supabase
              .from(
                "pf_accounts",
              )
              .select(
                "balance, type, is_active",
              )
              .eq(
                "household_id",
                household.id,
              ),

            supabase
              .from(
                "pf_transactions",
              )
              .select(
                "type, status, amount, occurred_on, due_date, recurrence_key",
              )
              .eq(
                "household_id",
                household.id,
              )
              .gte(
                "occurred_on",
                monthBounds.start,
              )
              .lt(
                "occurred_on",
                monthBounds.next,
              ),

            supabase
              .from(
                "pf_debt_progress",
              )
              .select(
                "installment_amount, status",
              )
              .eq(
                "household_id",
                household.id,
              )
              .neq(
                "status",
                "cancelled",
              ),

            supabase
              .from(
                "pf_recurring_templates",
              )
              .select(
                "id, type, amount, is_variable, is_active, starts_on, ends_on",
              )
              .eq(
                "household_id",
                household.id,
              )
              .eq(
                "is_active",
                true,
              ),
          ]);

        const firstError =
          accountsResult.error ??
          transactionsResult.error ??
          debtsResult.error ??
          templatesResult.error;

        if (firstError) {
          console.error(
            "Erro ao calcular fechamento:",
            firstError,
          );

          setError(
            "Não foi possível calcular o fechamento do mês.",
          );

          setLoading(false);
          return;
        }

        setAccounts(
          (
            accountsResult.data ??
            []
          ) as unknown as
            AccountRow[],
        );

        setTransactions(
          (
            transactionsResult.data ??
            []
          ) as unknown as
            TransactionRow[],
        );

        setDebts(
          (
            debtsResult.data ??
            []
          ) as unknown as
            DebtRow[],
        );

        setTemplates(
          (
            templatesResult.data ??
            []
          ) as unknown as
            RecurringTemplateRow[],
        );

        setLoading(false);
      },
      [
        household.id,
        monthBounds.start,
        monthBounds.next,
      ],
    );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const calculation =
    useMemo(() => {
      const available =
        accounts
          .filter(
            (account) =>
              account.is_active &&
              [
                "checking",
                "savings",
                "cash",
                "wallet",
              ].includes(
                account.type,
              ),
          )
          .reduce(
            (
              total,
              account,
            ) =>
              total +
              Number(
                account.balance ||
                  0,
              ),
            0,
          );

      const pendingIncome =
        sumTransactions(
          transactions,
          (
            transaction,
          ) =>
            isPending(
              transaction,
            ) &&
            isCashIncome(
              transaction,
            ),
        );

      const pendingExpense =
        sumTransactions(
          transactions,
          (
            transaction,
          ) =>
            isPending(
              transaction,
            ) &&
            isCashExpense(
              transaction,
            ),
        );

      const paidDebt =
        sumTransactions(
          transactions,
          (
            transaction,
          ) =>
            isPaid(
              transaction,
            ) &&
            transaction.type ===
              "debt_payment",
        );

      const monthlyDebtCommitment =
        debts
          .filter(
            (debt) =>
              debt.status !==
              "paid",
          )
          .reduce(
            (
              total,
              debt,
            ) =>
              total +
              Number(
                debt.installment_amount ||
                  0,
              ),
            0,
          );

      const remainingDebt =
        Math.max(
          monthlyDebtCommitment -
            paidDebt,
          0,
        );

      const generatedTemplateIds =
        new Set(
          transactions
            .map(
              (
                transaction,
              ) =>
                transaction.recurrence_key,
            )
            .filter(
              (
                recurrenceKey,
              ): recurrenceKey is string =>
                Boolean(
                  recurrenceKey,
                ),
            ),
        );

      let missingFixedIncome =
        0;

      let missingFixedExpense =
        0;

      templates
        .filter(
          (template) =>
            template.is_active &&
            template.starts_on <=
              monthBounds.end &&
            (
              !template.ends_on ||
              template.ends_on >=
                monthBounds.start
            ),
        )
        .forEach(
          (template) => {
            if (
              generatedTemplateIds.has(
                template.id,
              )
            ) {
              return;
            }

            if (
              template.is_variable
            ) {
              return;
            }

            const amount =
              Number(
                template.amount ||
                  0,
              );

            if (
              template.type ===
              "income"
            ) {
              missingFixedIncome +=
                amount;

              return;
            }

            missingFixedExpense +=
              amount;
          },
        );

      const receivable =
        pendingIncome +
        missingFixedIncome;

      const payable =
        pendingExpense +
        missingFixedExpense +
        remainingDebt;

      const closing =
        available +
        receivable -
        payable;

      return {
        available,
        receivable,
        payable,
        closing,
      };
    }, [
      accounts,
      debts,
      monthBounds.end,
      monthBounds.start,
      templates,
      transactions,
    ]);

  if (loading) {
    return (
      <section className="flex min-h-36 items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {error}
      </section>
    );
  }

  const closesNegative =
    calculation.closing < 0;

  const difference =
    Math.abs(
      calculation.closing,
    );

  return (
    <section
      className={[
        "rounded-2xl border p-5 shadow-sm",
        closesNegative
          ? "border-red-200 bg-red-50"
          : "border-emerald-200 bg-emerald-50",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={[
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              closesNegative
                ? "bg-red-100 text-red-700"
                : "bg-emerald-100 text-emerald-700",
            ].join(" ")}
          >
            {closesNegative ? (
              <AlertTriangle
                size={21}
              />
            ) : (
              <CheckCircle2
                size={21}
              />
            )}
          </div>

          <div>
            <p className="text-sm font-semibold text-[#0D1B2A]">
              {closesNegative
                ? "Seu mês fecha no vermelho"
                : "Seu mês fecha positivo"}
            </p>

            <p
              className={[
                "mt-1 text-3xl font-semibold",
                closesNegative
                  ? "text-red-800"
                  : "text-emerald-800",
              ].join(" ")}
            >
              {closesNegative
                ? "-"
                : "+"}

              {formatCurrency(
                difference,
              )}
            </p>
          </div>
        </div>

        <p className="max-w-xl text-sm leading-6 text-[#3A3A3C]/70">
          {closesNegative
            ? `Faltam ${formatCurrency(
                difference,
              )} para pagar os compromissos previstos deste mês.`
            : `Depois dos compromissos previstos, devem sobrar ${formatCurrency(
                difference,
              )}.`}
        </p>
      </div>

      <p className="mt-4 border-t border-current/10 pt-3 text-xs text-[#3A3A3C]/55">
        Saldo atual{" "}
        {formatCurrency(
          calculation.available,
        )}{" "}
        + a receber{" "}
        {formatCurrency(
          calculation.receivable,
        )}{" "}
        − a pagar{" "}
        {formatCurrency(
          calculation.payable,
        )}.
      </p>
    </section>
  );
}