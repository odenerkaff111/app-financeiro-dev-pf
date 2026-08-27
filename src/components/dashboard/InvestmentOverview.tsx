"use client";

import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Landmark,
  Loader2,
  PiggyBank,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { format, parseISO, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type InvestmentPosition = {
  id: string;
  name: string;
  institution_name: string | null;
  investment_asset_type: string | null;
  current_value: number | string;
  cost_basis: number | string;
  estimated_return: number | string | null;
  estimated_return_percentage: number | string | null;
  is_active: boolean;
};

type InvestmentSnapshot = {
  account_id: string;
  snapshot_date: string;
  market_value: number | string;
  cost_basis: number | string;
};

type ChartPoint = {
  month: string;
  invested: number;
  value: number;
};

function formatCurrency(value: number | string | null) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function monthKey(value: string) {
  try {
    return format(parseISO(value), "yyyy-MM");
  } catch {
    return value.slice(0, 7);
  }
}

export function InvestmentOverview() {
  const { household } = useHousehold();
  const [positions, setPositions] = useState<InvestmentPosition[]>([]);
  const [snapshots, setSnapshots] = useState<InvestmentSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const startDate = format(subMonths(new Date(), 11), "yyyy-MM-01");

    const [positionsResult, snapshotsResult] = await Promise.all([
      supabase
        .from("pf_investment_positions")
        .select(
          "id, name, institution_name, investment_asset_type, current_value, cost_basis, estimated_return, estimated_return_percentage, is_active",
        )
        .eq("household_id", household.id)
        .eq("is_active", true)
        .order("current_value", { ascending: false }),
      supabase
        .from("pf_investment_snapshots")
        .select("account_id, snapshot_date, market_value, cost_basis")
        .eq("household_id", household.id)
        .gte("snapshot_date", startDate)
        .order("snapshot_date", { ascending: true }),
    ]);

    const firstError = positionsResult.error ?? snapshotsResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setPositions(
      (positionsResult.data ?? []) as InvestmentPosition[],
    );
    setSnapshots(
      (snapshotsResult.data ?? []) as InvestmentSnapshot[],
    );
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totals = useMemo(() => {
    return positions.reduce(
      (summary, position) => {
        const currentValue = Number(position.current_value || 0);
        const costBasis = Number(position.cost_basis || 0);
        const estimatedReturn =
          position.estimated_return === null
            ? null
            : Number(position.estimated_return || 0);

        summary.currentValue += currentValue;
        summary.costBasis += costBasis;

        if (estimatedReturn !== null) {
          summary.estimatedReturn += estimatedReturn;
          summary.hasReturnBasis = true;
        }

        return summary;
      },
      {
        currentValue: 0,
        costBasis: 0,
        estimatedReturn: 0,
        hasReturnBasis: false,
      },
    );
  }, [positions]);

  const returnPercentage =
    totals.costBasis > 0
      ? (totals.estimatedReturn / totals.costBasis) * 100
      : null;

  const chartData = useMemo<ChartPoint[]>(() => {
    const months = Array.from({ length: 12 }, (_, index) => {
      const date = subMonths(new Date(), 11 - index);
      return {
        key: format(date, "yyyy-MM"),
        month: format(date, "MMM", { locale: ptBR }),
      };
    });

    const byMonth = new Map<
      string,
      Map<string, InvestmentSnapshot>
    >();

    snapshots.forEach((snapshot) => {
      const key = monthKey(snapshot.snapshot_date);
      const accountMap = byMonth.get(key) ?? new Map();
      accountMap.set(snapshot.account_id, snapshot);
      byMonth.set(key, accountMap);
    });

    const latestByAccount = new Map<string, InvestmentSnapshot>();

    return months.map(({ key, month }) => {
      const currentMonth = byMonth.get(key);

      if (currentMonth) {
        currentMonth.forEach((snapshot, accountId) => {
          latestByAccount.set(accountId, snapshot);
        });
      }

      const aggregate = Array.from(latestByAccount.values()).reduce(
        (summary, snapshot) => {
          summary.value += Number(snapshot.market_value || 0);
          summary.invested += Number(snapshot.cost_basis || 0);
          return summary;
        },
        { value: 0, invested: 0 },
      );

      return {
        month,
        value: aggregate.value,
        invested: aggregate.invested,
      };
    });
  }, [snapshots]);

  if (loading) {
    return (
      <article className="flex h-full min-h-[500px] items-center justify-center rounded-2xl border border-[#0D1B2A]/10 bg-white shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
      </article>
    );
  }

  return (
    <article className="flex h-full min-h-[500px] flex-col rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[#0D1B2A]">
            Investimentos
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#3A3A3C]/60">
            Patrimônio investido, aportes e retorno estimado.
          </p>
        </div>
        <PiggyBank
          size={20}
          className="shrink-0 text-[#C8A15A]"
        />
      </div>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Não foi possível carregar seus investimentos.
        </div>
      ) : positions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <TrendingUp size={22} />
          </div>
          <h3 className="mt-4 font-semibold text-[#0D1B2A]">
            Nenhum investimento cadastrado
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#3A3A3C]/60">
            Cadastre uma conta do tipo investimento. Aportes, resgates e evolução passarão a aparecer aqui.
          </p>
          <Link
            href="/contas"
            className="mt-4 text-sm font-semibold text-[#0D1B2A] hover:underline"
          >
            Ir para contas
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard
              label="Patrimônio atual"
              value={formatCurrency(totals.currentValue)}
              tone="default"
            />
            <SummaryCard
              label="Capital investido"
              value={formatCurrency(totals.costBasis)}
              tone="gold"
            />
            <SummaryCard
              label="Retorno estimado"
              value={
                totals.hasReturnBasis
                  ? formatCurrency(totals.estimatedReturn)
                  : "Base não informada"
              }
              detail={
                returnPercentage === null
                  ? undefined
                  : `${returnPercentage >= 0 ? "+" : ""}${returnPercentage.toFixed(2)}%`
              }
              tone={
                totals.estimatedReturn >= 0
                  ? "positive"
                  : "negative"
              }
            />
          </div>

          <div className="mt-5 h-56 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#E5E7EB"
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#6B7280", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#6B7280", fontSize: 11 }}
                  tickFormatter={formatCompactCurrency}
                />
                <RechartsTooltip
                  formatter={(value, name) => [
                    formatCurrency(Number(value ?? 0)),
                    name === "value"
                      ? "Patrimônio"
                      : "Capital investido",
                  ]}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #E5E7EB",
                    boxShadow: "0 8px 30px rgba(13,27,42,.08)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="invested"
                  stroke="#C8A15A"
                  fill="#C8A15A"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#047857"
                  fill="#047857"
                  fillOpacity={0.16}
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {positions.slice(0, 4).map((position) => {
              const estimatedReturn =
                position.estimated_return === null
                  ? null
                  : Number(position.estimated_return || 0);

              return (
                <div
                  key={position.id}
                  className="rounded-xl border border-[#0D1B2A]/8 bg-[#F7F5EF] px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Landmark
                          size={14}
                          className="shrink-0 text-[#C8A15A]"
                        />
                        <p className="truncate text-sm font-semibold text-[#0D1B2A]">
                          {position.name}
                        </p>
                      </div>
                      <p className="mt-1 truncate text-xs text-[#3A3A3C]/50">
                        {position.institution_name ??
                          position.investment_asset_type ??
                          "Investimento"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-[#0D1B2A]">
                        {formatCurrency(position.current_value)}
                      </p>
                      {estimatedReturn !== null && (
                        <p
                          className={[
                            "mt-1 inline-flex items-center gap-1 text-xs font-semibold",
                            estimatedReturn >= 0
                              ? "text-emerald-700"
                              : "text-red-700",
                          ].join(" ")}
                        >
                          {estimatedReturn >= 0 ? (
                            <ArrowUpRight size={12} />
                          ) : (
                            <ArrowDownRight size={12} />
                          )}
                          {formatCurrency(estimatedReturn)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: "default" | "gold" | "positive" | "negative";
}) {
  const valueClass = {
    default: "text-[#0D1B2A]",
    gold: "text-[#8A641F]",
    positive: "text-emerald-700",
    negative: "text-red-700",
  }[tone];

  return (
    <div className="rounded-xl border border-[#0D1B2A]/8 bg-[#F7F5EF] p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3A3A3C]/45">
        {label}
      </p>
      <p className={["mt-2 text-base font-semibold", valueClass].join(" ")}>
        {value}
      </p>
      {detail && (
        <p className={["mt-1 text-xs font-semibold", valueClass].join(" ")}>
          {detail}
        </p>
      )}
    </div>
  );
}
