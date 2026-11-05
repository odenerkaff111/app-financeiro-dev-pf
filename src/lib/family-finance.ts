/** One financial read model for the dashboard and assistant. Money is integer cents. */
export type Row = Record<string, unknown>;
export type FamilyData = {
  accounts: Row[];
  transactions: Row[];
  statements: Row[];
  categories: Row[];
  debts: Row[];
  loans: Row[];
  budgets: Row[];
  preferences: Row[];
  recurring?: Row[];
};
export type FamilyAccount = {
  id: string;
  name: string;
  institution: string;
  type: string;
  scope: string;
  active: boolean;
  balance: number;
  credit: number | null;
  holder: string;
  thirdParty: boolean;
  updated: string | null;
  needsReconciliation: boolean;
};
export type FamilyItem = {
  id: string;
  name: string;
  amount: number;
  due: string | null;
  direction: "in" | "out";
  kind: "transaction" | "statement" | "loan" | "planning";
  accountId: string | null;
  expected: boolean;
  prompt: string;
};
export type Forecast = {
  available: boolean;
  end: number;
  minimum: number;
  minimumOn: string;
  reserve: number;
  points: { day: string; balance: number; name: string; amount: number }[];
  uncertainIncome: number;
  unknownDates: number;
};
export type FamilyOverview = {
  today: string;
  month: string;
  start: string;
  end: string;
  cash: number;
  credit: number;
  unknownCredit: number;
  bills: {
    id: string;
    name: string;
    accountId: string;
    due: string | null;
    total: number;
    paid: number;
    remaining: number;
  }[];
  accounts: FamilyAccount[];
  receivable: number;
  required: number;
  overdue: number;
  undated: number;
  cashIn: number;
  cashOut: number;
  income: number;
  consumption: number;
  investmentIn: number;
  investmentOut: number;
  categories: {
    id: string;
    name: string;
    amount: number;
    share: number;
    incomeShare: number | null;
  }[];
  items: FamilyItem[];
  forecast: Forecast;
  conservativeForecast: Forecast;
  debts: {
    id: string;
    name: string;
    remaining: number;
    paid: number;
    baseline: number;
    progress: number | null;
  }[];
  debtRemaining: number;
  debtPaid: number;
  statementsRemaining: number;
  investments: {
    id: string;
    name: string;
    value: number;
    principal: number;
    gain: number;
    gainPercent: number | null;
    updated: string | null;
  }[];
  invested: number;
  principal: number;
  gain: number;
  issues: string[];
  transactions: {
    id: string;
    name: string;
    merchant: string;
    type: string;
    status: string;
    amount: number;
    accountId: string | null;
    destinationId: string | null;
    statementId: string | null;
    cardAccountId: string | null;
    day: string;
    due: string | null;
    updated: string;
    recurring: boolean;
    snapshot: boolean;
  }[];
};
export const str = (v: unknown) => (typeof v === "string" ? v : "");
export const flag = (v: unknown) => v === true || v === "true";
export const meta = (r: Row): Row =>
  r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata)
    ? (r.metadata as Row)
    : {};
export function moneyCents(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER / 100)
    throw new Error(
      "Valor financeiro inválido. Confira os dados antes de continuar.",
    );
  return Math.round(n * 100);
}
export const currency = (c: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    c / 100,
  );
export function brazilDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function dateLabel(day: string | null) {
  return day ? day.slice(0, 10).split("-").reverse().join("/") : "Sem data";
}
export function validDay(day: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day + "T12:00:00Z")) &&
    new Date(day + "T12:00:00Z").toISOString().slice(0, 10) === day
  );
}
export function monthRange(month: string) {
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Mês inválido.");
  const [year, m] = month.split("-").map(Number);
  return {
    start: month + "-01",
    end: new Date(Date.UTC(year, m, 0, 12)).toISOString().slice(0, 10),
  };
}
const within = (d: string | null, a: string, b: string) =>
  !!d && d >= a && d <= b;
