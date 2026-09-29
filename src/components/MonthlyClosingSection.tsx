"use client";

import { closingFigures } from "@/lib/dashboard/summary";

type Props = {
  periodFilter: "today" | "week" | "month" | "next_month" | "custom" | "all";
  income: number; receivable: number; expense: number; payable: number; budgetReserve?: number;
};
const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const PERIOD = { today: "do dia", week: "da semana", month: "do mês", next_month: "do próximo mês", custom: "do período", all: "de todo o período" };

export function MonthlyClosingSection({ periodFilter, income, receivable, expense, payable, budgetReserve = 0 }: Props) {
  const { realized, projected } = closingFigures(income, expense, receivable, payable, budgetReserve);
  return (
    <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-[#0D1B2A]">Resultado {PERIOD[periodFilter]}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-[#F7F5EF] p-4">
          <p className="text-sm font-medium text-[#0D1B2A]">Já realizado</p>
          <p className={`mt-2 text-2xl font-semibold ${realized < 0 ? "text-red-800" : "text-emerald-800"}`}>{money(realized)}</p>
          <p className="mt-2 text-xs leading-5 text-[#3A3A3C]/65">{money(income)} de entradas menos {money(expense)} de saídas efetivadas.</p>
        </div>
        <div className="rounded-xl bg-[#F7F5EF] p-4">
          <p className="text-sm font-medium text-[#0D1B2A]">Considerando o que ainda falta</p>
          <p className={`mt-2 text-2xl font-semibold ${projected < 0 ? "text-red-800" : "text-emerald-800"}`}>{money(projected)}</p>
          <p className="mt-2 text-xs leading-5 text-[#3A3A3C]/65">Realizado + {money(receivable)} a receber no período − {money(payable)} de obrigações pendentes{budgetReserve > 0 ? ` − ${money(budgetReserve)} de planejamentos ainda não comprometidos` : ""}.</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#3A3A3C]/55">Resultado das movimentações, não o saldo bancário. Dívidas não pagas continuam nas pendências; transferências entre contas e resgates não criam nova renda.</p>
    </section>
  );
}
