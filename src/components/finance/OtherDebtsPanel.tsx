"use client";

import { DebtTrackingPanel } from "@/components/finance/DebtTrackingPanel";

export function OtherDebtsPanel() {
  return (
    <DebtTrackingPanel
      group="other"
      title="Outras dívidas"
      description="Empréstimos, bancos, financiamentos e dívidas com terceiros. Veja saldo, pagamentos e evolução dos juros."
      emptyText="Nenhuma outra dívida cadastrada"
    />
  );
}
