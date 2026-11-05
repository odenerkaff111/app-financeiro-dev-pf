'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CreditCard, ReceiptText, RefreshCw, X } from 'lucide-react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { bankAccounts, changed, dateLabel, errorText, money, rows, rpc, today, type Account } from '@/lib/control/client';
import { cents } from '@/lib/dashboard/summary';
import { billTotals, groupCardBills, initialBillMonth, monthLabel, monthEnd, shiftMonth, statementItems, statementVersions, visibleBills, type CardBill, type CardBillItem } from '@/lib/card-statements';

const btn = 'rounded-xl bg-[#0D1B2A] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40';
const outline = 'rounded-xl border border-[#0D1B2A]/15 bg-white px-3 py-2 text-sm font-medium disabled:opacity-40';
const input = 'w-full rounded-xl border border-[#0D1B2A]/20 bg-white px-3 py-2.5 text-sm';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}
function Dialog({ title, busy, close, children }: { title: string; busy: boolean; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-labelledby={id} onCancel={e => { e.preventDefault(); if (!busy) close(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl bg-white p-5 text-[#0D1B2A] shadow-2xl backdrop:bg-[#0D1B2A]/60 sm:p-6">
    <div className="mb-5 flex items-start justify-between gap-3"><h3 id={id} className="text-xl font-semibold">{title}</h3><button className={outline} type="button" aria-label="Fechar" disabled={busy} onClick={close}><X size={18}/></button></div>{children}
  </dialog>;
}

export function BillItemList({ items, unallocated = 0 }: { items: CardBillItem[]; unallocated?: number }) {
  return <ul className="divide-y divide-[#0D1B2A]/10 text-sm" aria-label="Itens da fatura">
    {items.map(t => <li key={t.id} className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0"><p className="break-words font-medium">{t.description}</p><p className="mt-0.5 text-xs text-slate-500">
        {t.metadata?.date_unknown === true ? 'Data da compra não informada' : dateLabel(t.occurred_on)}
        {t.merchant && ` · ${t.merchant}`}{t.installment_total && t.installment_total > 1 ? ` · Parcela ${t.installment_number}/${t.installment_total}` : ' · À vista no crédito'}
        {t.status === 'paid' ? ' · Pago' : ' · A pagar'}</p></div><strong className="shrink-0 tabular-nums">{money(t.amount)}</strong>
    </li>)}
    {unallocated > 0 && <li className="py-3 text-amber-900">Valor informado sem detalhamento: <strong>{money(unallocated)}</strong>. Já faz parte do total da fatura.</li>}
  </ul>;
}

type Receipt = { id: string; amount: number; item_count: number; paid_on: string };
type Action = { kind: 'pay'; bill: CardBill } | { kind: 'merge'; bills: CardBill[] } | { kind: 'forecast'; item: CardBillItem };
export function CardBillsPanel() {
  const { household, canWrite } = useHousehold();
  const [bills, setBills] = useState<CardBill[]>([]); const [items, setItems] = useState<CardBillItem[]>([]); const [accounts, setAccounts] = useState<Account[]>([]);
  const [month, setMonth] = useState(today().slice(0, 7)); const selectedMonth = useRef(false); const sequence = useRef(0);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [action, setAction] = useState<Action | null>(null); const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState('');
  const [bank, setBank] = useState(''); const [date, setDate] = useState(today()); const [due, setDue] = useState(''); const [checked, setChecked] = useState(false); const [included, setIncluded] = useState(false);
  const load = useCallback(async () => {
    const request = ++sequence.current; setLoading(true);
    try {
      const [b, t, a] = await Promise.all([
        rows<CardBill>('pf_card_statement_dashboard', household.id),
        rows<CardBillItem>('pf_transactions', household.id, 'id,description,merchant,amount,due_date,occurred_on,status,installment_number,installment_total,card_statement_id,card_forecast,metadata'),
        rows<Account>('pf_accounts', household.id),
      ]);
      if (request !== sequence.current) return;
      setBills(b); setItems(t); setAccounts(a); setError('');
      if (!selectedMonth.current) { setMonth(initialBillMonth(b, today())); selectedMonth.current = true; }
    } catch (e) {
      if (request === sequence.current) setError(`Não foi possível carregar as faturas. Se esta é a primeira instalação, execute o SQL 044 do pacote no Supabase. ${errorText(e)}`);
    } finally { if (request === sequence.current) setLoading(false); }
  }, [household.id]);
  useEffect(() => {
    selectedMonth.current = false; void load();
    const reload = () => { void load(); };
    const storage = (e: StorageEvent) => { if (e.key === 'pf:financial-data-version') reload(); };
    window.addEventListener('pf:financial-data-changed', reload); window.addEventListener('storage', storage); window.addEventListener('focus', reload);
    return () => { sequence.current++; window.removeEventListener('pf:financial-data-changed', reload); window.removeEventListener('storage', storage); window.removeEventListener('focus', reload); };
  }, [load]);
  const shown = visibleBills(bills, month); const totals = billTotals(shown); const groups = groupCardBills(shown);
  const forecasts = items.filter(t => t.card_forecast && ['planned', 'overdue'].includes(t.status) && (t.due_date || t.occurred_on).startsWith(month));
  const unlinked = items.filter(t => !t.card_statement_id && !t.card_forecast && ['planned', 'overdue'].includes(t.status) && t.metadata?.payment_method === 'credit_card' && t.metadata?.card_holder && t.metadata?.settlement_completed !== true);
  const overdue = billTotals(bills.filter(b => b.due_date < today())).remaining;
  function chooseMonth(value: string) { if (/^\d{4}-\d{2}$/.test(value)) { selectedMonth.current = true; setMonth(value); } }
  function open(next: Action) {
    setAction(next); setActionError(''); setChecked(false); setBank(''); setDate(today()); setIncluded(false);
    setDue(next.kind === 'merge' ? next.bills[next.bills.length - 1].due_date : next.kind === 'forecast' ? next.item.due_date || '' : '');
  }
  async function save(e: FormEvent) {
    e.preventDefault(); if (!action || !canWrite || busy || !checked) return;
    setBusy(true); setActionError(''); setSuccess('');
    try {
      if (action.kind === 'pay') {
        const result = await rpc<Receipt>('pf_pay_card_statement_v2', { p_statement: action.bill.id, p_bank: bank, p_date: date, p_expected_version: action.bill.version_token, p_request: crypto.randomUUID() });
        setSuccess(`Pagamento de ${money(result.amount)} registrado em ${dateLabel(result.paid_on)}. Os itens da fatura foram baixados automaticamente.`);
      } else if (action.kind === 'merge') {
        await rpc('pf_merge_card_statements_v1', { p_account: action.bills[0].account_id, p_month: `${month}-01`, p_due: due, p_expected_versions: statementVersions(action.bills), p_request: crypto.randomUUID() });
        setSuccess('Vencimento unificado neste mês. Confira os itens antes de pagar a fatura.');
      } else {
        await rpc('pf_confirm_card_forecast_v1', { p_transaction: action.item.id, p_due: due, p_charged_on: date, p_included: included });
        setSuccess('Cobrança confirmada e incluída na fatura.');
      }
      setAction(null); changed(); await load();
    } catch (e) { setActionError(errorText(e)); void load(); } finally { setBusy(false); }
  }
  return <section aria-label="Resumo das faturas" className="rounded-[22px] border border-[#0D1B2A]/10 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-[#9B7A40]">Cartões próprios e de terceiros</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-[#0D1B2A]">Suas faturas</h2><p className="mt-1 text-sm text-slate-500">Veja as parcelas por vencimento e quite a fatura de uma vez.</p></div>
      <div className="flex max-w-full items-center gap-1.5"><button type="button" className={outline} aria-label="Mês anterior" onClick={() => chooseMonth(shiftMonth(month, -1))}><ChevronLeft size={18}/></button><label className="min-w-0"><span className="sr-only">Mês do vencimento</span><input className={`${input} min-w-0 max-w-[170px]`} type="month" value={month} onChange={e => chooseMonth(e.target.value)}/></label><button type="button" className={outline} aria-label="Próximo mês" onClick={() => chooseMonth(shiftMonth(month, 1))}><ChevronRight size={18}/></button><button type="button" className={outline} aria-label="Atualizar faturas" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button></div>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {success && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
    {loading && <p role="status" className="mt-3 text-xs text-slate-500">Atualizando faturas…</p>}
    {!error && <>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 rounded-2xl bg-[#0D1B2A] p-4 text-white sm:col-span-1"><p className="text-xs text-white/70">A pagar em {monthLabel(month)}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(totals.remaining)}</p></div>
        <div className="rounded-2xl bg-[#F7F5EF] p-4"><p className="text-xs text-slate-500">Total das faturas</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(totals.total)}</p></div>
        <div className="rounded-2xl bg-[#EDF5EF] p-4"><p className="text-xs text-slate-500">Já pago neste vencimento</p><p className="mt-1 text-xl font-semibold tabular-nums text-emerald-800">{money(totals.paid)}</p></div>
      </div>
      {overdue > 0 && <p className="mt-3 text-xs text-amber-900">Há {money(overdue)} em faturas vencidas em todos os meses. <button className="underline" onClick={() => chooseMonth([...bills].filter(b => cents(b.remaining_amount) > 0 && b.due_date < today()).sort((a,b) => a.due_date.localeCompare(b.due_date))[0].due_date.slice(0,7))}>Ver a mais antiga</button></p>}
      <div className="mt-4 space-y-3">
        {groups.map(group => {
          const card = group[0]; const total = billTotals(group); const openBills = group.filter(b => cents(b.remaining_amount) > 0);
          return <article key={card.account_id} className="overflow-hidden rounded-2xl border border-[#0D1B2A]/10">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FBFAF7] p-4"><div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-[#0D1B2A]/5 p-2.5"><CreditCard size={20}/></span><div className="min-w-0"><h3 className="break-words font-semibold">{card.card_owner_type === 'third_party' ? card.card_holder_name || card.card_name : card.card_name}</h3><p className="mt-0.5 text-xs text-slate-500">{card.card_owner_type === 'third_party' ? 'Cartão de terceiro' : 'Cartão próprio'}{card.institution_name ? ` · ${card.institution_name}` : ''}</p></div></div><div><p className="text-right text-lg font-semibold tabular-nums">{money(total.remaining > 0 ? total.remaining : total.paid)}</p><p className="text-xs text-slate-500">{total.remaining > 0 ? 'a pagar' : 'fatura quitada'}</p></div></div>
            {openBills.length > 1 && <div className="m-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>Há {openBills.length} vencimentos cadastrados neste mês. Confira se pertencem à mesma fatura.</p>{canWrite && openBills.every(b => cents(b.paid_amount) === 0) && <button className={`${outline} mt-2`} onClick={() => open({ kind: 'merge', bills: openBills })}>Conferir e unificar vencimento</button>}</div>}
            {group.map(b => <details key={`${b.id}:${b.version_token}`} className="border-t border-[#0D1B2A]/10 p-4"><summary className="cursor-pointer text-sm font-medium"><span className="mr-2 inline-flex align-middle"><CalendarDays size={15}/></span>Vencimento {dateLabel(b.due_date)} · {b.item_count} {b.item_count === 1 ? 'item' : 'itens'} · {money(cents(b.remaining_amount) > 0 ? b.remaining_amount : b.paid_amount)} {cents(b.remaining_amount) > 0 ? 'a pagar' : 'pago'}</summary>
              <div className="mt-3"><BillItemList items={statementItems(items, b.id)} unallocated={Number(b.unallocated_amount)}/><div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="text-xs text-slate-500">Total {money(b.total_amount)} · Pago {money(b.paid_amount)}</p>{canWrite && cents(b.remaining_amount) > 0 && <button className={btn} onClick={() => open({ kind: 'pay', bill: b })}>Pagar fatura inteira</button>}</div></div>
            </details>)}
          </article>;
        })}
        {!loading && !shown.length && <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500"><ReceiptText size={24} className="mx-auto mb-2 text-slate-400"/>Nenhuma fatura confirmada com vencimento neste mês.</div>}
      </div>
      <details className="mt-4 rounded-xl border border-[#0D1B2A]/10 p-3 text-sm"><summary className="cursor-pointer font-medium">Próximos meses · parcelas já registradas</summary><p className="mt-2 text-xs text-slate-500">Valores podem mudar com novas compras, estornos e cobranças. Selecione um mês para conferir.</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => shiftMonth(month, i + 1)).map(m => <button key={m} className={`${outline} text-left`} onClick={() => chooseMonth(m)}><span className="block text-xs capitalize text-slate-500">{monthLabel(m)}</span><strong className="mt-1 block tabular-nums">{money(billTotals(visibleBills(bills, m)).remaining)}</strong></button>)}</div></details>
      <details className="mt-3 rounded-xl border border-[#0D1B2A]/10 p-3 text-sm"><summary className="cursor-pointer font-medium">Cobranças previstas neste mês ({forecasts.length})</summary><p className="my-3 text-xs text-slate-500">Assinaturas ainda não confirmadas ficam fora dos totais de fatura acima.</p>{forecasts.map(t => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3"><span>{t.description} · {money(t.amount)}</span>{canWrite && <button className={outline} onClick={() => open({ kind: 'forecast', item: t })}>Confirmar cobrança</button>}</div>)}</details>
      {unlinked.length > 0 && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{unlinked.length} compra(s) de terceiro ainda sem fatura vinculada. Confira os vencimentos no extrato; esses itens ficam fora deste resumo até a vinculação.</p>}
      <p className="mt-4 text-xs text-slate-500">O pagamento baixa os itens e desconta a conta uma vez. Limite disponível e reservas são conferidos separadamente no banco. Pagamentos antigos sem vínculo de fatura continuam no extrato.</p>
    </>}
    {action && <Dialog title={action.kind === 'pay' ? 'Pagar fatura inteira' : action.kind === 'merge' ? 'Conferir vencimentos' : 'Confirmar cobrança'} busy={busy} close={() => setAction(null)}>
      <form onSubmit={save} className="space-y-4">
        {action.kind === 'pay' && <><div className="rounded-xl bg-[#F7F5EF] p-4"><p className="text-sm font-medium">{action.bill.card_holder_name || action.bill.card_name} · {dateLabel(action.bill.due_date)}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{money(action.bill.remaining_amount)}</p><p className="mt-2 text-xs text-slate-500">Valor integral restante. Os itens incluídos serão baixados juntos.</p></div><details><summary className="cursor-pointer text-sm underline">Conferir os {action.bill.item_count} itens incluídos</summary><BillItemList items={statementItems(items, action.bill.id)} unallocated={Number(action.bill.unallocated_amount)}/></details><Field label="Conta que pagou"><select className={input} required value={bank} disabled={busy} onChange={e => setBank(e.target.value)}><option value="">Selecione a conta bancária</option>{bankAccounts(accounts).map(a => <option key={a.id} value={a.id}>{a.name} · {money(a.balance)}</option>)}</select></Field></>}
        {action.kind === 'merge' && <><p className="text-sm">Só confirme se os vencimentos abaixo são da mesma fatura de {action.bills[0].card_holder_name || action.bills[0].card_name}.</p><ul className="space-y-2 rounded-xl bg-amber-50 p-4 text-sm">{action.bills.map(b => <li key={b.id} className="flex justify-between gap-3"><span>{dateLabel(b.due_date)} · {b.item_count} itens</span><strong>{money(b.remaining_amount)}</strong></li>)}</ul><p className="font-semibold">Total: {money(billTotals(action.bills).remaining)}</p><p className="text-xs text-slate-500">O vencimento dos itens deste mês será atualizado. Esta ação não registra pagamento.</p></>}
        {action.kind === 'forecast' && <p className="rounded-xl bg-[#F7F5EF] p-3 text-sm">{action.item.description} · {money(action.item.amount)}</p>}
        {action.kind !== 'merge' && <Field label={action.kind === 'pay' ? 'Data real do pagamento' : 'Data real da cobrança'}><input className={input} type="date" required max={today()} value={date} disabled={busy} onChange={e => setDate(e.target.value)}/></Field>}
        {action.kind !== 'pay' && <Field label="Vencimento da fatura"><input className={input} type="date" required value={due} disabled={busy} min={action.kind === 'merge' ? `${month}-01` : undefined} max={action.kind === 'merge' ? monthEnd(month) : undefined} onChange={e => setDue(e.target.value)}/></Field>}
        {action.kind === 'forecast' && <label className="flex gap-2 text-sm"><input className="mt-1" type="checkbox" checked={included} disabled={busy} onChange={e => setIncluded(e.target.checked)}/>Esta cobrança já está incluída no valor de fatura e limite que informei. Apenas detalhar.</label>}
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" required disabled={busy} checked={checked} onChange={e => setChecked(e.target.checked)}/>{action.kind === 'pay' ? 'Conferi os itens e o valor com a fatura real, e já fiz este pagamento.' : action.kind === 'merge' ? 'Conferi: estes itens pertencem à mesma fatura e ao vencimento escolhido.' : 'Conferi esta cobrança no cartão.'}</label>
        {actionError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
        <div className="flex flex-wrap gap-2"><button className={btn} disabled={busy || !checked}>{busy ? 'Salvando…' : action.kind === 'pay' ? 'Registrar pagamento integral' : action.kind === 'merge' ? 'Unificar neste vencimento' : 'Confirmar cobrança'}</button><button type="button" className={outline} disabled={busy} onClick={() => setAction(null)}>Cancelar</button></div>
      </form>
    </Dialog>}
  </section>;
}
