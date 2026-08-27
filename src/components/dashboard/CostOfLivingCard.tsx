"use client";

import {
  Home,
  Loader2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type CostSummary = {
  observed_months: number | string;
  average_monthly_cost: number | string;
};

function formatCurrency(value: number | string | null) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function CostOfLivingCard() {
  const { household } = useHousehold();
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);

    const result = await supabase
      .from("pf_cost_of_living_summary")
      .select("observed_months, average_monthly_cost")
      .eq("household_id", household.id)
      .maybeSingle();

    if (result.error) {
      setError(true);
      setLoading(false);
      return;
    }

    setSummary((result.data ?? null) as CostSummary | null);
    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const observedMonths = Number(summary?.observed_months ?? 0);

  return (
    <article className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#3A3A3C]/65">
          Custo de vida médio
        </p>
        {loading ? (
          <Loader2 className="h-[19px] w-[19px] animate-spin text-[#C8A15A]" />
        ) : (
          <Home size={19} className="text-[#C8A15A]" />
        )}
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-tight text-[#0D1B2A]">
        {error
          ? "Indisponível"
          : formatCurrency(summary?.average_monthly_cost ?? 0)}
      </p>

      <p className="mt-2 text-xs font-medium text-[#3A3A3C]/50">
        {error
          ? "Não foi possível calcular agora."
          : observedMonths > 0
            ? `Média das despesas marcadas como essenciais em ${observedMonths} ${
                observedMonths === 1 ? "mês" : "meses"
              } com dados.`
            : "Marque contas ou despesas como essenciais para formar a média."}
      </p>
    </article>
  );
}