const pending = (t: Row) =>
  ["planned", "overdue"].includes(str(t.status)) &&
  !flag(meta(t).settlement_completed);
export function paidDay(t: Row) {
  const s = str(t.paid_at);
  return s && Number.isFinite(Date.parse(s))
    ? brazilDay(new Date(s))
    : str(t.occurred_on);
}

export function calculateForecast(
  cash: number,
  items: FamilyItem[],
  today: string,
  end: string,
  includeExpected: boolean,
  reserve = 0,
  purchase?: { amount: number; day: string },
): Forecast {
  let balance = cash,
    minimum = cash,
    minimumOn = today;
  const points: Forecast["points"] = [
    { day: today, balance, name: "Saldo atual", amount: 0 },
  ];
  const available = end >= today;
  const events = available
    ? items
        .filter(
          (i) =>
            i.due &&
            i.due <= end &&
            (i.direction === "out" || includeExpected || !i.expected),
        )
        .map((i) => ({
          day: i.due! < today ? today : i.due!,
          name: i.name,
          amount: i.direction === "in" ? i.amount : -i.amount,
        }))
    : [];
  if (available && reserve > 0)
    events.push({
      day: today,
      name: "Reserva mínima a preservar",
      amount: -reserve,
    });
  if (available && purchase)
    events.push({
      day: purchase.day,
      name: "Compra simulada",
      amount: -purchase.amount,
    });
  // With unknown intraday times, payments precede receipts on the same date.
  events.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.amount - b.amount ||
      a.name.localeCompare(b.name),
  );
  for (const event of events) {
    balance += event.amount;
    if (balance < minimum) {
      minimum = balance;
      minimumOn = event.day;
    }
    points.push({ ...event, balance });
  }
  return {
    available,
    end: balance,
    minimum,
    minimumOn,
    reserve,
    points,
    uncertainIncome: items
      .filter(
        (i) => i.direction === "in" && i.expected && i.due && i.due <= end,
      )
      .reduce((a, b) => a + b.amount, 0),
    unknownDates: items.filter((i) => !i.due).length,
  };
}

