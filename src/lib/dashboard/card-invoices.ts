import { billTotals, visibleBills, type CardBill } from '@/lib/card-statements';
import { cents } from '@/lib/dashboard/summary';

export type InvoiceAccount = {
  id: string;
  name: string;
  type: string;
  institution_name: string | null;
  is_active: boolean;
  card_owner_type?: 'own' | 'third_party';
  card_holder_name?: string | null;
};

export type InvoiceCard = {
  id: string;
  title: string;
  name: string;
  institution: string | null;
  thirdParty: boolean;
  bills: CardBill[];
  remaining: number;
  total: number;
  paid: number;
  itemCount: number;
  overdue: boolean;
  state: 'open' | 'paid' | 'empty';
};

/** The statement view owns the amounts. Account balances and credit limits are never invoice values. */
export function cardInvoiceSummary(accounts: InvoiceAccount[], bills: CardBill[], month: string, today: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Selecione um mês válido.');
  const monthly = visibleBills(bills, month);
  const accountMap = new Map(accounts.filter(a => a.type === 'credit_card').map(a => [a.id, a]));
  const ids = new Set(accounts.filter(a => a.type === 'credit_card' && a.is_active).map(a => a.id));
  // An archived card with an unpaid statement must remain visible.
  for (const b of monthly) if (cents(b.remaining_amount) > 0 || accountMap.get(b.account_id)?.is_active) ids.add(b.account_id);
  const cards: InvoiceCard[] = [...ids].map(id => {
    const account = accountMap.get(id);
    const statements = monthly.filter(b => b.account_id === id);
    const first = statements[0];
    const thirdParty = (account?.card_owner_type ?? first?.card_owner_type) === 'third_party';
    const name = account?.name ?? first?.card_name ?? 'Cartão de crédito';
    const institution = account?.institution_name ?? first?.institution_name ?? null;
    const title = thirdParty ? account?.card_holder_name || first?.card_holder_name || name : institution || name;
    const totals = billTotals(statements);
    return {
      id, title, name, institution, thirdParty, bills: statements, ...totals,
      itemCount: statements.reduce((n, b) => n + Number(b.item_count), 0),
      overdue: statements.some(b => cents(b.remaining_amount) > 0 && b.due_date < today),
      state: totals.remaining > 0 ? 'open' : statements.length ? 'paid' : 'empty',
    };
  });
  cards.sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open')
    || (a.bills.find(b => cents(b.remaining_amount) > 0)?.due_date ?? '9999').localeCompare(b.bills.find(b => cents(b.remaining_amount) > 0)?.due_date ?? '9999')
    || a.title.localeCompare(b.title, 'pt-BR'));
  const prior = bills.filter(b => b.due_date.slice(0, 7) < month && cents(b.remaining_amount) > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  return { cards, ...billTotals(monthly), previousRemaining: billTotals(prior).remaining, previousMonth: prior[0]?.due_date.slice(0, 7) ?? null };
}
