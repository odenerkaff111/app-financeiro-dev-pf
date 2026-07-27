import fs from "node:fs";
import path from "node:path";

const targetPath = path.resolve("src/app/registros/page.tsx");

if (!fs.existsSync(targetPath)) {
  throw new Error(`Arquivo não encontrado: ${targetPath}`);
}

const original = fs.readFileSync(targetPath, "utf8");

// Normaliza temporariamente CRLF/LF para que a aplicação funcione no Windows.
let content = original.replace(/\r\n/g, "\n");

if (content.includes("<UnifiedFinancialEntryModal")) {
  console.log("A Parte 2C1 já está aplicada em Movimentações.");
  process.exit(0);
}

function fail(label) {
  throw new Error(`Ponto não encontrado: ${label}`);
}

function replaceRegex(pattern, replacement, label) {
  if (!pattern.test(content)) {
    fail(label);
  }

  pattern.lastIndex = 0;
  content = content.replace(pattern, replacement);
}

function replaceFunction(startName, nextName, replacement, label) {
  const start = content.indexOf(startName);
  const end = content.indexOf(nextName, start + startName.length);

  if (start < 0 || end <= start) {
    fail(label);
  }

  content =
    content.slice(0, start) +
    replacement.trimEnd() +
    "\n\n" +
    content.slice(end);
}

