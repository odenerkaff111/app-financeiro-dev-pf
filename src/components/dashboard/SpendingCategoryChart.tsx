"use client";

import { useMemo, useState } from "react";
import { WalletCards } from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

type PeriodFilter =
  | "today"
  | "week"
  | "month"
  | "next_month"
  | "custom"
  | "all";

type CategoryData = {
  name: string;
  value: number;
};

type SpendingCategoryChartProps = {
  categoryData: CategoryData[];
  periodFilter: PeriodFilter;
  customStart?: string;
  customEnd?: string;
};

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  today: "hoje",
  week: "nesta semana",
  month: "neste mês",
  next_month: "no próximo mês",
  custom: "no período selecionado",
  all: "em todo o período",
};

// Alterna famílias de cor para reduzir tons parecidos lado a lado.
const HUES = [
  160, 42, 220, 350, 285, 25, 190, 95,
  320, 65, 205, 8, 255, 125, 335, 55,
];

function categoryColor(index: number) {
  const cycle = Math.floor(index / HUES.length);
  const hue = (HUES[index % HUES.length] + cycle * 13) % 360;
  const saturation = 68 + (cycle % 3) * 5;
  const lightness = 39 + (cycle % 4) * 4;

  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function formatCurrency(value: number | string | null) {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string }>;
}) {
  if (!active || !payload?.length) return null;

  const item = payload[0];
  const name = String(item.name ?? "Categoria");
  const value = Number(item.value ?? 0);

  return (
    <div className="rounded-xl border border-[#0D1B2A]/10 bg-white px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-[#3A3A3C]/65">{name}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#0D1B2A]">
        {formatCurrency(value)}
      </p>
    </div>
  );
}

export function SpendingCategoryChart({
  categoryData,
  periodFilter,
}: SpendingCategoryChartProps) {
  const [legendExpanded, setLegendExpanded] = useState(false);

  const chartData = useMemo(() => {
    const totals = new Map<string, number>();

    categoryData.forEach((category) => {
      const name = category.name.trim() || "Sem categoria";
      const value = Number(category.value || 0);

      if (!Number.isFinite(value) || value <= 0) return;

      totals.set(name, (totals.get(name) ?? 0) + value);
    });

    return Array.from(totals.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((first, second) => second.value - first.value);
  }, [categoryData]);

  const colorByCategory = useMemo(
    () =>
      new Map(
        chartData.map((item, index) => [
          item.name,
          categoryColor(index),
        ]),
      ),
    [chartData],
  );

  const visibleLegend = legendExpanded
    ? chartData
    : chartData.slice(0, 8);

  const hiddenCount = Math.max(chartData.length - 8, 0);

  return (
    <article className="h-fit self-start rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#0D1B2A]">
            Gastos e compromissos
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#3A3A3C]/60">
            Distribuição pelas categorias reais {PERIOD_LABELS[periodFilter]}.
          </p>
        </div>
        <WalletCards size={19} className="shrink-0 text-[#C8A15A]" />
      </div>

      {chartData.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-center text-sm text-[#3A3A3C]/50">
          Nenhum gasto ou compromisso encontrado no período.
        </div>
      ) : (
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(250px,1.05fr)_minmax(220px,.95fr)] lg:items-center">
          <div className="h-[250px] min-h-0 min-w-0 sm:h-[270px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={96}
                  paddingAngle={1.5}
                  stroke="none"
                >
                  {chartData.map((category) => (
                    <Cell
                      key={category.name}
                      fill={colorByCategory.get(category.name)}
                    />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="min-w-0">
            <div
              className={[
                "grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2",
                legendExpanded ? "max-h-56 overflow-y-auto pr-1" : "",
              ].join(" ")}
            >
              {visibleLegend.map((category) => (
                <div
                  key={category.name}
                  className="flex min-w-0 items-center gap-2 text-[11px] leading-4"
                  title={category.name}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: colorByCategory.get(category.name),
                    }}
                  />
                  <span className="truncate text-[#3A3A3C]/70">
                    {category.name}
                  </span>
                </div>
              ))}
            </div>

            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setLegendExpanded((current) => !current)}
                className="mt-3 text-xs font-semibold text-[#0D1B2A] underline decoration-[#C8A15A]/60 underline-offset-4 hover:decoration-[#C8A15A]"
              >
                {legendExpanded
                  ? "Mostrar menos"
                  : `Ver todas as categorias (+${hiddenCount})`}
              </button>
            )}

            <p className="mt-3 text-[10px] leading-4 text-[#3A3A3C]/45">
              Passe o mouse sobre uma fatia para ver o valor.
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
