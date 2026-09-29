"use client";

import { LoansPanel } from "@/components/control/FinanceControl";
import { CommitmentsPanel } from "@/components/finance/CommitmentsPanel";

export default function ValoresAReceberPage() {
  return <div className="space-y-5"><LoansPanel/><CommitmentsPanel direction="receivable" /></div>;
}