export function buildFamilyOverview(
  data: FamilyData,
  month: string,
  today: string,
): FamilyOverview {
  const { start, end } = monthRange(month);
  if (!validDay(today)) throw new Error("Data de referência inválida.");
  const horizon =
    (Number(month.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
    Number(month.slice(5)) -
    Number(today.slice(5, 7));
  if (horizon > 24)
    throw new Error("A projeção está disponível para até 24 meses à frente.");
  const accounts = data.accounts.map((a) => ({
    id: str(a.id),
    name: str(a.name),
    institution: str(a.institution_name),
    type: str(a.type),
    scope: str(a.account_scope) || "personal",
    active: flag(a.is_active),
    balance: moneyCents(a.balance),
    credit:
      a.available_credit === null || a.available_credit === undefined
        ? null
        : moneyCents(a.available_credit),
    holder: str(a.card_holder_name),
    thirdParty:
      a.card_owner_type === "third_party" ||
      (a.card_owner_type !== "own" &&
        /vanda|emprestad|terceir/i.test(str(a.name))),
    updated: str(a.balance_updated_at) || null,
    needsReconciliation: flag(a.reconciliation_required),
  }));
  const bankTypes = ["checking", "savings", "cash", "wallet"];
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const isBank = (id: unknown) =>
    bankTypes.includes(accountMap.get(str(id))?.type ?? "");
  const banks = accounts.filter((a) => a.active && bankTypes.includes(a.type));
  const cash = banks.reduce((n, a) => n + a.balance, 0);
  const ownCards = accounts.filter(
    (a) => a.active && a.type === "credit_card" && !a.thirdParty,
  );
  const items: FamilyItem[] = [];
  const tx = data.transactions.filter((t) => t.status !== "cancelled");
  // Project missing future recurrence cycles without mutating the ledger on a GET.
  const monthEnd = end >= today ? end : today;
  let cycle = today.slice(0, 7),
    steps = 0;
  while (cycle <= monthEnd.slice(0, 7) && steps++ < 25) {
    for (const r of data.recurring ?? []) {
      if (
        !flag(r.is_active) ||
        !flag(r.auto_generate) ||
        flag(r.is_variable) ||
        moneyCents(r.amount) <= 0
      )
        continue;
      const last = Number(monthRange(cycle).end.slice(8)),
        day = Math.min(Math.max(Number(r.day_of_month) || 1, 1), last),
        charge = `${cycle}-${String(day).padStart(2, "0")}`;
      if (
        charge < today ||
        charge < str(r.starts_on) ||
        (r.ends_on && charge > str(r.ends_on))
      )
        continue;
      if (
        data.transactions.some(
          (t) =>
            t.recurrence_key === r.id &&
            (meta(t).recurrence_charge_month ??
              meta(t).generated_for ??
              str(t.due_date || t.occurred_on).slice(0, 7)) === cycle,
        )
      )
        continue;
      if (
        data.transactions.some(
          (t) =>
            t.status === "paid" &&
            t.description === r.description &&
            t.amount === r.amount &&
            str(t.occurred_on).slice(0, 7) === cycle &&
            t.account_id === r.account_id,
        )
      )
        continue;
      const card = data.accounts.find((a) => a.id === r.credit_card_account_id);
      let due = charge;
      if (card) {
        let m = cycle;
        const following = (c: string) => {
          const [y, n] = c.split("-").map(Number);
          return new Date(Date.UTC(y, n, 1, 12)).toISOString().slice(0, 7);
        };
        if (day > Number(card.closing_day ?? 31)) m = following(m);
        const cardDate = (c: string) =>
          `${c}-${String(Math.min(Number(card.due_day ?? 10), Number(monthRange(c).end.slice(8)))).padStart(2, "0")}`;
        due = cardDate(m);
        if (due < charge) due = cardDate(following(m));
      }
      tx.push({
        id: `projection:${r.id}:${cycle}`,
        description: `${str(r.description)} · previsão recorrente`,
        type: r.type,
        status: "planned",
        amount: r.amount,
        account_id: card ? null : r.account_id,
        category_id: r.category_id,
        occurred_on: charge,
        due_date: due,
        recurrence_key: r.id,
        card_forecast: !!card,
        metadata: {
          generated_for: cycle,
          virtual_projection: true,
          credit_card_account_id: card?.id,
        },
      });
    }
    const [y, m] = cycle.split("-").map(Number);
    cycle = new Date(Date.UTC(y, m, 1, 12)).toISOString().slice(0, 7);
  }
  const bills = data.statements
    .map((s) => ({
      id: str(s.id),
      name: `Fatura ${accountMap.get(str(s.account_id))?.holder || accountMap.get(str(s.account_id))?.name || "Cartão"}`,
      accountId: str(s.account_id),
      due: str(s.due_date) || null,
      total: moneyCents(s.total_amount),
      paid: moneyCents(s.paid_amount),
      remaining: Math.max(moneyCents(s.remaining_amount), 0),
    }))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  const categoryMap = new Map(
    data.categories.map((c) => [str(c.id), str(c.name)]),
  );
  const categorySums = new Map<string, number>();
  const addCategory = (id: unknown, amount: number) => {
    const key = str(id) || "unclassified";
    categorySums.set(key, (categorySums.get(key) ?? 0) + amount);
  };
  let cashIn = 0,
    cashOut = 0,
    income = 0,
    investmentIn = 0,
    investmentOut = 0;
  const confirmedCycles = new Set(
    tx
      .filter(
        (t) =>
          t.card_statement_id && !flag(t.card_forecast) && t.recurrence_key,
      )
      .map(
        (t) =>
          `${t.recurrence_key}:${meta(t).recurrence_charge_month ?? str(t.occurred_on).slice(0, 7)}`,
      ),
  );
  const statementMap = new Map(data.statements.map((s) => [str(s.id), s]));
  for (const t of tx) {
    const metadata = meta(t),
      amount = moneyCents(t.amount),
      type = str(t.type),
      day = paidDay(t);
    if (
      t.status === "paid" &&
      !flag(metadata.settlement_completed) &&
      !t.card_statement_id &&
      within(day, start, end)
    ) {
      let inflow = 0,
        outflow = 0;
      if (
        ["income", "debt_received", "loan_repayment"].includes(type) &&
        isBank(t.account_id)
      )
        inflow = amount;
      if (
        ["expense", "debt_payment", "loan_given"].includes(type) &&
        isBank(t.account_id)
      )
        outflow = amount;
      if (type === "income") income += inflow;
      if (type === "investment_contribution" && isBank(t.account_id)) {
        outflow = amount;
        investmentOut += amount;
      }
      if (
        type === "investment_withdrawal" &&
        isBank(t.destination_account_id)
      ) {
        inflow = amount;
        investmentIn += amount;
      }
      if (type === "transfer") {
        if (metadata.origin === "card_statement_payment") {
          outflow = isBank(t.account_id) ? amount : 0;
          const sid = str(metadata.statement_id ?? metadata.card_statement_id);
          const components = tx.filter(
            (i) => str(i.card_statement_id) === sid && !flag(i.card_forecast),
          );
          const total =
            components.reduce((sum, i) => sum + moneyCents(i.amount), 0) +
            moneyCents(statementMap.get(sid)?.unallocated_amount);
          if (sid && total > 0) {
            let allocated = 0;
            for (const i of components) {
              const part = Math.floor((outflow * moneyCents(i.amount)) / total);
              allocated += part;
              addCategory(i.category_id, part);
            }
            if (outflow > allocated) addCategory(null, outflow - allocated);
          } else addCategory(null, outflow);
        } else {
          if (isBank(t.account_id) && !isBank(t.destination_account_id))
            outflow = amount;
          if (!isBank(t.account_id) && isBank(t.destination_account_id))
            inflow = amount;
        }
      }
      cashIn += inflow;
      cashOut += outflow;
      if (["expense", "debt_payment"].includes(type))
        addCategory(t.category_id, outflow);
    }
    if (!pending(t) || t.card_statement_id) continue;
    if (
      flag(t.card_forecast) &&
      t.recurrence_key &&
      confirmedCycles.has(
        `${t.recurrence_key}:${metadata.recurrence_charge_month ?? metadata.generated_for ?? str(t.occurred_on).slice(0, 7)}`,
      )
    )
      continue;
    if (!["income", "expense", "debt_payment"].includes(type)) continue;
    const due =
      str(t.due_date) ||
      (type === "income" && metadata.expected_receipt === true
        ? ""
        : str(t.occurred_on)) ||
      null;
    const direction = type === "income" ? "in" : "out";
    items.push({
      id: str(t.id),
      name: str(t.description),
      amount,
      due,
      direction,
      kind: "transaction",
      accountId: str(t.account_id) || null,
      expected:
        direction === "in" && metadata.receipt_confidence !== "confirmed",
      prompt:
        direction === "in"
          ? `Recebi o valor previsto de ${currency(amount)} de ${str(t.description)}. Identifique a previsão existente e me pergunte a conta e data para dar baixa.`
          : `Paguei ${currency(amount)} de ${str(t.description)}, vencimento ${dateLabel(due)}. Identifique o compromisso existente e me pergunte a conta e data.`,
    });
  }
  for (const a of accounts.filter(
    (a) =>
      a.active &&
      a.type === "credit_card" &&
      a.balance > 0 &&
      !data.statements.some((s) => s.account_id === a.id),
  )) {
    items.push({
      id: "unreconciled:" + a.id,
      name: `Fatura ${a.holder || a.name} · saldo sem detalhamento`,
      amount: a.balance,
      due: null,
      direction: "out",
      kind: "statement",
      accountId: a.id,
      expected: false,
      prompt: `Quero conferir a fatura de ${a.name}. Me pergunte o vencimento, total e limite disponíveis para conciliar antes de registrar o pagamento.`,
    });
  }
  for (const s of data.statements) {
    const amount = Math.max(moneyCents(s.remaining_amount), 0);
    if (!amount) continue;
    const account = accountMap.get(str(s.account_id));
    items.push({
      id: str(s.id),
      name: `Fatura ${account?.holder || account?.name || "Cartão"}`,
      amount,
      due: str(s.due_date) || null,
      direction: "out",
      kind: "statement",
      accountId: str(s.account_id),
      expected: false,
      prompt: `Paguei integralmente a fatura de ${account?.name || "cartão"}, com vencimento em ${dateLabel(str(s.due_date))} e saldo de ${currency(amount)}. Me pergunte a conta e data do pagamento antes de propor a baixa.`,
    });
  }
  for (const l of data.loans) {
    const amount = moneyCents(l.remaining_amount);
    if (l.cancelled_at || amount <= 0) continue;
    items.push({
      id: str(l.id),
      name: `Empréstimo a receber de ${str(l.borrower)}`,
      amount,
      due: str(l.due_date) || null,
      direction: "in",
      kind: "loan",
      accountId: null,
      expected: true,
      prompt: `Recebi ${currency(amount)} do empréstimo de ${str(l.borrower)}. Me pergunte a conta e data para registrar a devolução.`,
    });
  }
  for (const b of data.budgets) {
    if (str(b.month).slice(0, 7) !== month) continue;
    const consumed = tx
      .filter(
        (t) =>
          str(t.budget_id) === str(b.id) &&
          t.type === "expense" &&
          !flag(meta(t).settlement_completed) &&
          within(
            t.status === "paid"
              ? paidDay(t)
              : str(t.due_date) || str(t.occurred_on),
            start,
            end,
          ),
      )
      .reduce((n, t) => n + moneyCents(t.amount), 0);
    const remaining = Math.max(moneyCents(b.amount) - consumed, 0);
    if (remaining && end >= today)
      items.push({
        id: "budget:" + str(b.id),
        name: `Planejamento ainda livre: ${str(b.name) || "orçamento do mês"}`,
        amount: remaining,
        due: today > start ? today : start,
        direction: "out",
        kind: "planning",
        accountId: null,
        expected: false,
        prompt:
          "Quero revisar o planejamento ainda não comprometido deste mês.",
      });
  }
  const debts = data.debts
    .filter((d) => d.status !== "cancelled")
    .map((d) => {
      const remaining = Math.max(moneyCents(d.current_balance), 0),
        paid = Math.max(
          moneyCents(d.paid_amount ?? d.total_paid_amount ?? d.total_paid) +
            moneyCents(d.baseline_paid_amount),
          0,
        ),
        baseline = moneyCents(d.baseline_paid_amount);
      return {
        id: str(d.id),
        name: str(d.creditor),
        remaining,
        paid,
        baseline,
        progress:
          paid + remaining > 0 ? (paid / (paid + remaining)) * 100 : null,
      };
    });
  const investments = accounts
    .filter((a) => a.active && a.type === "investment")
    .map((a) => {
      const source = data.accounts.find((r) => r.id === a.id)!;
      const movements = tx
        .filter(
          (t) =>
            t.status === "paid" &&
            ((t.type === "investment_contribution" &&
              t.destination_account_id === a.id) ||
              (t.type === "investment_withdrawal" && t.account_id === a.id)),
        )
        .reduce(
          (n, t) =>
            n +
            (t.type === "investment_contribution" ? 1 : -1) *
              moneyCents(t.amount),
          0,
        );
      const principal = Math.max(
          moneyCents(source.investment_cost_basis) + movements,
          0,
        ),
        gain = a.balance - principal;
      return {
        id: a.id,
        name: a.name,
        value: a.balance,
        principal,
        gain,
        gainPercent: principal > 0 ? (gain / principal) * 100 : null,
        updated: str(source.investment_last_valued_at) || a.updated,
      };
    });
  const selected = items.filter((i) => within(i.due, start, end));
  const reserve = Math.max(moneyCents(data.preferences[0]?.minimum_reserve), 0);
  const consumption = [...categorySums.values()].reduce((a, b) => a + b, 0);
  const issues: string[] = [];
  if (
    data.debts.some(
      (d) =>
        moneyCents(d.current_balance) > 0 &&
        !tx.some((t) => t.debt_id === d.id && pending(t)),
    )
  )
    issues.push(
      "Há dívidas sem parcela prevista no fluxo. Defina seus pagamentos antes de usar a projeção para decidir uma compra.",
    );
  if (
    (data.recurring ?? []).some((r) => flag(r.is_active) && flag(r.is_variable))
  )
    issues.push(
      "Há recorrências com valor variável. Confira as previsões do mês.",
    );
  if (banks.some((a) => a.needsReconciliation))
    issues.push("Há contas que precisam de conferência de saldo.");
  if (items.some((i) => !i.due))
    issues.push(
      "Existem valores sem vencimento. Eles não entram na projeção por data.",
    );
  if (
    items.some(
      (i) => i.direction === "in" && i.expected && i.due && i.due <= end,
    )
  )
    issues.push(
      "Parte do resultado depende de recebimentos previstos, ainda não recebidos.",
    );
  if (!data.budgets.some((b) => str(b.month).slice(0, 7) === month))
    issues.push(
      "A projeção usa compromissos cadastrados; despesas essenciais ainda não planejadas podem reduzir a sobra.",
    );
  const forecast = calculateForecast(cash, items, today, end, true, reserve);
  if (forecast.available && forecast.minimum < 0)
    issues.unshift(
      `O fluxo projeta falta de ${currency(-forecast.minimum)} em ${dateLabel(forecast.minimumOn)}.`,
    );
  return {
    today,
    month,
    start,
    end,
    cash,
    bills,
    credit: ownCards.reduce((n, a) => n + Math.max(a.credit ?? 0, 0), 0),
    unknownCredit: ownCards.filter((a) => a.credit === null).length,
    accounts,
    receivable: selected
      .filter((i) => i.direction === "in")
      .reduce((a, b) => a + b.amount, 0),
    required: selected
      .filter((i) => i.direction === "out" && i.kind !== "planning")
      .reduce((a, b) => a + b.amount, 0),
    overdue: items
      .filter((i) => i.direction === "out" && i.due && i.due < today)
      .reduce((a, b) => a + b.amount, 0),
    undated: items.filter((i) => !i.due).length,
    cashIn,
    cashOut,
    income,
    consumption,
    investmentIn,
    investmentOut,
    categories: [...categorySums]
      .map(([id, amount]) => ({
        id,
        name: categoryMap.get(id) ?? "Sem detalhamento",
        amount,
        share: consumption ? (amount / consumption) * 100 : 0,
        incomeShare: income ? (amount / income) * 100 : null,
      }))
      .sort((a, b) => b.amount - a.amount),
    items: items.sort((a, b) =>
      (a.due ?? "9999").localeCompare(b.due ?? "9999"),
    ),
    forecast,
    conservativeForecast: calculateForecast(
      cash,
      items,
      today,
      end,
      false,
      reserve,
    ),
    debts,
    debtRemaining: debts.reduce((n, d) => n + d.remaining, 0),
    debtPaid: debts.reduce((n, d) => n + d.paid, 0),
    statementsRemaining: items
      .filter((i) => i.kind === "statement")
      .reduce((n, i) => n + i.amount, 0),
    investments,
    invested: investments.reduce((n, i) => n + i.value, 0),
    principal: investments.reduce((n, i) => n + i.principal, 0),
    gain: investments.reduce((n, i) => n + i.gain, 0),
    issues,
    transactions: tx
      .filter((t) => !flag(meta(t).virtual_projection))
      .map((t) => ({
        id: str(t.id),
        name: str(t.description),
        merchant: str(t.merchant),
        type: str(t.type),
        status: str(t.status),
        amount: moneyCents(t.amount),
        accountId: str(t.account_id) || null,
        destinationId: str(t.destination_account_id) || null,
        statementId: str(t.card_statement_id) || null,
        cardAccountId:
          str(
            statementMap.get(str(t.card_statement_id))?.account_id ??
              meta(t).credit_card_account_id,
          ) || null,
        day: t.status === "paid" ? paidDay(t) : str(t.occurred_on),
        due: str(t.due_date) || null,
        updated: str(t.updated_at),
        recurring: !!t.recurrence_key,
        snapshot:
          flag(meta(t).skip_balance_update) ||
          Array.isArray(meta(t).balance_snapshot_accounts),
      }))
      .sort((a, b) => b.day.localeCompare(a.day)),
  };
}

export function assessPurchase(
  view: FamilyOverview,
  amount: number,
  day: string,
  method: "debit" | "credit",
  accountId?: string,
) {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !validDay(day) ||
    day < view.today
  )
    throw new Error(
      "Informe um valor positivo em centavos e uma data atual ou futura.",
    );
  if (method === "credit") {
    const card = view.accounts.find(
      (a) => a.id === accountId && a.type === "credit_card" && !a.thirdParty,
    );
    if (!card)
      return {
        verdict: "unknown",
        reply:
          "Qual cartão próprio será utilizado e em qual fatura essa compra será cobrada?",
      };
    if (card.credit === null)
      return {
        verdict: "unknown",
        reply:
          "O limite disponível deste cartão não foi conferido. Informe o limite e a data da cobrança.",
      };
    if (amount > card.credit)
      return {
        verdict: "no",
        reply: `O limite conferido de ${currency(card.credit)} é menor que o valor da compra.`,
      };
    return {
      verdict: "unknown",
      reply: `Há limite de ${currency(card.credit)}, mas preciso da data de vencimento da cobrança e dos compromissos até essa data para avaliar o orçamento. Limite não é saldo bancário.`,
    };
  }
  if (day > view.end)
    return {
      verdict: "unknown",
      reply: "Abra o mês da compra para incluir os compromissos desse período.",
    };
  const result = calculateForecast(
    view.cash,
    view.items,
    view.today,
    view.end,
    true,
    view.forecast.reserve,
    { amount, day },
  );
  const bank = view.accounts.find((a) => a.id === accountId);
  const accountWarning =
    bank && amount > bank.balance
      ? ` A conta ${bank.name} tem ${currency(bank.balance)}; seria preciso definir a origem da diferença.`
      : "";
  if (result.minimum < 0)
    return {
      verdict: "no",
      reply: `A compra projeta falta de ${currency(-result.minimum)} em ${dateLabel(result.minimumOn)}. O fechamento ficaria em ${currency(result.end)}.${accountWarning}`,
    };
  if (
    view.undated ||
    view.accounts.some((a) => a.needsReconciliation) ||
    view.issues.some(
      (i) => i.includes("sem parcela prevista") || i.includes("valor variável"),
    )
  )
    return {
      verdict: "unknown",
      reply: `No cenário cadastrado, o fechamento seria ${currency(result.end)}, mas há dados sem data ou saldos a conferir. Preciso resolver essas pendências antes de recomendar o gasto.${accountWarning}`,
    };
  return {
    verdict: "conditional",
    reply: `Cabe no cenário cadastrado: o menor saldo seria ${currency(result.minimum)} e o fechamento ${currency(result.end)}. ${result.uncertainIncome ? "A conclusão depende dos recebimentos previstos." : "Ainda considere despesas não cadastradas."}${accountWarning}`,
  };
}
