/** Dashboard-only calculations. Balances are stocks; flows use the selected period.
 * All sums use integer cents. Bank transfers and reserve withdrawals are not income.
 * A card bill is counted once, instead of both its items and its payment.
 */
export type Money = number | string | null | undefined;
export type DashboardAccount = {
  id: string; name: string; type: string; balance: Money; is_active: boolean;
  available_credit?: Money; account_scope?: string; reconciliation_required?: boolean;
};
export type DashboardTransaction = {
  id: string; type: string; status: string; amount: Money;
  occurred_on: string; paid_at?: string | null; due_date?: string | null;
  financial_scope?: string; card_statement_id?: string | null;
  card_forecast?: boolean; metadata?: Record<string, unknown> | null;
  recurrence_key?: string | null; budget_id?: string | null;
};
export type DashboardLoan = {
  id: string; borrower: string; remaining_amount: Money;
  due_date: string | null; cancelled_at: string | null;
};
export type DashboardStatement = {
  id: string; due_date: string; remaining_amount: Money;
};
export type DateRange = { start: string | null; end: string | null };
export type DashboardBudget = { id: string; month: string; amount: Money };
export const cents = (value: Money): number => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error('Valor financeiro invalido recebido do banco.');
  return Math.round(n * 100);
};
export const inRange = (day: string | null | undefined, range: DateRange): boolean =>
  !!day && (!range.start || day >= range.start) && (!range.end || day <= range.end);

export function transactionDay(t: DashboardTransaction): string {
  if (t.status !== 'paid') return t.due_date || t.occurred_on;
  if (!t.paid_at) return t.occurred_on;
  const time = new Date(t.paid_at);
  if (!Number.isFinite(time.getTime())) return t.occurred_on;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(time);
}

export function summarizeBalances(accounts: DashboardAccount[]) {
  const banks = accounts.filter(a => a.is_active && ['checking','savings','cash','wallet'].includes(a.type));
  const cards = accounts.filter(a => a.is_active && a.type === 'credit_card');
  const reserves = accounts.filter(a => a.is_active && a.type === 'investment');
  return {
    cash: banks.reduce((s,a) => s + cents(a.balance), 0) / 100,
    credit: cards.reduce((s,a) => s + cents(a.available_credit), 0) / 100,
    invested: reserves.reduce((s,a) => s + cents(a.balance), 0) / 100,
    unknownCredit: cards.filter(a => a.available_credit == null).length,
    banks, cards, reserves,
  };
}

function isPending(t: DashboardTransaction) {
  return (t.status === 'planned' || t.status === 'overdue') && t.metadata?.settlement_completed !== true;
}
function realizedDirection(t: DashboardTransaction): -1 | 0 | 1 {
  if (t.status !== 'paid' || t.metadata?.settlement_completed === true) return 0;
  // Items become paid when the single cash payment of their statement is recorded.
  if (t.card_statement_id) return 0;
  if (['income','debt_received','loan_repayment'].includes(t.type)) return 1;
  if (['expense','debt_payment','loan_given'].includes(t.type)) return -1;
  if (t.type === 'transfer' && t.metadata?.origin === 'card_statement_payment') return -1;
  return 0;
}

export function summarizePeriod(
  transactions: DashboardTransaction[], statements: DashboardStatement[],
  loans: DashboardLoan[], range: DateRange, today: string,
) {
  let income = 0, expense = 0, receivableInPeriod = 0, receivable = 0, payable = 0, overdue = 0;
  const openLoans = loans.filter(l => !l.cancelled_at && cents(l.remaining_amount) > 0);
  const confirmedCycles = new Set(transactions.filter(t =>
    t.status !== 'cancelled' && !t.card_forecast && t.card_statement_id && t.recurrence_key,
  ).map(t => `${t.recurrence_key}:${t.metadata?.recurrence_charge_month ?? t.occurred_on.slice(0,7)}`));
  for (const t of transactions) {
    if (t.status === 'cancelled') continue;
    const amount = cents(t.amount);
    const day = transactionDay(t);
    const direction = realizedDirection(t);
    if (inRange(day, range)) {
      if (direction === 1) income += amount;
      if (direction === -1) expense += amount;
    }
    if (!isPending(t)) continue;
    if (['income','debt_received'].includes(t.type)) {
      receivable += amount;
      if (inRange(day, range)) receivableInPeriod += amount;
    }
    if (!['expense','debt_payment'].includes(t.type) || t.card_statement_id || !inRange(day,range)) continue;
    // Defensive deduplication of an old forecast whose charge is already itemized.
    if (t.card_forecast && t.recurrence_key && confirmedCycles.has(
      `${t.recurrence_key}:${t.metadata?.recurrence_charge_month ?? t.metadata?.generated_for ?? t.occurred_on.slice(0,7)}`,
    )) continue;
    payable += amount;
    if (day < today) overdue += amount;
  }
  for (const bill of statements) {
    const remaining = Math.max(cents(bill.remaining_amount), 0);
    if (!inRange(bill.due_date, range)) continue;
    payable += remaining;
    if (bill.due_date < today) overdue += remaining;
  }
  for (const loan of openLoans) {
    const amount = cents(loan.remaining_amount);
    receivable += amount;
    // The total receivable is visible now, but October repayment is not September income.
    if (loan.due_date ? inRange(loan.due_date, range) : !range.start && !range.end) receivableInPeriod += amount;
  }
  return {
    income: income / 100, expense: expense / 100, receivable: receivable / 100,
    receivableInPeriod: receivableInPeriod / 100, payable: payable / 100, overdue: overdue / 100,
    loansReceivable: openLoans.reduce((s,l) => s + cents(l.remaining_amount),0) / 100,
  };
}

export function uncommittedBudget(
  budgets: DashboardBudget[], transactions: DashboardTransaction[], months: Set<string>,
) {
  let remaining = 0;
  for (const b of budgets) {
    if (!months.has(b.month)) continue;
    // A pending item already in 'payable' must not also count as unused planning.
    const committed = transactions.filter(t => t.budget_id === b.id && t.type === 'expense' &&
      t.status !== 'cancelled' && t.metadata?.settlement_completed !== true &&
      `${transactionDay(t).slice(0,7)}-01` === b.month,
    ).reduce((s,t) => s + cents(t.amount),0);
    remaining += Math.max(cents(b.amount) - committed,0);
  }
  return remaining / 100;
}

export function closingFigures(income: number, expense: number, receivable: number, payable: number, reserve: number) {
  const realized = cents(income) - cents(expense);
  return { realized: realized/100, projected: (realized + cents(receivable) - cents(payable) - cents(reserve))/100 };
}
