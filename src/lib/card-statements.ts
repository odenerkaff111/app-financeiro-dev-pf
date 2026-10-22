import { cents, type Money } from '@/lib/dashboard/summary';

export type CardBill = {
  id: string; household_id: string; account_id: string; due_date: string;
  card_name: string; institution_name: string | null;
  card_owner_type: 'own' | 'third_party'; card_holder_name: string | null;
  total_amount: Money; paid_amount: Money; remaining_amount: Money; unallocated_amount: Money;
  item_count: number; version_token: string;
};
export type CardBillItem = {
  id: string; description: string; merchant: string | null; amount: Money;
  due_date: string | null; occurred_on: string; status: string;
  installment_number: number | null; installment_total: number | null;
  card_statement_id: string | null; card_forecast: boolean;
  metadata: Record<string, unknown> | null;
};
export function shiftMonth(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1 + offset, 1)).toISOString().slice(0, 7);
}
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T12:00:00Z`));
}
export function monthEnd(month: string): string {
  return new Date(Date.parse(`${shiftMonth(month, 1)}-01T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
}
export function visibleBills(bills: CardBill[], month: string): CardBill[] {
  return bills.filter(b => b.due_date.startsWith(month) && cents(b.total_amount) > 0)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.card_name.localeCompare(b.card_name));
}
export function billTotals(bills: CardBill[]) {
  const sum = (key: 'total_amount' | 'paid_amount' | 'remaining_amount') => bills.reduce((s, b) => s + Math.max(0, cents(b[key])), 0) / 100;
  return { total: sum('total_amount'), paid: sum('paid_amount'), remaining: sum('remaining_amount') };
}
export function groupCardBills(bills: CardBill[]) {
  const groups = new Map<string, CardBill[]>();
  for (const bill of bills) groups.set(bill.account_id, [...(groups.get(bill.account_id) ?? []), bill]);
  return [...groups.values()].sort((a, b) => a[0].card_owner_type.localeCompare(b[0].card_owner_type) || a[0].card_name.localeCompare(b[0].card_name));
}
export function initialBillMonth(bills: CardBill[], today: string): string {
  const open = bills.filter(b => cents(b.remaining_amount) > 0).sort((a, b) => a.due_date.localeCompare(b.due_date));
  return (open.find(b => b.due_date >= today)?.due_date ?? open[0]?.due_date ?? today).slice(0, 7);
}
export function statementItems(items: CardBillItem[], statement: string) {
  return items.filter(t => t.card_statement_id === statement && t.status !== 'cancelled' && !t.card_forecast)
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.description.localeCompare(b.description));
}
export function statementVersions(bills: CardBill[]) {
  return bills.filter(b => cents(b.remaining_amount) > 0).map(b => ({ id: b.id, version: b.version_token })).sort((a, b) => a.id.localeCompare(b.id));
}