// 1. Adiciona HandCoins ao import de lucide-react sem depender da formatação.
if (!/\bHandCoins\b/.test(
  content.match(/import\s*\{[\s\S]*?\}\s*from\s*["']lucide-react["'];/)?.[0] ?? "",
)) {
  const lucidePattern = /import\s*\{([\s\S]*?)\}\s*from\s*(["'])lucide-react\2;/;
  const match = content.match(lucidePattern);

  if (!match) {
    fail("bloco de importação do lucide-react");
  }

  const body = match[1].trimEnd();
  const separator = body.endsWith(",") ? "" : ",";
  const updated = `import {${body}${separator}\n  HandCoins,\n} from ${match[2]}lucide-react${match[2]};`;
  content = content.replace(match[0], updated);
}

// 2. Importa o modal unificado.
if (!content.includes(
  '@/components/finance/UnifiedFinancialEntryModal',
)) {
  replaceRegex(
    /import\s*\{\s*useHousehold\s*\}\s*from\s*["']@\/contexts\/HouseholdContext["'];/,
    (found) =>
      `${found}\nimport { UnifiedFinancialEntryModal } from "@/components/finance/UnifiedFinancialEntryModal";`,
    "importação do modal unificado",
  );
}

// 3. Disponibiliza a permissão de escrita.
if (!/const\s*\{[^}]*\bcanWrite\b[^}]*\}\s*=\s*useHousehold\(\);/.test(content)) {
  replaceRegex(
    /const\s*\{\s*household\s*\}\s*=\s*useHousehold\(\);/,
    "const { household, canWrite } = useHousehold();",
    "permissão do grupo familiar",
  );
}

// 4. Cria o estado do modal unificado.
if (!content.includes("unifiedModalOpen")) {
  replaceRegex(
    /const\s*\[\s*modalOpen\s*,\s*setModalOpen\s*\]\s*=\s*useState\(false\);/,
    `const [modalOpen, setModalOpen] = useState(false);\n\n  const [unifiedModalOpen, setUnifiedModalOpen] = useState(false);`,
    "estado do modal unificado",
  );
}

// 5. O botão principal passa a abrir o cadastro central.
replaceFunction(
  "  function openCreateModal(",
  "  function openEditModal(",
  `  function openCreateModal() {
    if (!canWrite) {
      setPageError("Seu acesso é somente leitura.");
      return;
    }

    setUnifiedModalOpen(true);
  }`,
  "função de abertura do cadastro",
);

// 6. Rótulos corretos para pagamentos e empréstimos.
replaceFunction(
  "function getTypeOption(",
  "function getEffectiveStatus(",
  `function getTypeOption(type: TransactionType | string): TypeOption {
  if (type === "debt_payment") {
    return {
      value: "expense",
      label: "Pagamento de dívida",
      shortLabel: "Dívida paga",
      icon: HandCoins,
    };
  }

  if (type === "debt_received") {
    return {
      value: "income",
      label: "Empréstimo recebido",
      shortLabel: "Empréstimo",
      icon: HandCoins,
    };
  }

  return (
    TYPE_OPTIONS.find(
      (option) => option.value === type,
    ) ?? TYPE_OPTIONS[0]
  );
}`,
  "função de rótulo dos tipos",
);

replaceFunction(
  "function getAmountClasses(",
  "function getAmountPrefix(",
  `function getAmountClasses(type: TransactionType | string) {
  if (type === "income" || type === "debt_received") {
    return "text-emerald-700";
  }

  if (type === "expense" || type === "debt_payment") {
    return "text-red-700";
  }

  return "text-[#0D1B2A]";
}`,
  "função de cor dos valores",
);

replaceFunction(
  "function getAmountPrefix(",
  "export default function TransactionsPage(",
  `function getAmountPrefix(type: TransactionType | string) {
  if (type === "income" || type === "debt_received") {
    return "+";
  }

  if (type === "expense" || type === "debt_payment") {
    return "−";
  }

  return "";
}`,
  "função de prefixo dos valores",
);

// 7. Impede edição isolada de registros ligados ao motor financeiro.
if (!content.includes(
  "Este registro está ligado a uma dívida ou compromisso",
)) {
  const editStart = content.indexOf("  function openEditModal(");

  if (editStart < 0) {
    fail("função de edição");
  }

  const bodyStart = content.indexOf(") {", editStart);

  if (bodyStart < 0) {
    fail("assinatura da função de edição");
  }

  const insertionPoint = bodyStart + 3;
  const guard = `
    if (
      transaction.debt_id ||
      ["debt_payment", "debt_received"].includes(String(transaction.type)) ||
      Boolean(transaction.metadata?.commitment_id)
    ) {
      setPageError(
        "Este registro está ligado a uma dívida ou compromisso e não pode ser alterado isoladamente.",
      );
      return;
    }
`;

  content =
    content.slice(0, insertionPoint) +
    guard +
    content.slice(insertionPoint);
}

// 8. Atualiza os textos e a permissão do botão.
content = content.replace(
  /Registre receitas, despesas,\s*transferências, aportes e resgates\./,
  "Esta é a porta única para registrar movimentações, contas, recebíveis e dívidas.",
);

content = content.replace(
  /onClick=\{openCreateModal\}\s*disabled=\{\s*activeAccounts\.length === 0\s*\}/,
  `onClick={openCreateModal}\n          disabled={!canWrite}`,
);

content = content.replace(
  /Nova movimentação/g,
  "Novo registro",
);

// 9. Renderiza o modal central e preserva o modal antigo apenas para edição.
const modalAnchor = "      {modalOpen && (";

if (!content.includes(modalAnchor)) {
  fail("renderização do modal existente");
}

content = content.replace(
  modalAnchor,
  `      <UnifiedFinancialEntryModal
        open={unifiedModalOpen}
        onClose={() => setUnifiedModalOpen(false)}
        onSaved={loadData}
      />

${modalAnchor}`,
);

// 10. Valida o resultado completo antes de escrever.
const requiredResults = [
  'import { UnifiedFinancialEntryModal }',
  "const { household, canWrite } = useHousehold();",
  "unifiedModalOpen",
  "setUnifiedModalOpen(true)",
  "<UnifiedFinancialEntryModal",
  "Novo registro",
];

for (const required of requiredResults) {
  if (!content.includes(required)) {
    throw new Error(`Validação final falhou: ${required}`);
  }
}

fs.writeFileSync(targetPath, content, "utf8");

console.log("Parte 2C1 aplicada em src/app/registros/page.tsx");
console.log("Registro manual centralizado em Movimentações.");
