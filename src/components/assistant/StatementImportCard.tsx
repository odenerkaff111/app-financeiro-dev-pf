"use client";

import {
  Check,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
} from "lucide-react";
import type { StatementPreview } from "@/lib/financial-actions";
import { formatCurrency } from "@/lib/financial-actions";

type StatementImportCardProps = {
  preview: StatementPreview;
  importing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function formatDate(value: string) {
  const [year, month, day] = value.split("-");

  return day && month && year
    ? `${day}/${month}/${year}`
    : value;
}

export function StatementImportCard({
  preview,
  importing,
  onConfirm,
  onCancel,
}: StatementImportCardProps) {
  const visibleRows = preview.rows
    .filter((row) => !row.duplicate)
    .slice(0, 8);

  return (
    <article className="overflow-hidden rounded-2xl border border-[#C8A15A]/30 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[#0D1B2A]/8 bg-[#F7F5EF] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileSpreadsheet
            size={17}
            className="shrink-0 text-[#C8A15A]"
          />

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#0D1B2A]">
              Importar extrato
            </p>

            <p className="truncate text-[11px] text-[#3A3A3C]/50">
              {preview.file_name} • {preview.account_name}
            </p>
          </div>
        </div>

        <span className="shrink-0 rounded-full bg-[#0D1B2A] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
          {preview.new_rows} novas
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-[#0D1B2A]/8 px-4 py-4 sm:grid-cols-4">
        <Summary
          label="Encontradas"
          value={String(preview.total_rows)}
        />

        <Summary
          label="Duplicadas"
          value={String(preview.duplicate_rows)}
        />

        <Summary
          label="Entradas"
          value={formatCurrency(preview.total_income)}
          positive
        />

        <Summary
          label="Saídas"
          value={formatCurrency(preview.total_expense)}
          negative
        />
      </div>

      {visibleRows.length > 0 && (
        <div className="divide-y divide-[#0D1B2A]/8 px-4">
          {visibleRows.map((row) => (
            <div
              key={row.fingerprint}
              className="grid grid-cols-[70px_minmax(0,1fr)_auto] items-center gap-3 py-3 text-xs"
            >
              <span className="text-[#3A3A3C]/50">
                {formatDate(row.occurred_on)}
              </span>

              <div className="min-w-0">
                <p className="truncate font-medium text-[#0D1B2A]">
                  {row.description}
                </p>

                <p className="truncate text-[10px] text-[#3A3A3C]/45">
                  {row.category_name ?? "Sem categoria"}
                </p>
              </div>

              <span
                className={[
                  "font-semibold",
                  row.type === "income"
                    ? "text-emerald-700"
                    : "text-red-700",
                ].join(" ")}
              >
                {row.type === "income" ? "+" : "−"}
                {formatCurrency(row.amount)}
              </span>
            </div>
          ))}
        </div>
      )}

      {preview.new_rows > visibleRows.length && (
        <p className="border-t border-[#0D1B2A]/8 px-4 py-2 text-center text-[11px] text-[#3A3A3C]/45">
          Mais {preview.new_rows - visibleRows.length} movimentações serão importadas.
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-[#0D1B2A]/8 px-4 py-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={importing}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#0D1B2A]/15 px-4 text-sm font-semibold text-[#0D1B2A] transition hover:bg-[#F7F5EF] disabled:opacity-50"
        >
          <RotateCcw size={15} />
          Cancelar
        </button>

        <button
          type="button"
          onClick={onConfirm}
          disabled={importing || preview.new_rows === 0}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-sm font-semibold text-white transition hover:bg-[#172D43] disabled:opacity-50"
        >
          {importing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check size={16} />
          )}

          Importar {preview.new_rows}
        </button>
      </div>
    </article>
  );
}

function Summary({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
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
          positive
            ? "text-emerald-700"
            : negative
              ? "text-red-700"
              : "text-[#0D1B2A]",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}
