"use client";

import { RecurringTransactionsPanel } from "@/components/RecurringTransactionsPanel";

export default function RecorrentesPage() {
  return (
    <div className="space-y-6 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
          Planejamento mensal
        </p>

        <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
          LanÃ§amentos recorrentes
        </h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/70">
          Configure receitas, despesas e compromissos que se repetem.
        </p>
      </header>

      <RecurringTransactionsPanel />
    </div>
  );
}