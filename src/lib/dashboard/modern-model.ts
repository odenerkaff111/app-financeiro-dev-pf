import { buildFamilyOverview, brazilDay, moneyCents, monthRange, paidDay, meta, flag, str, type FamilyData, type Row } from '@/lib/family-finance';
import { cardInvoiceSummary, type InvoiceAccount } from '@/lib/dashboard/card-invoices';
import { type CardBill } from '@/lib/card-statements';

export type DashboardData = FamilyData & { investmentPositions: Row[]; essentialMonths: Row[] };
export const spendingGroups = [
  { id: 'life', name: 'Vida pessoal', color: '#6558e8' },
  { id: 'growth', name: 'Educação e investimentos', color: '#28a98a' },
  { id: 'debt', name: 'Dívidas e juros', color: '#ec9c50' },
  { id: 'other', name: 'Outros gastos', color: '#a4afc0' },
] as const;
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pending = (r: Row) => ['planned', 'overdue'].includes(str(r.status)) && !flag(meta(r).settlement_completed);

/** A paid historic record remains a flow even when its bank was not recorded.
 * skip_balance_update protects today's reconciled balance, not the spending history.
 * Card purchases are represented by the single statement payment in cash flow.
 */
export function realizedDashboard(data: FamilyData, month: string) {
  const {start,end}=monthRange(month),accounts=new Map(data.accounts.map(a=>[str(a.id),a]));
  let cashIn=0,cashOut=0,income=0,investmentIn=0,investmentOut=0,unlinkedPaid=0,estimatedOut=0;
  for(const t of data.transactions){
    const m=meta(t),type=str(t.type),day=paidDay(t),amount=moneyCents(t.amount);
    if(t.status!=='paid' || flag(m.settlement_completed) || day<start || day>end)continue;
    const statementPayment=type==='transfer' && m.origin==='card_statement_payment';
    const cardItem=t.card_statement_id || flag(t.card_forecast) || m.payment_method==='credit_card' || m.purchase_accounting==='inside_card_invoice_only' || accounts.get(str(t.account_id))?.type==='credit_card';
    if(cardItem && !statementPayment)continue;
    let incoming=0,outgoing=0;
    if(['income','debt_received','loan_repayment'].includes(type))incoming=amount;
    if(['expense','debt_payment','loan_given'].includes(type)||statementPayment)outgoing=amount;
    if(type==='investment_contribution'){outgoing=amount;investmentOut+=amount;}
    if(type==='investment_withdrawal'){incoming=amount;investmentIn+=amount;}
    // Unclassified allocations to a card limit and internal transfers are not bill payments.
    cashIn+=incoming;cashOut+=outgoing;
    if(type==='income')income+=incoming;
    if((incoming||outgoing)&&!t.account_id)unlinkedPaid++;
    if(outgoing && flag(m.estimated))estimatedOut+=outgoing;
  }
  return {cashIn,cashOut,income,investmentIn,investmentOut,unlinkedPaid,estimatedOut};
}

export function debtDashboard(rows: Row[]) {
  const debts = rows.filter(d => d.status !== 'cancelled').map(d => {
    const original = moneyCents(d.original_amount);
    // pf_debt_progress.paid_amount already includes the imported payment baseline.
    const paid = Math.max(0, moneyCents(d.paid_amount));
    const remaining = Math.max(0, moneyCents(d.projected_balance ?? d.current_balance));
    const charges = moneyCents(d.accrued_interest) + moneyCents(d.projected_penalty) + moneyCents(d.projected_late_interest);
    const base = paid + remaining;
    return { id: str(d.id), name: str(d.creditor), description: str(d.description), type: str(d.type),
      original, paid, remaining, charges, installment: moneyCents(d.installment_amount),
      totalInstallments: d.total_installments == null ? null : Number(d.total_installments),
      paidInstallments: d.paid_installments == null ? null : Number(d.paid_installments),
      due: str(d.due_date), progress: base > 0 ? Math.min(100, paid / base * 100) : 0,
      paidOff: remaining === 0, dailyGrowth: moneyCents(d.daily_growth) };
  }).sort((a,b) => Number(a.paidOff)-Number(b.paidOff) || b.remaining-a.remaining || a.name.localeCompare(b.name, 'pt-BR'));
  const open = debts.filter(d => !d.paidOff);
  const total = (key: 'original'|'paid'|'remaining'|'installment'|'charges') => debts.reduce((s,d) => s+d[key],0);
  return { rows: debts, original: total('original'), paid: total('paid'), remaining: total('remaining'), charges: total('charges'),
    installmentTotal: open.reduce((s,d) => s+d.installment,0),
    borrowed: open.filter(d => ['loan','informal'].includes(d.type)).reduce((s,d) => s+d.remaining,0),
    progress: total('paid')+total('remaining') > 0 ? total('paid')/(total('paid')+total('remaining'))*100 : 0 };
}

