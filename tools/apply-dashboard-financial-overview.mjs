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

if (!source.includes("<FinancialHealthOverview")) {
  const errorAnchor = /\r?\n\s{6}\{error\s*&&\s*\(/;
  const match = source.match(errorAnchor);

  if (!match || match.index === undefined) {
    throw new Error(
      "Não encontrei o bloco de erro depois do filtro do dashboard.",
    );
  }

  const insertion =
    `${newline}      <FinancialHealthOverview />${newline}`;

  source =
    source.slice(0, match.index) +
    insertion +
    source.slice(match.index);
}

const componentCount =
  (source.match(/<FinancialHealthOverview\s*\/>/g) ?? []).length;

if (componentCount !== 1) {
  throw new Error(
    `O dashboard deveria conter uma visão consolidada, mas encontrei ${componentCount}.`,
  );
}

if (source === original) {
  console.log("Dashboard já estava atualizado. Nenhuma alteração necessária.");
  process.exit(0);
}

fs.writeFileSync(dashboardPath, source, "utf8");
console.log("Dashboard atualizado com sucesso.");
console.log("O filtro continua no topo e a visão consolidada vem logo abaixo.");
