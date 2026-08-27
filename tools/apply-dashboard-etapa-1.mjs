import fs from "node:fs";
import path from "node:path";

const pagePath = path.resolve("src/app/page.tsx");

if (!fs.existsSync(pagePath)) {
  throw new Error(`Arquivo não encontrado: ${pagePath}`);
}

const original = fs.readFileSync(pagePath, "utf8");
const newline = original.includes("\r\n") ? "\r\n" : "\n";
let source = original.replace(/\r\n/g, "\n");

function addImport(importLine, anchor) {
  if (source.includes(importLine)) return;

  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) {
    throw new Error(`Importação de referência não encontrada: ${anchor}`);
  }

  const lineEnd = source.indexOf("\n", anchorIndex);
  source =
    source.slice(0, lineEnd + 1) +
    `${importLine}\n` +
    source.slice(lineEnd + 1);
}

function findContainingSection(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Bloco não encontrado: ${marker}`);
  }

  const start = text.lastIndexOf("<section", markerIndex);
  if (start === -1) {
    throw new Error(`Abertura de section não encontrada para: ${marker}`);
  }

  const tagPattern = /<section\b|<\/section>/g;
  tagPattern.lastIndex = start;
  let depth = 0;
  let match;

  while ((match = tagPattern.exec(text))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return {
          start,
          end: tagPattern.lastIndex,
        };
      }
    } else {
      depth += 1;
    }
  }

  throw new Error(`Fechamento de section não encontrado para: ${marker}`);
}

addImport(
  'import { CostOfLivingCard } from "@/components/dashboard/CostOfLivingCard";',
  'import { FinancialHealthOverview } from "@/components/FinancialHealthOverview";',
);
addImport(
  'import { InvestmentOverview } from "@/components/dashboard/InvestmentOverview";',
  'import { FinancialHealthOverview } from "@/components/FinancialHealthOverview";',
);
addImport(
  'import { UpcomingObligations } from "@/components/dashboard/UpcomingObligations";',
  'import { FinancialHealthOverview } from "@/components/FinancialHealthOverview";',
);

source = source.replace(
  /import \{ SpendingCategoryChart \} from "@\/components\/SpendingCategoryChart";/,
  'import { SpendingCategoryChart } from "@/components/dashboard/SpendingCategoryChart";',
);

if (!source.includes("<CostOfLivingCard />")) {
  const investedLabel = source.indexOf('label="Investido"');
  if (investedLabel === -1) {
    throw new Error('Card "Investido" não encontrado no Resumo financeiro.');
  }

  const cardStart = source.lastIndexOf("<MetricCard", investedLabel);
  const cardEnd = source.indexOf("/>", investedLabel);

  if (cardStart === -1 || cardEnd === -1) {
    throw new Error('Não foi possível localizar o card "Investido" completo.');
  }

  source =
    source.slice(0, cardStart) +
    "<CostOfLivingCard />" +
    source.slice(cardEnd + 2);
}

if (!source.includes("<InvestmentOverview />")) {
  const chartSection = findContainingSection(
    source,
    "Fluxo financeiro mensal",
  );

  const replacement = `      <section className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-3">\n        <div className="xl:col-span-2">\n          <InvestmentOverview />\n        </div>\n\n        <SpendingCategoryChart\n          categoryData={categoryChartData}\n          periodFilter={periodFilter}\n        />\n      </section>`;

  source =
    source.slice(0, chartSection.start) +
    replacement +
    source.slice(chartSection.end);
}

if (!source.includes("<UpcomingObligations />")) {
  const pendingSection = findContainingSection(
    source,
    "Movimentações pendentes",
  );

  source =
    source.slice(0, pendingSection.start) +
    "      <UpcomingObligations />" +
    source.slice(pendingSection.end);
}

const requiredMarkers = [
  '<CostOfLivingCard />',
  '<InvestmentOverview />',
  '<UpcomingObligations />',
  '@/components/dashboard/SpendingCategoryChart',
];

for (const marker of requiredMarkers) {
  if (!source.includes(marker)) {
    throw new Error(`Validação final falhou: ${marker}`);
  }
}

if (source.includes("Fluxo financeiro mensal")) {
  throw new Error(
    'O bloco "Fluxo financeiro mensal" ainda está renderizado no Dashboard.',
  );
}

if (source.includes("Movimentações pendentes")) {
  throw new Error(
    'O bloco antigo "Movimentações pendentes" ainda está renderizado.',
  );
}

if (source === original.replace(/\r\n/g, "\n")) {
  console.log("Dashboard Etapa 1 já estava aplicado.");
  process.exit(0);
}

fs.writeFileSync(pagePath, source.replace(/\n/g, newline), "utf8");

console.log("Dashboard Etapa 1 aplicado com sucesso.");
console.log("Fluxo mensal ocultado, investimentos adicionados e obrigações unificadas.");
