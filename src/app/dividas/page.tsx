"use client";

import { DebtTrackingPanel } from "@/components/finance/DebtTrackingPanel";

export default function DividasPessoaisPage() {
  return (
    <DebtTrackingPanel
      group="personal"
      title="Pessoais"
      description="Dívidas com amigos e familiares. Acompanhe o saldo, quanto já foi pago e juros, caso existam."
      emptyText="Nenhuma dívida pessoal cadastrada"
    />
  );
}
