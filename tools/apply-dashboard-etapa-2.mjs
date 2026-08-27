import fs from "node:fs";
import path from "node:path";

const pagePath = path.resolve("src/app/page.tsx");

if (!fs.existsSync(pagePath)) {
  throw new Error(`Arquivo não encontrado: ${pagePath}`);
}

const original = fs.readFileSync(pagePath, "utf8");
const newline = original.includes("\r\n") ? "\r\n" : "\n";
let source = original.replace(/\r\n/g, "\n");

const importLine =
  'import { FinancialRecommendations } from "@/components/dashboard/FinancialRecommendations";';

if (!source.includes(importLine)) {
  const anchor =
    'import { FinancialHealthOverview } from "@/components/FinancialHealthOverview";';
  const anchorIndex = source.indexOf(anchor);

  if (anchorIndex === -1) {
    throw new Error(
      "Importação de FinancialHealthOverview não encontrada.",
    );
  }

  const lineEnd = source.indexOf("\n", anchorIndex);
  source =
    source.slice(0, lineEnd + 1) +
    `${importLine}\n` +
    source.slice(lineEnd + 1);
}

if (!source.includes("<FinancialRecommendations />")) {
  const marker = "<FinancialHealthOverview />";
  const markerIndex = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(
      "FinancialHealthOverview não encontrado no Dashboard.",
    );
  }

  const insertAt = markerIndex + marker.length;
  source =
    source.slice(0, insertAt) +
    "\n\n      <FinancialRecommendations />" +
    source.slice(insertAt);
}

if (!source.includes(importLine)) {
  throw new Error("Validação da importação falhou.");
}

if (!source.includes("<FinancialRecommendations />")) {
  throw new Error("Validação do componente falhou.");
}

if (source === original.replace(/\r\n/g, "\n")) {
  console.log("Dashboard Etapa 2 já estava aplicado.");
  process.exit(0);
}

fs.writeFileSync(pagePath, source.replace(/\n/g, newline), "utf8");

console.log("Dashboard Etapa 2 aplicado com sucesso.");
console.log("Recomendações persistidas da Kyra foram adicionadas.");
