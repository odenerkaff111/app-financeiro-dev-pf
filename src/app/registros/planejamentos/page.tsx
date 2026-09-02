"use client";

import { BudgetPlanningPanel } from "@/components/dashboard/BudgetPlanningPanel";

function currentMonth() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0")].join("-");
}

export default function PlanejamentosPage() {
  return (
    <div className="space-y-6 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
          Controle antecipado
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
          Planejamentos
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/70">
          Defina quanto pretende gastar por categoria. O Dashboard mostra apenas os indicadores; a gestão fica concentrada aqui.
        </p>
      </header>

      <BudgetPlanningPanel defaultMonth={currentMonth()} />
    </div>
  );
}
