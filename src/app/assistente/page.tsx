"use client";

import { FinancialAssistant } from "@/components/assistant/FinancialAssistant";

export default function AssistentePage() {
  return (
    <div className="flex h-[calc(100dvh-10rem)] min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
          Grupo Umsó
        </p>

        <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
          Assistente financeiro
        </h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/70">
          Converse naturalmente. Nenhuma movimentação é salva sem sua confirmação.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <FinancialAssistant />
      </div>
    </div>
  );
}
