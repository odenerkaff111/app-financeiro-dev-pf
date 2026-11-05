import {
  type FamilyData,
  type FamilyOverview,
  type Row,
  currency,
  moneyCents,
  str,
  validDay,
  meta,
} from "./family-finance";
import { MODEL_ENTRY_SCHEMA } from "./ai-finance-batch";
export const FAMILY_KINDS = [
  "income",
  "expense",
  "transfer",
  "investment_contribution",
  "investment_withdrawal",
  "pay_card_statement",
  "debt_payment",
  "loan_repayment",
  "borrow_money",
  "card_purchase",
  "settle_obligation",
  "reconcile_account",
  "plan_income",
  "plan_expense",
  "receive_income",
  "update_transaction",
  "cancel_transaction",
  "reconcile_card",
  "set_reserve",
  "update_recurring",
  "cancel_recurring",
] as const;
export type FamilyKind = (typeof FAMILY_KINDS)[number];
export type FamilyPreview = {
  kind: FamilyKind;
  amount: number;
  description: string;
  account_name: string;
  destination_account_name: string | null;
  occurred_on: string;
  due_on: string | null;
  installments: number;
  monthly: boolean;
  available_credit?: number | null;
  creditor?: string | null;
  repayment_amount?: number | null;
  occurred_time?: string | null;
};
export type BalancePreview = { name: string; before: number; after: number };
export type FamilyOperation = Row & {
  kind: FamilyKind;
  amount: number;
  description: string;
  account_id: string | null;
  destination_account_id: string | null;
  occurred_on: string;
  due_on: string | null;
  monthly: boolean;
  installments: number;
};
export type AliasedRow = Row & { ref: string };
export type FamilyAliases = {
  accounts: AliasedRow[];
  categories: AliasedRow[];
  statements: AliasedRow[];
  debts: AliasedRow[];
  loans: AliasedRow[];
  transactions: AliasedRow[];
  recurring: AliasedRow[];
};
const extra = {
  creditor: { type: ["string", "null"] },
  repayment_amount: { type: ["number", "null"] },
  occurred_time: { type: ["string", "null"] },
  transaction_ref: { type: ["string", "null"] },
  recurrence_ref: { type: ["string", "null"] },
  available_credit: { type: ["number", "null"] },
  receipt_confirmed: { type: ["boolean", "null"] },
};
export const FAMILY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "operations"],
  properties: {
    reply: { type: "string" },
    operations: {
      type: "array",
      items: {
        ...MODEL_ENTRY_SCHEMA,
        required: [...MODEL_ENTRY_SCHEMA.required, ...Object.keys(extra)],
        properties: {
          ...MODEL_ENTRY_SCHEMA.properties,
          kind: { type: "string", enum: [...FAMILY_KINDS] },
          ...extra,
        },
      },
    },
  },
};
const alias = (rows: Row[], prefix: string) =>
  rows.map((r, i) => ({ ...r, ref: prefix + (i + 1) }));
