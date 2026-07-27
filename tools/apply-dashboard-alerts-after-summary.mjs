import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const dashboardPath = path.join(root, "src", "app", "page.tsx");

if (!fs.existsSync(dashboardPath)) {
  throw new Error(`Arquivo não encontrado: ${dashboardPath}`);
}

const original = fs.readFileSync(dashboardPath, "utf8");
const newline = original.includes("\r\n") ? "\r\n" : "\n";
let source = original;

const importLine =
  'import { FinancialHealthOverview } from "@/components/FinancialHealthOverview";';

if (!source.includes(importLine)) {
  const importAnchor =
    /import\s+\{\s*MonthlyClosingSection\s*\}\s+from\s+["']@\/components\/MonthlyClosingSection["'];?/m;

  if (!importAnchor.test(source)) {
    throw new Error(
      "Não encontrei a importação de MonthlyClosingSection no dashboard.",
    );
  }

  source = source.replace(
    importAnchor,
    (match) => `${match}${newline}${importLine}`,
  );
}

source = source.replace(
  /\r?\n\s*<FinancialHealthOverview\s*\/>\s*/g,
  newline,
);

const monthlyClosingAnchor = /\r?\n(\s*)<MonthlyClosingSection\s*\/>/m;
const monthlyMatch = source.match(monthlyClosingAnchor);

if (!monthlyMatch || monthlyMatch.index === undefined) {
  throw new Error(
    "Não encontrei MonthlyClosingSection para posicionar os alertas depois do Resumo financeiro.",
  );
}

const indentation = monthlyMatch[1] ?? "      ";
const insertion =
  `${newline}${indentation}<FinancialHealthOverview />` +
  `${newline}${newline}${indentation}<MonthlyClosingSection />`;

source = source.replace(monthlyClosingAnchor, insertion);

const componentCount =
  (source.match(/<FinancialHealthOverview\s*\/>/g) ?? []).length;

if (componentCount !== 1) {
  throw new Error(
    `O dashboard deveria conter uma visão de alertas, mas encontrei ${componentCount}.`,
  );
}

const overviewIndex = source.indexOf("<FinancialHealthOverview />");
const summaryIndex = source.indexOf("Resumo financeiro");
const closingIndex = source.indexOf("<MonthlyClosingSection />");

if (
  summaryIndex === -1 ||
  overviewIndex <= summaryIndex ||
  closingIndex <= overviewIndex
) {
  throw new Error(
    "A ordem final não ficou correta: Resumo financeiro, Alertas, Fechamento mensal.",
  );
}

if (source === original) {
  console.log("Dashboard já estava na ordem correta.");
  process.exit(0);
}

fs.writeFileSync(dashboardPath, source, "utf8");
console.log("Dashboard reorganizado com sucesso.");
console.log("Resumo financeiro agora vem antes de Alertas objetivos e Leitura rápida.");
