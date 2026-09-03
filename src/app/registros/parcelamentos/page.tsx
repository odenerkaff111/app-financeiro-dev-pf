"use client";

import { InstallmentPurchasesPanel } from "@/components/finance/InstallmentPurchasesPanel";

export default function ParcelamentosPage() {
  return (
    <div className="space-y-6 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
          Compras no cartão
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A] sm:text-4xl">
          Parcelamentos
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#3A3A3C]/70">
          Veja cada compra parcelada como um grupo único, acompanhe todas as parcelas e ajuste o primeiro vencimento sem duplicar meses.
        </p>
      </header>

      <InstallmentPurchasesPanel />
    </div>
  );
}