export function familyAliases(data: FamilyData): FamilyAliases {
  // All aliases are rebuilt for this request. IDs and versions never come from the model.
  return {
    accounts: alias(
      data.accounts.filter((a) => a.is_active),
      "A",
    ),
    categories: alias(data.categories, "C"),
    statements: alias(
      data.statements.filter((s) => moneyCents(s.remaining_amount) > 0),
      "F",
    ),
    debts: alias(
      data.debts.filter(
        (d) => d.status !== "cancelled" && moneyCents(d.current_balance) > 0,
      ),
      "D",
    ),
    loans: alias(
      data.loans.filter(
        (l) => !l.cancelled_at && moneyCents(l.remaining_amount) > 0,
      ),
      "L",
    ),
    transactions: alias(
      data.transactions
        .filter((t) => t.status !== "cancelled")
        .sort((a, b) => str(b.occurred_on).localeCompare(str(a.occurred_on)))
        .slice(0, 600),
      "T",
    ),
    recurring: alias(
      (data.recurring ?? []).filter((r) => r.is_active),
      "R",
    ),
  };
}
export function publicFamilyContext(a: FamilyAliases, view: FamilyOverview) {
  const account = (id: unknown) =>
    a.accounts.find((x) => x.id === id)?.ref ?? null;
  return {
    today: view.today,
    month: view.month,
    cash: view.cash / 100,
    earned_income: view.income / 100,
    cash_in: view.cashIn / 100,
    cash_out: view.cashOut / 100,
    projection: {
      closing: view.forecast.end / 100,
      minimum: view.forecast.minimum / 100,
      minimum_on: view.forecast.minimumOn,
      without_expected_income: view.conservativeForecast.end / 100,
      minimum_reserve: view.forecast.reserve / 100,
      issues: view.issues,
    },
    accounts: a.accounts.map((x) => ({
      ref: x.ref,
      name: x.name,
      type: x.type,
      scope: x.account_scope,
      balance: x.balance,
      available_credit: x.available_credit,
      holder: x.card_holder_name,
      owner_type: x.card_owner_type,
    })),
    categories: a.categories.map((x) => ({
      ref: x.ref,
      name: x.name,
      kind: x.kind,
    })),
    statements: a.statements.map((x) => ({
      ref: x.ref,
      account: account(x.account_id),
      due: x.due_date,
      remaining: x.remaining_amount,
    })),
    debts: a.debts.map((x) => ({
      ref: x.ref,
      creditor: x.creditor,
      balance: x.current_balance,
      installment: x.installment_amount,
    })),
    loans: a.loans.map((x) => ({
      ref: x.ref,
      borrower: x.borrower,
      remaining: x.remaining_amount,
      due: x.due_date,
    })),
    transactions: a.transactions.map((x) => ({
      ref: x.ref,
      description: x.description,
      merchant: x.merchant,
      amount: x.amount,
      type: x.type,
      status: x.status,
      account: account(x.account_id),
      on: x.occurred_on,
      due: x.due_date,
      linked_to_bill: !!x.card_statement_id,
      frozen_balance:
        !!meta(x).balance_snapshot_accounts ||
        meta(x).skip_balance_update === true,
    })),
    recurring: a.recurring.map((x) => ({
      ref: x.ref,
      description: x.description,
      merchant: x.merchant,
      amount: x.amount,
      type: x.type,
      account: account(x.credit_card_account_id ?? x.account_id),
      day: x.day_of_month,
      starts: x.starts_on,
      ends: x.ends_on,
    })),
  };
}
const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export function validateFamilyPlan(
  raw: unknown,
  ctx: FamilyAliases,
  today: string,
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("A análise veio incompleta. Tente novamente.");
  const value = raw as Row,
    reply = text(value.reply, 4000);
  if (
    !reply ||
    !Array.isArray(value.operations) ||
    value.operations.length > 60
  )
    throw new Error("A IA não retornou um plano válido de até 60 operações.");
  const operations: FamilyOperation[] = [],
    preview: FamilyPreview[] = [],
    seen = new Set<string>(),
    targets = new Set<string>();
  const resolve = (rows: AliasedRow[], ref: unknown, required = false) => {
    if (ref === null || ref === undefined || ref === "") {
      if (required)
        throw new Error(
          "Faltam dados de conta ou registro. Informe-os na conversa.",
        );
      return null;
    }
    const r = rows.find((r) => r.ref === ref);
    if (!r)
      throw new Error(
        "A análise apontou uma referência inexistente. Peça uma nova análise.",
      );
    return r;
  };
  for (const candidate of value.operations) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error("Operação inválida.");
    const o = candidate as Row,
      kind = o.kind as FamilyKind;
    if (!FAMILY_KINDS.includes(kind))
      throw new Error("Essa alteração ainda exige conciliação específica.");
    if (
      typeof o.amount !== "number" ||
      !Number.isFinite(o.amount) ||
      Math.abs(o.amount) > 1e6 ||
      Math.abs(o.amount * 100 - Math.round(o.amount * 100)) > 0.00001 ||
      (o.amount < 0 && kind !== "reconcile_account") ||
      (o.amount === 0 &&
        ![
          "reconcile_account",
          "reconcile_card",
          "set_reserve",
          "cancel_transaction",
          "cancel_recurring",
        ].includes(kind))
    )
      throw new Error(
        "Valor inválido. Informe o valor com até duas casas decimais.",
      );
    const description = text(o.description, 240),
      day = str(o.occurred_on),
      due = o.due_on === null ? null : str(o.due_on) || null;
    if (
      description.length < 3 ||
      !validDay(day) ||
      day < "2020-01-01" ||
      day > today ||
      (due && !validDay(due))
    )
      throw new Error(
        "Descrição ou data inválida. Movimentações futuras devem ser previstas, sem alterar o saldo de hoje.",
      );
    const optional = [
      "plan_income",
      "plan_expense",
      "set_reserve",
      "cancel_transaction",
      "update_recurring",
      "cancel_recurring",
    ].includes(kind);
    const a = resolve(ctx.accounts, o.account_ref, !optional),
      dest = resolve(ctx.accounts, o.destination_ref),
      cat = resolve(ctx.categories, o.category_ref),
      s = resolve(
        ctx.statements,
        o.statement_ref,
        kind === "pay_card_statement",
      ),
      debt = resolve(ctx.debts, o.debt_ref, kind === "debt_payment"),
      loan = resolve(ctx.loans, o.loan_ref, kind === "loan_repayment"),
      t = resolve(
        ctx.transactions,
        o.transaction_ref ?? o.obligation_ref,
        [
          "settle_obligation",
          "receive_income",
          "update_transaction",
          "cancel_transaction",
        ].includes(kind),
      ),
      r = resolve(
        ctx.recurring,
        o.recurrence_ref,
        ["update_recurring", "cancel_recurring"].includes(kind),
      );
    const card = ["card_purchase", "reconcile_card"].includes(kind);
    if (a && (card ? a.type !== "credit_card" : a.type === "credit_card"))
      throw new Error("Separe a conta de débito do cartão de crédito.");
    if (
      a &&
      !["investment_contribution", "investment_withdrawal"].includes(kind) &&
      !card &&
      !["checking", "savings", "cash", "wallet"].includes(str(a.type))
    )
      throw new Error("Selecione uma conta bancária para essa operação.");
    if (
      ["transfer", "investment_contribution", "investment_withdrawal"].includes(
        kind,
      ) &&
      (!dest ||
        dest.id === a?.id ||
        dest.type === "credit_card" ||
        (kind === "transfer" &&
          (dest.type === "investment" || a?.type === "investment")) ||
        (kind === "investment_contribution" &&
          (dest.type !== "investment" || a?.type === "investment")) ||
        (kind === "investment_withdrawal" &&
          (a?.type !== "investment" || dest.type === "investment")))
    )
      throw new Error(
        "Confira origem e destino da transferência, aporte ou resgate.",
      );
    const installments = o.installments ?? 1;
    if (
      !Number.isInteger(installments) ||
      Number(installments) < 1 ||
      Number(installments) > 24
    )
      throw new Error("Informe de 1 a 24 parcelas e o valor total da compra.");
    if (
      [
        "card_purchase",
        "plan_income",
        "plan_expense",
        "reconcile_card",
        "update_recurring",
        "cancel_recurring",
      ].includes(kind) &&
      !due
    )
      throw new Error(
        "Informe a data prevista ou o vencimento antes de confirmar.",
      );
    if (
      kind === "card_purchase" &&
      (!cat || (o.monthly === true && installments !== 1))
    )
      throw new Error("Faltam categoria ou dados da assinatura/parcelamento.");
    if (
      cat &&
      cat.kind !==
        (["income", "plan_income", "receive_income"].includes(kind)
          ? "income"
          : "expense")
    )
      throw new Error("A categoria não corresponde ao tipo de movimentação.");
    if (s && moneyCents(s.remaining_amount) !== moneyCents(o.amount))
      throw new Error(
        "A quitação deve ser do saldo integral da fatura selecionada.",
      );
    if (t) {
      if (
        ["settle_obligation", "receive_income"].includes(kind) &&
        (!["planned", "overdue"].includes(str(t.status)) ||
          moneyCents(t.amount) !== moneyCents(o.amount) ||
          t.type !== (kind === "receive_income" ? "income" : "expense"))
      )
        throw new Error(
          "Identifique a previsão existente com o mesmo valor para dar baixa.",
        );
      if (targets.has(str(t.id)))
        throw new Error("O mesmo registro foi alterado duas vezes no plano.");
      targets.add(str(t.id));
    }
    if (
      r &&
      ["update_recurring", "cancel_recurring"].includes(kind) &&
      due! < today
    )
      throw new Error(
        "Altere recorrências a partir de hoje; o histórico realizado será preservado.",
      );
    const creditor=kind==='borrow_money'?text(o.creditor,120):null;
    const repayment=kind==='borrow_money'?(o.repayment_amount??o.amount):null;
    const clock=o.occurred_time===null||o.occurred_time===undefined?null:str(o.occurred_time);
    if(clock!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))throw new Error('Informe o horário no formato HH:mm.');
    if(kind==='borrow_money'){
      if(typeof o.creditor!=='string'||o.creditor.trim().length>120||!creditor||!due||due<day)throw new Error('Empréstimo recebido exige credor e data de devolução igual ou posterior ao recebimento.');
      if(typeof repayment!=='number'||!Number.isFinite(repayment)||repayment<o.amount||repayment>1e6||Math.abs(repayment*100-Math.round(repayment*100))>0.00001)throw new Error('Informe o total a devolver com até duas casas decimais; ele não pode ser menor que o recebido.');
      if(dest||cat||s||debt||loan||t||r||o.monthly===true||Number(installments)!==1||o.count_installment===true)throw new Error('Novo empréstimo é um recebimento com dívida própria e devolução única; não use transferência, fatura ou recorrência.');
    }
    const available =
      o.available_credit === null || o.available_credit === undefined
        ? null
        : o.available_credit;
    if (
      available !== null &&
      (typeof available !== "number" ||
        available < 0 ||
        available > 1e6 ||
        Math.abs(available * 100 - Math.round(available * 100)) > 0.00001)
    )
      throw new Error("Limite disponível inválido.");
    const operation: FamilyOperation = {
      kind,
      creditor,
      repayment_amount: typeof repayment==='number'?repayment:null,
      occurred_time: kind==='borrow_money'?clock:null,
      amount: o.amount,
      description,
      account_id: a ? str(a.id) : null,
      destination_account_id: dest ? str(dest.id) : null,
      category_id: cat?.id ?? null,
      card_statement_id: s?.id ?? null,
      statement_version: s?.version_token ?? null,
      debt_id: debt?.id ?? null,
      loan_id: loan?.id ?? null,
      transaction_id: t?.id ?? null,
      transaction_version: t?.updated_at ?? null,
      recurrence_id: r?.id ?? null,
      occurred_on: day,
      due_on: due,
      installments: Number(installments),
      monthly: o.monthly === true,
      count_installment: o.count_installment === true,
      merchant: text(o.merchant, 120) || null,
      notes: text(o.notes, 500) || null,
      available_credit: available,
      receipt_confirmed: o.receipt_confirmed === true,
    };
    const signature = kind==='borrow_money'?JSON.stringify([kind,a?.id,o.amount,creditor?.toLocaleLowerCase('pt-BR'),day]):JSON.stringify(operation);
    if (seen.has(signature))
      throw new Error(
        "A análise repetiu um item. Nenhuma operação foi preparada.",
      );
    seen.add(signature);
    operations.push(operation);
    preview.push({
      kind,
      creditor,
      repayment_amount: typeof repayment==='number'?repayment:null,
      occurred_time: kind==='borrow_money'?clock:null,
      amount: o.amount,
      description,
      account_name: str(a?.name) || "Conta a definir",
      destination_account_name: dest ? str(dest.name) : null,
      occurred_on: day,
      due_on: due,
      installments: Number(installments),
      monthly: operation.monthly,
      available_credit: typeof available === "number" ? available : null,
    });
  }
  return { reply, operations, preview };
}
export function previewBalances(
  ops: FamilyOperation[],
  ctx: FamilyAliases,
): BalancePreview[] {
  const current = new Map(
      ctx.accounts
        .filter((a) =>
          ["checking", "savings", "cash", "wallet", "investment"].includes(
            str(a.type),
          ),
        )
        .map((a) => [str(a.id), moneyCents(a.balance)]),
    ),
    next = new Map(current);
  const add = (id: string | null, n: number) => {
    if (id && next.has(id)) next.set(id, next.get(id)! + n);
  };
  for (const o of ops) {
    const amount = moneyCents(o.amount);
    if (["income", "loan_repayment", "receive_income", "borrow_money"].includes(o.kind))
      add(o.account_id, amount);
    if (
      [
        "expense",
        "debt_payment",
        "settle_obligation",
        "pay_card_statement",
      ].includes(o.kind)
    )
      add(o.account_id, -amount);
    if (
      ["transfer", "investment_contribution", "investment_withdrawal"].includes(
        o.kind,
      )
    ) {
      add(o.account_id, -amount);
      add(o.destination_account_id, amount);
    }
    if (o.kind === "reconcile_account" && o.account_id)
      next.set(o.account_id, amount);
    if (["update_transaction", "cancel_transaction"].includes(o.kind)) {
      const t = ctx.transactions.find((t) => t.id === o.transaction_id);
      if (
        t?.status === "paid" &&
        !meta(t).balance_snapshot_accounts &&
        meta(t).skip_balance_update !== true
      ) {
        const delta =
          (o.kind === "cancel_transaction" ? 0 : amount) - moneyCents(t.amount);
        add(str(t.account_id), t.type === "income" ? delta : -delta);
      }
    }
  }
  return [...next]
    .filter(([id, n]) => n !== current.get(id))
    .map(([id, n]) => ({
      name: str(ctx.accounts.find((a) => a.id === id)?.name),
      before: current.get(id)! / 100,
      after: n / 100,
    }));
}
export function questionMonth(message: string, today: string) {
  const text = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const explicit = text.match(/(20\d{2})-(0[1-9]|1[0-2])/);
  if (explicit) return explicit[0];
  const [year, m] = today.split("-").map(Number);
  const brazilianDate = text.match(/\b(\d{1,2})\/(0?[1-9]|1[0-2])(?:\/(20\d{2}))?\b/);
  if (brazilianDate) {
    const day = `${brazilianDate[3] ?? year}-${brazilianDate[2].padStart(2, '0')}-${brazilianDate[1].padStart(2, '0')}`;
    if (validDay(day)) return day.slice(0,7);
  }
  if (/mes passado|mes anterior/.test(text))
    return new Date(Date.UTC(year, m - 2, 1, 12)).toISOString().slice(0, 7);
  if (/mes que vem|proximo mes/.test(text))
    return new Date(Date.UTC(year, m, 1, 12)).toISOString().slice(0, 7);
  const names = [
    "janeiro",
    "fevereiro",
    "marco",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const index = names.findIndex((n) =>
    new RegExp("\\b" + n + "\\b").test(text),
  );
  if (index >= 0) {
    const y = text.match(/\b20\d{2}\b/)?.[0] ?? String(year);
    return y + "-" + String(index + 1).padStart(2, "0");
  }
  return today.slice(0, 7);
}

export function deterministicReply(
  message: string,
  view: FamilyOverview,
): string | null {
  const m = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /paguei|comprei|recebi|resgatei|transferi|mande[iu]|atualiz|corrig|registr|cancele|lance|assin(ei|ar)|defina/.test(
      m,
    )
  )
    return null;
  if (/posso|pizza|comprar|gastar/.test(m)) return null;
  if (
    !/investi|fatura|receber|divida/.test(m) &&
    /saldo|quanto tenho (em|na|no|ao|de dinheiro)|quanto tenho\?/.test(m)
  )
    return `Dinheiro nas contas: ${currency(view.cash)}. ${view.accounts
      .filter(
        (a) =>
          a.active &&
          ["checking", "savings", "cash", "wallet"].includes(a.type),
      )
      .map((a) => `${a.name}: ${currency(a.balance)}`)
      .join(
        "; ",
      )}. Investido, separado: ${currency(view.invested)}. Crédito próprio disponível: ${currency(view.credit)}.`;
  if (/investi|rendeu|rendimento/.test(m))
    return `Investimentos: ${currency(view.invested)}. Principal remanescente registrado: ${currency(view.principal)}; valorização não realizada: ${currency(view.gain)}. ${view.investments.map((i) => `${i.name}: ${currency(i.value)}, principal ${currency(i.principal)}, valorização ${currency(i.gain)}`).join("; ")}. Não inclui limite de cartão.`;
  if (/divida|quanto.*(falta|paguei)/.test(m))
    return `Contratos: ${currency(view.debtRemaining)} a pagar; ${currency(view.debtPaid)} já pagos e informados na linha de base. ${view.debts.map((d) => `${d.name}: ${currency(d.remaining)} restantes e ${currency(d.paid)} pagos`).join("; ")}. Faturas em aberto, separadas dos contratos: ${currency(view.statementsRemaining)}.`;
  if (/(tenho|quanto).*receber|proximos vencimentos|o que vence/.test(m)) {
    const items = view.items.filter((i) =>
      /receber/.test(m) ? i.direction === "in" : i.direction === "out",
    );
    return items.length
      ? items
          .map(
            (i) =>
              `${i.name}: ${currency(i.amount)}, ${i.due ?? "sem data"}${i.expected ? " (previsto)" : ""}`,
          )
          .join("\n")
      : "Não há compromissos nesta seleção.";
  }
  if (/fatura/.test(m)) {
    const bills = view.items.filter(
      (i) =>
        i.kind === "statement" &&
        i.due?.startsWith(view.month) &&
        (!/vanda/.test(m) || /vanda/i.test(i.name)) &&
        (!/nubank/.test(m) || /nubank/i.test(i.name)),
    );
    return bills.length
      ? bills
          .map(
            (i) =>
              `${i.name}, vencimento ${i.due?.split("-").reverse().join("/")}: ${currency(i.amount)}` +
              (/list|itens|tudo|detalh/.test(m)
                ? "\n" +
                  view.transactions
                    .filter((t) => t.statementId === i.id)
                    .map((t) => `• ${t.name}: ${currency(t.amount)}`)
                    .join("\n")
                : ""),
          )
          .join("\n") +
          `\nTotal em aberto nesta seleção: ${currency(bills.reduce((n, i) => n + i.amount, 0))}.`
      : "Não há faturas em aberto cadastradas nesta seleção do mês. Confira o mês em Compromissos → Faturas.";
  }
  if (/sobrar|faltar|projecao|fecha(r|mento)|bem ou mal/.test(m))
    return `Com os compromissos cadastrados até ${view.end}, o fechamento previsto é ${currency(view.forecast.end)}. O menor saldo projetado é ${currency(view.forecast.minimum)}, em ${view.forecast.minimumOn}. Sem recebimentos incertos, o fechamento seria ${currency(view.conservativeForecast.end)}. ${view.issues.join(" ")}`;
  if (/score|serasa|protesto|negativ/.test(m))
    return "A fonte de score, protestos e restrições ainda não está conectada. Não há consulta oficial disponível no app; ausência de consulta não indica ausência de pendências.";
  return null;
}