export function investmentDashboard(positions: Row[]) {
  const active = positions.filter(p => flag(p.is_active));
  const total = active.reduce((n,p) => n+moneyCents(p.current_value),0);
  const principal = active.every(p => p.cost_basis != null) ? active.reduce((n,p) => n+moneyCents(p.cost_basis),0) : null;
  const hasBasis = active.length > 0 && active.every(p => p.estimated_return != null);
  const gain = hasBasis ? active.reduce((n,p) => n+moneyCents(p.estimated_return),0) : null;
  return { total, principal, gain, percent: gain != null && principal != null && principal > 0 ? gain/principal*100 : null,
    positions: active.map(p => ({ id:str(p.id),name:str(p.name),institution:str(p.institution_name),value:moneyCents(p.current_value),
      updated:str(p.investment_last_valued_at),gain:p.estimated_return == null ? null : moneyCents(p.estimated_return) })) };
}

export function minimumLivingCost(months: Row[], today: string) {
  const first = new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-7,1)).toISOString().slice(0,7);
  const closed = months.filter(m => str(m.reference_month).slice(0,7) < today.slice(0,7) && str(m.reference_month).slice(0,7) >= first);
  const current = months.find(m => str(m.reference_month).slice(0,7) === today.slice(0,7));
  return { average: closed.length ? Math.round(closed.reduce((s,m) => s+moneyCents(m.essential_amount),0)/closed.length) : current ? moneyCents(current.essential_amount) : null,
    months:closed.length, basis:closed.length ? 'average' as const : current ? 'current' as const : 'missing' as const };
}

/** Monthly commitments by area: card items replace the bill/payment, never accumulate with it. */
export function spendingDistribution(data: FamilyData, month: string) {
  const {start,end}=monthRange(month);
  const categories=new Map(data.categories.map(c=>[str(c.id),c]));
  const totals=new Map<string,number>(spendingGroups.map(g=>[g.id,0]));
  const confirmedCycles=new Set(data.transactions.filter(t=>t.status!=='cancelled' && t.card_statement_id && !flag(t.card_forecast) && t.recurrence_key)
    .map(t=>`${t.recurrence_key}:${meta(t).recurrence_charge_month ?? str(t.occurred_on).slice(0,7)}`));
  for(const t of data.transactions){
    const m=meta(t);
    if(t.status==='cancelled' || flag(m.settlement_completed))continue;
    if(!['expense','debt_payment','investment_contribution'].includes(str(t.type)))continue;
    if(flag(t.card_forecast) && t.recurrence_key && confirmedCycles.has(`${t.recurrence_key}:${m.recurrence_charge_month ?? m.generated_for ?? str(t.occurred_on).slice(0,7)}`))continue;
    const day=t.card_statement_id || t.metadata && m.payment_method==='credit_card' ? str(t.due_date)||str(t.occurred_on) : t.status==='paid' ? paidDay(t) : str(t.due_date)||str(t.occurred_on);
    if(day<start || day>end || !day)continue;
    const c=categories.get(str(t.category_id));
    const label=normalize(`${str(c?.name)} ${str(t.description)}`);
    let group='other';
    if(t.type==='debt_payment' || t.debt_id || c?.group_type==='debt' || /divida|juros|multa|financiament|pix no credito|pix parcelado|emprestimo/.test(label))group='debt';
    else if(t.type==='investment_contribution' || /educa|escola|curso|faculdade|formacao|livros|investimento|aporte/.test(label))group='growth';
    else if(c?.group_type==='essential' || /aliment|aluguel|moradia|supermerc|mercado|agua|energia|internet|saude|gasolina|transport|academia|restaurante/.test(label))group='life';
    totals.set(group,totals.get(group)!+Math.max(0,moneyCents(t.amount)));
  }
  // The undetailed portion is included once; it cannot be assigned to a more specific area.
  for(const s of data.statements)if(str(s.due_date)>=start && str(s.due_date)<=end)totals.set('other',totals.get('other')!+Math.max(0,moneyCents(s.unallocated_amount)));
  const total=[...totals.values()].reduce((a,b)=>a+b,0);
  return {total,groups:spendingGroups.map(g=>({...g,amount:totals.get(g.id)!,percent:total ? totals.get(g.id)!/total*100 : 0}))};
}

