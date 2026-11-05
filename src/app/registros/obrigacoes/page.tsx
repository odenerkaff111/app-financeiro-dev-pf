"use client";

import { UpcomingObligations } from "@/components/dashboard/UpcomingObligations";
import { CardStatementsPanel, LoansPanel } from "@/components/control/FinanceControl";

export default function Page() {
  return (
    <div className="space-y-5 pb-10">
      <CardStatementsPanel />
      <UpcomingObligations />
      <LoansPanel />
    </div>
  );
}
