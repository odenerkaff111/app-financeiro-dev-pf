"use client";

import { BudgetPlanningPanel } from "@/components/dashboard/BudgetPlanningPanel";

function currentMonth() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0")].join("-");
}

export default function PlanejamentosPage() {
  return (
    <div className="pb-10">
      <BudgetPlanningPanel defaultMonth={currentMonth()} />
    </div>
  );
}