export function buildModernDashboard(data: DashboardData, month: string, today=brazilDay()) {
  const realized=realizedDashboard(data,month);
  const view={...buildFamilyOverview(data,month,today),...realized};
  const investments=investmentDashboard(data.investmentPositions);
  const debts=debtDashboard(data.debts);
  const bills=cardInvoiceSummary(data.accounts as unknown as InvoiceAccount[],data.statements as unknown as CardBill[],month,today);
  const loans=data.loans.filter(l=>!l.cancelled_at && moneyCents(l.remaining_amount)>0);
  const accounts=view.accounts.filter(a=>a.active && ['checking','savings','wallet','cash'].includes(a.type));
  const bankCash=accounts.filter(a=>a.type!=='cash').reduce((n,a)=>n+a.balance,0);
  const physicalCash=accounts.filter(a=>a.type==='cash').reduce((n,a)=>n+a.balance,0);
  const ownCards=view.accounts.filter(a=>a.active && a.type==='credit_card' && !a.thirdParty);
  const monthItems=view.items.filter(i=>i.due && i.due>=view.start && i.due<=view.end);
  const planning=monthItems.filter(i=>i.kind==='planning').reduce((s,i)=>s+i.amount,0);
  const past=month<today.slice(0,7);
  const result=past ? view.cashIn-view.cashOut : view.forecast.end;
  const missingDebtSchedule=data.debts.some(d=>d.status!=='cancelled' && moneyCents(d.projected_balance ?? d.current_balance)>0
    && !data.transactions.some(t=>t.debt_id===d.id && pending(t)));
  return {view,accounts,ownCards,bankCash,physicalCash,totalMoney:view.cash+investments.total,investments,debts,bills,loans,
    lent:loans.reduce((s,l)=>s+moneyCents(l.remaining_amount),0),cost:minimumLivingCost(data.essentialMonths,today),spending:spendingDistribution(data,month),
    pendingIn:view.receivable,pendingOut:view.required,planning,result,past,partial:view.undated>0 || missingDebtSchedule,
    next:monthItems.filter(i=>i.kind!=='planning').sort((a,b)=>(a.due||'').localeCompare(b.due||'')),
    missingDebtSchedule,realized };
}

export function annualDashboard(data: DashboardData,year:number,today=brazilDay()) {
  return Array.from({length:12},(_,i)=>{
    const month=`${year}-${String(i+1).padStart(2,'0')}`;
    const view={...buildFamilyOverview(data,month,today),...realizedDashboard(data,month)};
    return { month:new Intl.DateTimeFormat('pt-BR',{month:'short',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z')).replace('.',''),
      incoming:(view.cashIn+view.receivable)/100,outgoing:(view.cashOut+view.required)/100,
      received:view.cashIn,paid:view.cashOut,expectedIn:view.receivable,expectedOut:view.required,estimatedOut:view.estimatedOut };
  });
}
