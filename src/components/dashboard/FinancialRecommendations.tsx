"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/contexts/HouseholdContext";

type Recommendation = {
  id: string;
  priority: "low" | "medium" | "high" | "critical";
  title: string;
  recommendation: string;
  rationale: string | null;
  source: "deterministic" | "ai";
  model: string | null;
  expires_at: string;
  created_at: string;
};

function priorityClasses(priority: Recommendation["priority"]) {
  if (priority === "critical") {
    return {
      panel: "border-red-200 bg-red-50",
      icon: "bg-red-100 text-red-700",
      badge: "bg-red-100 text-red-700",
    };
  }

  if (priority === "high") {
    return {
      panel: "border-amber-200 bg-amber-50",
      icon: "bg-amber-100 text-amber-700",
      badge: "bg-amber-100 text-amber-700",
    };
  }

  if (priority === "medium") {
    return {
      panel: "border-blue-200 bg-blue-50",
      icon: "bg-blue-100 text-blue-700",
      badge: "bg-blue-100 text-blue-700",
    };
  }

  return {
    panel: "border-emerald-200 bg-emerald-50",
    icon: "bg-emerald-100 text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
  };
}

function priorityLabel(priority: Recommendation["priority"]) {
  return {
    low: "Acompanhamento",
    medium: "Atenção",
    high: "Prioridade",
    critical: "Crítico",
  }[priority];
}

export function FinancialRecommendations() {
  const { household } = useHousehold();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const accessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      throw new Error("Sua sessão expirou. Entre novamente.");
    }

    return token;
  }, []);

  const requestRecommendations = useCallback(
    async (force = false) => {
      if (force) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const token = await accessToken();

        let response = await fetch(
          `/api/assistant/recommendations?householdId=${encodeURIComponent(
            household.id,
          )}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        let body = (await response.json()) as {
          recommendations?: Recommendation[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            body.error || "Não foi possível carregar as recomendações.",
          );
        }

        if (force || !body.recommendations?.length) {
          response = await fetch("/api/assistant/recommendations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              householdId: household.id,
              force,
            }),
          });

          body = (await response.json()) as {
            recommendations?: Recommendation[];
            error?: string;
          };

          if (!response.ok) {
            throw new Error(
              body.error || "Não foi possível gerar recomendações.",
            );
          }
        }

        setRecommendations(body.recommendations ?? []);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível carregar as recomendações.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken, household.id],
  );

  useEffect(() => {
    void requestRecommendations(false);

    const intervalId = window.setInterval(() => {
      void requestRecommendations(false);
    }, 15 * 60 * 1000);

    function handleFinancialChange() {
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
      }

      refreshTimer.current = window.setTimeout(() => {
        void requestRecommendations(true);
      }, 1200);
    }

    window.addEventListener(
      "pf:financial-data-changed",
      handleFinancialChange,
    );

    return () => {
      window.clearInterval(intervalId);
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
      }
      window.removeEventListener(
        "pf:financial-data-changed",
        handleFinancialChange,
      );
    };
  }, [requestRecommendations]);

  return (
    <section className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0D1B2A] text-[#F7F5EF]">
            <Bot size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-[#0D1B2A]">
                Recomendações da Kyra
              </h2>
              <Sparkles size={15} className="text-[#C8A15A]" />
            </div>
            <p className="mt-1 text-sm leading-6 text-[#3A3A3C]/60">
              O motor calcula os fatos. A IA prioriza e explica as próximas decisões.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void requestRecommendations(true)}
          disabled={refreshing || loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#0D1B2A]/12 px-4 text-sm font-semibold text-[#0D1B2A] transition hover:bg-[#F7F5EF] disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          Atualizar análise
        </button>
      </div>

      {loading ? (
        <div className="flex min-h-36 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
        </div>
      ) : error ? (
        <div className="mt-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : recommendations.length === 0 ? (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
          <CheckCircle2 size={19} className="shrink-0" />
          Nenhuma recomendação urgente foi encontrada agora.
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {recommendations.map((item) => {
            const classes = priorityClasses(item.priority);

            return (
              <article
                key={item.id}
                className={[
                  "rounded-2xl border p-4",
                  classes.panel,
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={[
                        "inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
                        classes.badge,
                      ].join(" ")}
                    >
                      {priorityLabel(item.priority)}
                    </span>
                    <h3 className="mt-3 font-semibold text-[#0D1B2A]">
                      {item.title}
                    </h3>
                  </div>
                  <div
                    className={[
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                      classes.icon,
                    ].join(" ")}
                  >
                    <Sparkles size={15} />
                  </div>
                </div>

                <p className="mt-3 text-sm leading-6 text-[#0D1B2A]/80">
                  {item.recommendation}
                </p>

                {item.rationale && (
                  <p className="mt-3 border-t border-current/10 pt-3 text-xs leading-5 text-[#3A3A3C]/55">
                    {item.rationale}
                  </p>
                )}

                <p className="mt-3 text-[10px] uppercase tracking-wider text-[#3A3A3C]/35">
                  {item.source === "ai"
                    ? "Explicação gerada pela IA"
                    : "Recomendação do motor financeiro"}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
