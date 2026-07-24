"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import { useHousehold } from "@/contexts/HouseholdContext";
import type {
  AssistantContext,
  FinancialActionPayload,
  FinancialActionStatus,
  FinancialActionType,
} from "@/lib/financial-actions";
import {
  actionTitle,
  formatCurrency,
} from "@/lib/financial-actions";

type Props = {
  actionType: FinancialActionType;
  actionStatus: FinancialActionStatus;
  payload: FinancialActionPayload;
  context: AssistantContext;
  errorMessage?: string | null;
  saving?: boolean;
  onConfirm: () => void;
  onCorrect: () => void;
};

function formatDate(value: string | null) {
  if (!value) return "Hoje";
  const [year, month, day] = value.split("-");
  return year && month && day
    ? `${day}/${month}/${year}`
    : value;
}

export function ProposedActionCard({
  actionType,
  actionStatus,
  payload,
  context,
  errorMessage,
  saving = false,
  onConfirm,
  onCorrect,
}: Props) {
  const { canWrite } = useHousehold();

  if (actionType === "none") return null;

  const account = context.accounts.find(
    (item) => item.id === payload.account_id,
  );
  const destination = context.accounts.find(
    (item) => item.id === payload.destination_account_id,
  );
  const category = context.categories.find(
    (item) => item.id === payload.category_id,
  );
  const debt = context.debts.find(
    (item) => item.id === payload.debt_id,
  );

  const confirmed = actionStatus === "confirmed";
  const failed = actionStatus === "failed";
  const cancelled = actionStatus === "cancelled";

  return (
    <article className="mt-3 overflow-hidden rounded-2xl border border-[#C8A15A]/30 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[#0D1B2A]/8 bg-[#F7F5EF] px-4 py-3">
        <p className="text-sm font-semibold text-[#0D1B2A]">
          {actionTitle(actionType, payload)}
        </p>

        {confirmed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            <CheckCircle2 size={12} /> Registrado
          </span>
        )}

        {failed && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-700">
            <TriangleAlert size={12} /> Falhou
          </span>
        )}

        {cancelled && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Em correção
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-4">
        {payload.amount !== null && (
          <Row
            label="Valor"
            value={formatCurrency(payload.amount)}
            strong
          />
        )}

        {payload.description && (
          <Row label="Descrição" value={payload.description} />
        )}

        {(actionType === "register_debt_payment" ||
          actionType === "register_debt_received") && (
          <Row
            label="Credor"
            value={
              debt?.creditor ??
              payload.creditor ??
              "Não identificado"
            }
          />
        )}

        {payload.category_id && (
          <Row
            label="Categoria"
            value={
              category?.name ??
              payload.category_name ??
              "Não identificada"
            }
          />
        )}

        {actionType !== "create_transfer" &&
          payload.account_id && (
            <Row
              label="Conta"
              value={
                account?.name ??
                payload.account_name ??
                "Não identificada"
              }
            />
          )}

        {actionType === "create_transfer" && (
          <div className="flex items-center gap-2 rounded-xl bg-[#F7F5EF] px-3 py-2.5 text-sm text-[#0D1B2A]">
            <span className="min-w-0 flex-1 truncate">
              {account?.name ?? payload.account_name ?? "Origem"}
            </span>
            <ArrowRight size={15} className="shrink-0 text-[#C8A15A]" />
            <span className="min-w-0 flex-1 truncate text-right">
              {destination?.name ??
                payload.destination_account_name ??
                "Destino"}
            </span>
          </div>
        )}

        <Row label="Data" value={formatDate(payload.occurred_on)} />

        {errorMessage && (
          <p className="rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700">
            {errorMessage}
          </p>
        )}
      </div>

      {!confirmed && !cancelled && canWrite && (
        <div className="flex flex-col-reverse gap-2 border-t border-[#0D1B2A]/8 px-4 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCorrect}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#0D1B2A]/15 px-4 text-sm font-semibold text-[#0D1B2A] transition hover:bg-[#F7F5EF] disabled:opacity-50"
          >
            <Pencil size={15} /> Corrigir
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-sm font-semibold text-white transition hover:bg-[#172D43] disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check size={16} />
            )}
            Confirmar
          </button>
        </div>
      )}

      {!confirmed &&
        !cancelled &&
        !canWrite && (
          <div className="border-t border-[#0D1B2A]/8 px-4 py-3 text-xs leading-5 text-blue-700">
            Seu acesso é somente leitura. Peça a um administrador para confirmar esta ação.
          </div>
        )}
    </article>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-[#3A3A3C]/55">{label}</span>
      <span
        className={[
          "max-w-[65%] text-right text-[#0D1B2A]",
          strong ? "font-semibold" : "font-medium",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
