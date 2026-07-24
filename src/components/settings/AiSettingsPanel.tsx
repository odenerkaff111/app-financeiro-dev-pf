"use client";

import {
  Activity,
  BadgeDollarSign,
  BrainCircuit,
  CheckCircle2,
  CircleGauge,
  KeyRound,
  Loader2,
  Save,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useHousehold,
} from "@/contexts/HouseholdContext";
import {
  supabase,
} from "@/lib/supabase";

type SettingsResponse = {
  provider: string;
  model: string;
  monthlyBudgetUsd: number;
  isEnabled: boolean;

  keyInfo: {
    configured: boolean;
    suffix: string | null;

    key: {
      label: string | null;
      isFreeTier: boolean;
      limit: number | null;
      limitRemaining: number | null;
      limitReset: string | null;
      usage: number;
      usageDaily: number;
      usageWeekly: number;
      usageMonthly: number;
    } | null;
  };
};

type UsageResponse = {
  summary: {
    calls: number;
    successfulCalls: number;
    failedCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    costUsd: number;
  };

  recent: Array<{
    model: string;
    provider_name: string | null;
    request_kind: string;
    status: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
    created_at: string;
  }>;
};

const MODEL_OPTIONS = [
  {
    value:
      "openrouter/free",

    label:
      "Roteador gratuito",
  },
  {
    value:
      "openrouter/auto",

    label:
      "Roteador automático pago",
  },
];

function formatUsd(
  value: number,
) {
  return new Intl.NumberFormat(
    "pt-BR",
    {
      style:
        "currency",

      currency:
        "USD",

      minimumFractionDigits:
        value < 0.01
          ? 4
          : 2,

      maximumFractionDigits:
        value < 0.01
          ? 6
          : 2,
    },
  ).format(
    Number.isFinite(value)
      ? value
      : 0,
  );
}

function formatNumber(
  value: number,
) {
  return new Intl.NumberFormat(
    "pt-BR",
  ).format(
    Number.isFinite(value)
      ? value
      : 0,
  );
}

