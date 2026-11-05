/**
 * Interprete o modelo como entrada NAO CONFIAVEL. Somente aliases criados no
 * servidor sao aceitos; IDs, valores, datas e tipos sao validados antes do RPC.
 */
export const AI_FINANCE_KINDS = [
  "income", "expense", "transfer", "investment_contribution", "investment_withdrawal",
  "pay_card_statement", "debt_payment", "loan_repayment", "card_purchase",
  "settle_obligation", "reconcile_account",
] as const;

export type AiFinanceKind = (typeof AI_FINANCE_KINDS)[number];

export type BatchOperation = {
  kind: AiFinanceKind;
  account_id: string;
  destination_account_id: string | null;
  category_id: string | null;
  card_statement_id: string | null;
  debt_id: string | null;
  loan_id: string | null;
  obligation_id: string | null;
  amount: number;
  description: string;
  merchant: string | null;
  occurred_on: string;
  due_on: string | null;
  installments: number;
  monthly: boolean;
  count_installment: boolean;
  notes: string | null;
};

export type BatchPreviewItem = {
  kind: AiFinanceKind;
  amount: number;
  description: string;
  account_name: string;
  destination_account_name: string | null;
  occurred_on: string;
  due_on: string | null;
  installments: number;
  monthly: boolean;
};

export type BatchAliases = {
  accounts: Array<{
    ref: string; id: string; name: string; institution_name: string | null;
    type: string; scope: string; balance: number; available_credit: number | null;
  }>;
  categories: Array<{ ref: string; id: string; name: string; kind: string }>;
  statements: Array<{
    ref: string; id: string; account_id: string; account_name: string;
    due_date: string; remaining_amount: number;
  }>;
  debts: Array<{
    ref: string; id: string; creditor: string; remaining_amount: number; installment_amount: number; status: string;
  }>;
  loans: Array<{
    ref: string; id: string; borrower: string; remaining_amount: number; due_date: string | null;
  }>;
  obligations: Array<{
    ref: string; id: string; description: string; merchant: string | null;
    amount: number; due_date: string | null;
  }>;
  recurring: Array<{description: string; merchant: string | null; amount: number; card_ref: string | null}>;
};

export const MODEL_ENTRY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: [
    "kind", "account_ref", "destination_ref", "category_ref", "statement_ref", "debt_ref",
    "loan_ref", "obligation_ref", "amount", "description", "merchant", "occurred_on",
    "due_on", "installments", "monthly", "count_installment", "notes",
  ],
  properties: {
    kind: { type: "string", enum: [...AI_FINANCE_KINDS] },
    account_ref: { type: ["string", "null"] },
    destination_ref: { type: ["string", "null"] },
    category_ref: { type: ["string", "null"] },
    statement_ref: { type: ["string", "null"] },
    debt_ref: { type: ["string", "null"] },
    loan_ref: { type: ["string", "null"] },
    obligation_ref: { type: ["string", "null"] },
    amount: { type: ["number", "null"] },
    description: { type: ["string", "null"] },
    merchant: { type: ["string", "null"] },
    occurred_on: { type: ["string", "null"] },
    due_on: { type: ["string", "null"] },
    installments: { type: ["integer", "null"] },
    monthly: { type: ["boolean", "null"] },
    count_installment: { type: ["boolean", "null"] },
    notes: { type: ["string", "null"] },
  },
} as const;

export const MODEL_BATCH_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["reply", "operations"],
  properties: {
    reply: { type: "string" },
    operations: { type: "array", items: MODEL_ENTRY_SCHEMA },
  },
} as const;

type RawBatchItem = Record<string, unknown>;

const GOOD_DATE = /^\d{4}-\d{2}-\d{2}$/;

