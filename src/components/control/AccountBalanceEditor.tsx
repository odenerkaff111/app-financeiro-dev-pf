"use client";

import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { amount, changed, errorText, rpc, rows } from "@/lib/control/client";

type Account = { id: string; name: string; type: string; balance: number | string; available_credit?: number | string | null };
type Statement = { id: string; due_date: string; remaining_amount: number | string };
type Props = { account: Account; onClose: () => void; onSaved: () => void | Promise<void> };
const input = "mt-1 w-full rounded-xl border border-[#0D1B2A]/20 bg-white p-3 text-sm";

/** The existing audited balance RPCs, now in Accounts rather than a separate tab. */
export function AccountBalanceEditor({ account, onClose, onSaved }: Props) {
  const { household, canWrite } = useHousehold();
  const [balance, setBalance] = useState(String(account.balance));
  const [credit, setCredit] = useState(String(account.available_credit ?? ""));
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const card = account.type === "credit_card";
  useEffect(() => {
    let mounted = true;
    if (card) void rows<Statement & {account_id: string}>("pf_card_statement_positions", household.id)
      .then(items => {
        const next = items.filter(s => s.account_id === account.id && Number(s.remaining_amount) > 0).sort((a,b) => a.due_date.localeCompare(b.due_date))[0];
        if (mounted && next) { setDue(next.due_date); setBalance(String(next.remaining_amount)); }
      }).catch(e => { if (mounted) setError(errorText(e)); });
    return () => { mounted = false; };
  }, [account.id, card, household.id]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !canWrite) return;
    setBusy(true); setError("");
    try {
      if (card) await rpc("pf_reconcile_card_v1", { p_account: account.id, p_due: due, p_total: amount(balance), p_available: amount(credit), p_reason: "Saldo e limite atuais informados na tela de Contas" });
      else await rpc("pf_reconcile_account_v1", { p_account: account.id, p_balance: amount(balance), p_reason: "Saldo atual informado na tela de Contas", p_expected_balance: Number(account.balance) });
      changed(); await onSaved(); onClose();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[460] flex items-center justify-center overflow-y-auto bg-[#0D1B2A]/70 p-4" role="dialog" aria-modal="true" aria-labelledby="account-balance-title">
    <form onSubmit={save} className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-[#F7F5EF] p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3"><div><h2 id="account-balance-title" className="text-xl font-semibold">Atualizar {card ? "fatura e limite" : "saldo"}</h2><p className="mt-1 text-sm">{account.name}</p></div><button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={20}/></button></div>
      <label className="block text-sm">{card ? "Valor ainda a pagar da fatura (R$)" : "Saldo atual no banco (R$)"}<input autoFocus className={input} required inputMode="decimal" value={balance} onChange={e=>setBalance(e.target.value)}/></label>
      {card && <><label className="block text-sm">Limite disponível (R$)<input className={input} required inputMode="decimal" value={credit} onChange={e=>setCredit(e.target.value)}/></label><label className="block text-sm">Vencimento da fatura<input className={input} required type="date" value={due} onChange={e=>setDue(e.target.value)}/></label></>}
      <p className="text-xs leading-5 text-[#3A3A3C]/65">Atualiza os valores atuais sem criar receita, despesa ou pagamento. As movimentações já registradas são preservadas.</p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" onClick={onClose} disabled={busy} className="rounded-xl border px-4 py-3">Cancelar</button><button disabled={busy || !canWrite} className="rounded-xl bg-[#0D1B2A] px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Salvando..." : "Salvar valores atuais"}</button></div>
    </form>
  </div>;
}