export function AiSettingsPanel() {
  const {
    household,
  } = useHousehold();

  const [
    settings,
    setSettings,
  ] = useState<
    SettingsResponse | null
  >(null);

  const [
    usage,
    setUsage,
  ] = useState<
    UsageResponse | null
  >(null);

  const [
    model,
    setModel,
  ] = useState(
    "openrouter/free",
  );

  const [
    customModel,
    setCustomModel,
  ] = useState("");

  const [
    monthlyBudgetUsd,
    setMonthlyBudgetUsd,
  ] = useState("0");

  const [
    isEnabled,
    setIsEnabled,
  ] = useState(true);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const [
    success,
    setSuccess,
  ] = useState<
    string | null
  >(null);

  async function getAccessToken() {
    const {
      data,
    } =
      await supabase.auth.getSession();

    const accessToken =
      data.session
        ?.access_token;

    if (!accessToken) {
      throw new Error(
        "Sua sessão expirou.",
      );
    }

    return accessToken;
  }

  const loadData =
    useCallback(
      async () => {
        setLoading(true);
        setError(null);

        try {
          const accessToken =
            await getAccessToken();

          const query =
            new URLSearchParams({
              householdId:
                household.id,
            });

          const [
            settingsResponse,
            usageResponse,
          ] =
            await Promise.all([
              fetch(
                `/api/ai/settings?${query.toString()}`,
                {
                  headers: {
                    Authorization:
                      `Bearer ${accessToken}`,
                  },
                },
              ),

              fetch(
                `/api/ai/usage?${query.toString()}`,
                {
                  headers: {
                    Authorization:
                      `Bearer ${accessToken}`,
                  },
                },
              ),
            ]);

          const settingsBody =
            (await settingsResponse.json()) as
              SettingsResponse & {
                error?: string;
              };

          const usageBody =
            (await usageResponse.json()) as
              UsageResponse & {
                error?: string;
              };

          if (!settingsResponse.ok) {
            throw new Error(
              settingsBody.error ||
                "Erro ao carregar configurações.",
            );
          }

          if (!usageResponse.ok) {
            throw new Error(
              usageBody.error ||
                "Erro ao carregar consumo.",
            );
          }

          setSettings(
            settingsBody,
          );

          setUsage(
            usageBody,
          );

          const knownModel =
            MODEL_OPTIONS.some(
              (option) =>
                option.value ===
                settingsBody.model,
            );

          setModel(
            knownModel
              ? settingsBody.model
              : "custom",
          );

          setCustomModel(
            knownModel
              ? ""
              : settingsBody.model,
          );

          setMonthlyBudgetUsd(
            String(
              settingsBody.monthlyBudgetUsd ??
                0,
            ),
          );

          setIsEnabled(
            settingsBody.isEnabled,
          );
        } catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Erro ao carregar configurações.",
          );
        } finally {
          setLoading(false);
        }
      },
      [household.id],
    );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedModel =
    useMemo(
      () =>
        model === "custom"
          ? customModel.trim()
          : model,
      [
        customModel,
        model,
      ],
    );

  const budget =
    Number(
      monthlyBudgetUsd ||
        0,
    );

  const cost =
    usage?.summary
      .costUsd ??
    0;

  const budgetPercentage =
    budget > 0
      ? Math.min(
          100,
          (
            cost /
            budget
          ) * 100,
        )
      : 0;

  async function saveSettings() {
    if (!selectedModel) {
      setError(
        "Informe o modelo.",
      );
      return;
    }

    if (
      !Number.isFinite(
        budget,
      ) ||
      budget < 0
    ) {
      setError(
        "Informe um limite mensal válido.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const accessToken =
        await getAccessToken();

      const response =
        await fetch(
          "/api/ai/settings",
          {
            method:
              "PUT",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                householdId:
                  household.id,

                model:
                  selectedModel,

                monthlyBudgetUsd:
                  budget,

                isEnabled,
              }),
          },
        );

      const body =
        (await response.json()) as {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Erro ao salvar configurações.",
        );
      }

      setSuccess(
        "Configurações de IA salvas.",
      );

      await loadData();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Erro ao salvar configurações.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#C8A15A]" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#C8A15A]">
          Configurações
        </p>

        <h1 className="mt-2 text-3xl font-semibold text-[#0D1B2A]">
          Inteligência Artificial
        </h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#3A3A3C]/65">
          Controle o modelo usado pelo assistente e acompanhe o consumo deste aplicativo.
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Chamadas no mês"
          value={formatNumber(
            usage?.summary
              .calls ??
              0,
          )}
          icon={Activity}
        />

        <MetricCard
          label="Tokens no mês"
          value={formatNumber(
            usage?.summary
              .totalTokens ??
              0,
          )}
          icon={CircleGauge}
        />

        <MetricCard
          label="Custo do app"
          value={formatUsd(
            cost,
          )}
          icon={BadgeDollarSign}
        />

        <MetricCard
          label="Chave"
          value={
            settings?.keyInfo
              .configured
              ? `Configurada ···${settings.keyInfo.suffix}`
              : "Não configurada"
          }
          icon={
            settings?.keyInfo
              .configured
              ? ShieldCheck
              : KeyRound
          }
          positive={
            settings?.keyInfo
              .configured
          }
        />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <article className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0D1B2A] text-[#C8A15A]">
              <BrainCircuit
                size={19}
              />
            </div>

            <div>
              <h2 className="font-semibold text-[#0D1B2A]">
                Modelo do assistente
              </h2>

              <p className="text-xs text-[#3A3A3C]/55">
                Provedor ativo: OpenRouter
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-[#0D1B2A]">
                Modelo
              </span>

              <select
                value={model}
                onChange={(event) =>
                  setModel(
                    event.target.value,
                  )
                }
                className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
              >
                {MODEL_OPTIONS.map(
                  (option) => (
                    <option
                      key={
                        option.value
                      }
                      value={
                        option.value
                      }
                    >
                      {
                        option.label
                      }
                    </option>
                  ),
                )}

                <option value="custom">
                  Modelo personalizado
                </option>
              </select>
            </label>

            {model ===
              "custom" && (
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[#0D1B2A]">
                  Slug do modelo
                </span>

                <input
                  value={
                    customModel
                  }
                  onChange={(event) =>
                    setCustomModel(
                      event.target.value,
                    )
                  }
                  placeholder="ex.: google/gemini-2.5-flash"
                  className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
                />
              </label>
            )}

            <label className="block space-y-2">
              <span className="text-sm font-medium text-[#0D1B2A]">
                Limite mensal do aplicativo em USD
              </span>

              <input
                type="number"
                min="0"
                step="0.01"
                value={
                  monthlyBudgetUsd
                }
                onChange={(event) =>
                  setMonthlyBudgetUsd(
                    event.target.value,
                  )
                }
                className="h-11 w-full rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-sm outline-none focus:border-[#C8A15A]"
              />

              <span className="block text-xs leading-5 text-[#3A3A3C]/50">
                Use 0 para apenas acompanhar, sem definir orçamento.
              </span>
            </label>

            <label className="flex items-center justify-between rounded-xl border border-[#0D1B2A]/10 bg-[#F7F5EF] p-4">
              <div>
                <p className="text-sm font-medium text-[#0D1B2A]">
                  Assistente habilitado
                </p>

                <p className="mt-1 text-xs text-[#3A3A3C]/50">
                  Desative para bloquear novas chamadas de IA.
                </p>
              </div>

              <input
                type="checkbox"
                checked={
                  isEnabled
                }
                onChange={(event) =>
                  setIsEnabled(
                    event.target.checked,
                  )
                }
                className="h-5 w-5 accent-[#0D1B2A]"
              />
            </label>

            <button
              type="button"
              onClick={() =>
                void saveSettings()
              }
              disabled={saving}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0D1B2A] px-5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save
                  size={16}
                />
              )}

              Salvar configurações
            </button>
          </div>
        </article>

        <article className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-[#0D1B2A]">
            Consumo
          </h2>

          <div className="mt-5 space-y-4">
            <UsageRow
              label="Tokens de entrada"
              value={formatNumber(
                usage?.summary
                  .promptTokens ??
                  0,
              )}
            />

            <UsageRow
              label="Tokens de saída"
              value={formatNumber(
                usage?.summary
                  .completionTokens ??
                  0,
              )}
            />

            <UsageRow
              label="Tokens de raciocínio"
              value={formatNumber(
                usage?.summary
                  .reasoningTokens ??
                  0,
              )}
            />

            <UsageRow
              label="Chamadas com erro"
              value={formatNumber(
                usage?.summary
                  .failedCalls ??
                  0,
              )}
            />

            <UsageRow
              label="Uso mensal da chave"
              value={formatUsd(
                settings?.keyInfo
                  .key
                  ?.usageMonthly ??
                  0,
              )}
            />
          </div>

          {budget > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#3A3A3C]/55">
                  Orçamento usado
                </span>

                <span className="font-semibold text-[#0D1B2A]">
                  {budgetPercentage.toFixed(
                    1,
                  )}
                  %
                </span>
              </div>

              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#0D1B2A]/8">
                <div
                  className={[
                    "h-full rounded-full",
                    budgetPercentage >=
                    90
                      ? "bg-red-600"
                      : "bg-[#C8A15A]",
                  ].join(" ")}
                  style={{
                    width:
                      `${budgetPercentage}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2">
              <TriangleAlert
                size={17}
                className="mt-0.5 shrink-0 text-amber-700"
              />

              <p className="text-xs leading-5 text-amber-800">
                A chave permanece no servidor. Esta tela mostra apenas se ela está configurada e os quatro últimos caracteres.
              </p>
            </div>
          </div>
        </article>
      </section>

      <p className="text-[11px] leading-5 text-[#3A3A3C]/45">
        O histórico local começa a contar depois da instalação desta etapa. O uso da chave exibido pelo OpenRouter pode incluir outras aplicações que utilizem a mesma chave.
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  positive = false,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  positive?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-[#0D1B2A]/10 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#3A3A3C]/55">
          {label}
        </p>

        <Icon
          size={17}
          className={
            positive
              ? "text-emerald-700"
              : "text-[#C8A15A]"
          }
        />
      </div>

      <p className="mt-3 truncate text-lg font-semibold text-[#0D1B2A]">
        {value}
      </p>
    </article>
  );
}

function UsageRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#0D1B2A]/8 pb-3 text-sm last:border-0 last:pb-0">
      <span className="text-[#3A3A3C]/60">
        {label}
      </span>

      <span className="font-semibold text-[#0D1B2A]">
        {value}
      </span>
    </div>
  );
}