function localDate(value: unknown, label: string) {
  if (typeof value !== "string" || !GOOD_DATE.test(value) ||
      Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ||
      new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} não foi identificado(a). Informe dia, mês e ano.`);
  }
  return value;
}

function safeMoney(value: unknown, allowZero = false) {
  return typeof value === "number" && Number.isFinite(value) &&
    (allowZero ? value >= 0 : value > 0) && value <= 1_000_000 && Math.abs(Math.round(value * 100) - value * 100) < 0.00001;
}

function lookup<T extends { ref: string }>(rows: T[], value: unknown, label: string): T | null {
  if (value === null || value === "" || value === undefined) return null;
  const found = rows.find((row) => row.ref === value);
  if (!found) throw new Error(`${label} não localizado(a) com segurança. Informe a opção exata.`);
  return found;
}

function textField(value: unknown, maximum = 240) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function matches(date: string, today: string) {
  if (date > today || date < "2020-01-01") {
    throw new Error("A data da movimentação não pode ser futura ou muito antiga.");
  }
}

export function validateModelBatch(
  model: unknown,
  ctx: BatchAliases,
  today: string,
): { reply: string; operations: BatchOperation[]; preview: BatchPreviewItem[] } {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    throw new Error("A IA não retornou um plano válido.");
  }
  const data = model as Record<string, unknown>;
  const reply = textField(data.reply, 700) || "Preciso de mais alguns detalhes para preparar essa atualização.";
  if (!Array.isArray(data.operations) || data.operations.length > 20) {
    throw new Error("O plano retornado pela IA ultrapassou o limite de operações.");
  }
  const seen = new Set<string>();
  const operations: BatchOperation[] = [];
  const preview: BatchPreviewItem[] = [];

  for (const maybeItem of data.operations) {
    if (!maybeItem || typeof maybeItem !== "object" || Array.isArray(maybeItem)) {
      throw new Error("A IA retornou uma operação inválida.");
    }
    const item = maybeItem as RawBatchItem;
    const kind = item.kind as AiFinanceKind;
    if (!AI_FINANCE_KINDS.includes(kind)) throw new Error("Tipo de operação não permitido.");
    const account = lookup(ctx.accounts, item.account_ref, "Conta");
    const destination = lookup(ctx.accounts, item.destination_ref, "Conta de destino");
    const category = lookup(ctx.categories, item.category_ref, "Categoria");
    const statement = lookup(ctx.statements, item.statement_ref, "Fatura");
    const debt = lookup(ctx.debts, item.debt_ref, "Dívida");
    const loan = lookup(ctx.loans, item.loan_ref, "Empréstimo");
    const obligation = lookup(ctx.obligations, item.obligation_ref, "Obrigação");
    const day = localDate(item.occurred_on, "Data");
    matches(day, today);
    const amount = item.amount;
    if (!safeMoney(amount, kind === "reconcile_account")) throw new Error("Revise o valor em reais e centavos antes de continuar.");
    const value = Math.round((amount as number) * 100) / 100;
    if (!account || account.type === "credit_card" && kind !== "card_purchase") {
      throw new Error("Identifique uma conta válida para a operação.");
    }
    if (category && !["income", "expense"].includes(category.kind)) {
      throw new Error("A categoria não corresponde a uma receita ou despesa.");
    }
    if (kind === "income" && category && category.kind !== "income" ||
        kind === "expense" && category && category.kind !== "expense") {
      throw new Error("Categoria incompatível com o tipo de lançamento.");
    }
    const isTransfer = ["transfer", "investment_contribution", "investment_withdrawal"].includes(kind);
    if (!isTransfer && destination) throw new Error("Conta destino é permitida apenas em transferências e investimentos.");
    if (isTransfer && (!destination || account.id === destination.id || destination.type === "credit_card")) {
      throw new Error("Transferência ou investimento exige origem e destino corretos.");
    }
    if (kind === "investment_contribution" && destination?.type !== "investment" ||
        kind === "investment_withdrawal" && account.type !== "investment") {
      throw new Error("Selecione uma conta de investimento para aporte ou resgate.");
    }
    if (kind === "card_purchase" && account.type !== "credit_card") {
      throw new Error("Compra a crédito exige selecionar o cartão, não a conta de débito.");
    }
    if ((kind === "card_purchase" && /emprestad|terceir/i.test(account.name)) ||
        (kind === "pay_card_statement" && statement && /emprestad|terceir/i.test(statement.account_name))) {
      throw new Error("Cartões de terceiros exigem conciliação de fatura e pagamento compartilhado; não registrar como cartão próprio.");
    }
    if (kind === "pay_card_statement" && (!statement || statement.remaining_amount !== value)) {
      throw new Error("Pagamento de fatura deve corresponder exatamente ao saldo restante da fatura.");
    }
    if (kind === "debt_payment" && (!debt || value > debt.remaining_amount)) {
      throw new Error("Não identifiquei dívida com saldo suficiente para esse pagamento.");
    }
    if (kind === "debt_payment" && item.count_installment === true &&
        (!debt || debt.installment_amount <= 0 || value !== debt.installment_amount)) {
      throw new Error("Só marque uma parcela completa se o valor coincidir exatamente com a prestação da dívida.");
    }
    if (kind === "loan_repayment" && (!loan || value > loan.remaining_amount)) {
      throw new Error("Não identifiquei empréstimo a receber com esse saldo.");
    }
    if (kind === "settle_obligation" && (!obligation || value !== obligation.amount)) {
      throw new Error("O pagamento deve corresponder ao valor da obrigação existente.");
    }
    const due = item.due_on === null || item.due_on === "" ? null : localDate(item.due_on, "Vencimento");
    const installments = item.installments === null ? 1 : Number(item.installments);
    if (!Number.isInteger(installments) || installments < 1 || installments > 24) {
      throw new Error("O número de parcelas deve estar entre 1 e 24.");
    }
    if (kind !== "card_purchase" && installments !== 1) {
      throw new Error("Parcelamento só pode ser vinculado a uma compra no cartão.");
    }
    if (kind === "card_purchase" && (!due || !category || category.kind !== "expense")) {
      throw new Error("Compra no cartão exige categoria de despesa e data da primeira fatura.");
    }
    if (kind === "card_purchase" && due && due < day) {
      throw new Error("O vencimento do cartão não pode ser anterior à compra.");
    }
    if (kind === "card_purchase" && item.monthly === true && installments !== 1) {
      throw new Error("Assinaturas mensais devem ser cadastradas como 1 cobrança recorrente.");
    }
    if (kind === "card_purchase" && item.monthly === true) {
      const recurringMatch = ctx.recurring.find(row =>
        row.card_ref === account.ref && Math.abs(row.amount - value) < 0.01 &&
        textField(row.description).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ===
        textField(item.description).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
      );
      if (recurringMatch) {
        throw new Error(`A assinatura ${recurringMatch.description} já existe. Confira a previsão antes de criar outra.`);
      }
    }
    const description = kind === "pay_card_statement" && statement
      ? `Pagamento integral da fatura ${statement.account_name} (venc. ${statement.due_date})`
      : kind === "debt_payment" && debt
      ? `Amortização da dívida - ${debt.creditor}`
      : kind === "loan_repayment" && loan
      ? `Recebimento do empréstimo - ${loan.borrower}`
      : kind === "settle_obligation" && obligation
      ? `Baixa: ${obligation.description}`
      : textField(item.description, 180) ||
      (kind === "pay_card_statement" ? `Pagamento da fatura ${statement?.due_date}` :
       kind === "debt_payment" ? `Pagamento de dívida - ${debt?.creditor}` :
       kind === "loan_repayment" ? `Recebimento de empréstimo - ${loan?.borrower}` :
       kind === "settle_obligation" ? (obligation?.description ?? "Pagamento") : "");
    if (!description || kind === "reconcile_account" && description.length < 5) {
      throw new Error("Informe uma descrição/justificativa para a operação.");
    }
    const merchant = textField(item.merchant, 120) || null;
    const operation: BatchOperation = {
      kind, account_id: account.id, destination_account_id: destination?.id ?? null,
      category_id: category?.id ?? null, card_statement_id: statement?.id ?? null,
      debt_id: debt?.id ?? null, loan_id: loan?.id ?? null, obligation_id: obligation?.id ?? null,
      amount: value, description, merchant, occurred_on: day, due_on: due, installments,
      monthly: kind === "card_purchase" && item.monthly === true,
      count_installment: item.count_installment === true,
      notes: textField(item.notes, 500) || null,
    };
    // Mesmo valor/conta/dia e descricao dentro do pedido pode ser um eco da IA.
    const signature = [kind, account.id, destination?.id, statement?.id, debt?.id,
      obligation?.id, value, day, description.toLocaleLowerCase("pt-BR")].join("|");
    if (seen.has(signature)) throw new Error("A IA repetiu um lançamento. Reescreva com os dados de cada compra.");
    seen.add(signature);
    operations.push(operation);
    preview.push({kind,amount:value,description,account_name:account.name,
      destination_account_name:destination?.name ?? null, occurred_on:day,
      due_on:due,installments,monthly:operation.monthly});
  }

  return {reply,operations,preview};
}

export function publicBatchContext(ctx: BatchAliases) {
  return {
    accounts: ctx.accounts.map(a => ({ref:a.ref,name:a.name,institution:a.institution_name,type:a.type,scope:a.scope})),
    categories: ctx.categories.map(c => ({ref:c.ref,name:c.name,kind:c.kind})),
    open_statements: ctx.statements.map(s => ({ref:s.ref,card:s.account_name,due:s.due_date,remaining:s.remaining_amount})),
    debts: ctx.debts.map(d => ({ref:d.ref,creditor:d.creditor,remaining:d.remaining_amount,installment_amount:d.installment_amount,status:d.status})),
    receivable_loans: ctx.loans.map(l => ({ref:l.ref,borrower:l.borrower,remaining:l.remaining_amount,due:l.due_date})),
    unpaid_obligations: ctx.obligations.map(o => ({ref:o.ref,description:o.description,amount:o.amount,due:o.due_date})),
    active_recurring: ctx.recurring,
  };
}
