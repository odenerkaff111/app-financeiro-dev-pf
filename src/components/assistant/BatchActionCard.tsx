"use client";

import { Check, CheckCircle2, Loader2, Pencil, ShieldCheck, TriangleAlert } from "lucide-react";
import { useHousehold } from "@/contexts/HouseholdContext";
import type { BatchPreviewItem, AiFinanceKind } from "@/lib/ai-finance-batch";
import type { FinancialActionStatus } from "@/lib/financial-actions";

const LABELS: Record<AiFinanceKind,string> = {
  income:"Receita", expense:"Despesa", transfer:"Transferência interna",
  investment_contribution:"Aporte em investimento",investment_withdrawal:"Resgate de investimento",
  pay_card_statement:"Quitação de fatura",debt_payment:"Pagamento de dívida",
  loan_repayment:"Recebimento de empréstimo",card_purchase:"Compra no cartão",
  settle_obligation:"Baixa de obrigação",reconcile_account:"Conciliação de saldo",
};

const formatBRL=(value:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(value);
const formatDate=(value:string)=>value.split("-").reverse().join("/");

export function BatchActionCard({
  items,status,errorMessage,saving,onConfirm,onCorrect,
}: {
  items: BatchPreviewItem[];
  status: FinancialActionStatus;
  errorMessage: string | null;
  saving:boolean;
  onConfirm:()=>void;
  onCorrect:()=>void;
}) {
  const {canWrite}=useHousehold();
  const confirmed=status==="confirmed";
  const cancelled=status==="cancelled";
  return (
    <article className="mt-3 w-full overflow-hidden rounded-2xl border border-[#0D1B2A]/12 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#0D1B2A]/8 bg-[#F7F5EF] px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#0D1B2A]">
          <ShieldCheck size={17} className="text-emerald-700" /> Prévia da atualização ({items.length})
        </span>
        {confirmed&&<span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={14}/> Registrado</span>}
        {cancelled&&<span className="text-xs text-slate-500">Cancelado</span>}
      </div>
      <div className="divide-y divide-[#0D1B2A]/7">
        {items.map((item,index)=>(
          <div key={`${item.kind}-${index}`} className="flex gap-3 px-4 py-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0D1B2A]/5 text-[11px] font-semibold text-[#0D1B2A]">{index+1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[#3A3A3C]/60">{LABELS[item.kind]}</p>
              <p className="mt-0.5 text-sm font-medium text-[#0D1B2A]">{item.description}</p>
              <p className="mt-1 text-[11px] leading-5 text-[#3A3A3C]/65">
                {item.account_name}
                {item.destination_account_name&&` → ${item.destination_account_name}`}
                {` · ${formatDate(item.occurred_on)}`}
                {item.due_on&&` · venc. ${formatDate(item.due_on)}`}
                {item.installments>1&&` · ${item.installments} parcelas`}
                {item.monthly&&" · recorrente"}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums text-[#0D1B2A]">{formatBRL(item.amount)}</p>
          </div>
        ))}
      </div>
      <p className="border-t border-[#0D1B2A]/7 px-4 py-3 text-[11px] leading-5 text-[#3A3A3C]/70">
        O plano ainda não foi registrado. Revise contas, datas, parcelas e valores. Transferências, faturas e investimentos não são despesas bancárias novas.
      </p>
      {errorMessage&&<p className="mx-4 mb-3 inline-flex gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700"><TriangleAlert size={15}/>{errorMessage}</p>}
      {!confirmed&&!cancelled&&canWrite&&(
        <div className="flex flex-col-reverse gap-2 border-t border-[#0D1B2A]/8 px-4 py-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCorrect} disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#0D1B2A]/15 px-4 text-sm font-medium text-[#0D1B2A] disabled:opacity-50">
            <Pencil size={15}/> Corrigir
          </button>
          <button type="button" onClick={onConfirm} disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-sm font-semibold text-white disabled:opacity-60">
            {saving?<Loader2 size={16} className="animate-spin"/>:<Check size={16}/>} Confirmar {items.length} {items.length===1?"operação":"operações"}
          </button>
        </div>
      )}
      {!confirmed&&!cancelled&&!canWrite&&<p className="px-4 pb-3 text-xs text-amber-700">Sua conta não pode confirmar alterações.</p>}
    </article>
  );
}
