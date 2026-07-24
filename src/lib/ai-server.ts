import type {
  SupabaseClient,
} from "@supabase/supabase-js";

export type AiRuntimeSettings = {
  provider: "openrouter";
  model: string;
  monthlyBudgetUsd: number;
  isEnabled: boolean;
};

export type AiUsageInput = {
  householdId: string;
  userId: string;

  provider?: string;
  providerName?: string | null;

  model: string;
  requestKind?: string;
  status?: "success" | "failed";

  generationId?: string | null;

  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;

  costUsd?: number;

  errorMessage?: string | null;
};

export async function getAiRuntimeSettings(
  supabase: SupabaseClient,
  householdId: string,
): Promise<AiRuntimeSettings> {
  const {
    data,
    error,
  } = await supabase
    .from("pf_ai_settings")
    .select(
      "provider, model, monthly_budget_usd, is_enabled",
    )
    .eq(
      "household_id",
      householdId,
    )
    .maybeSingle();

  if (error) {
    console.error(
      "Erro ao carregar configurações de IA:",
      error,
    );
  }

  return {
    provider:
      "openrouter",

    model:
      data?.model?.trim() ||
      process.env.OPENROUTER_MODEL?.trim() ||
      "openrouter/free",

    monthlyBudgetUsd:
      Number(
        data?.monthly_budget_usd ??
          0,
      ),

    isEnabled:
      data?.is_enabled ??
      true,
  };
}


export async function assertAiUsageAllowed(
  supabase: SupabaseClient,
  householdId: string,
  settings: AiRuntimeSettings,
) {
  if (!settings.isEnabled) {
    throw new Error(
      "O assistente de IA está desativado nas configurações.",
    );
  }

  if (
    settings.monthlyBudgetUsd <= 0
  ) {
    return;
  }

  const now =
    new Date();

  const monthStart =
    new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1,
      ),
    ).toISOString();

  const {
    data,
    error,
  } = await supabase
    .from("pf_ai_usage")
    .select("cost_usd")
    .eq(
      "household_id",
      householdId,
    )
    .gte(
      "created_at",
      monthStart,
    );

  if (error) {
    console.error(
      "Erro ao verificar orçamento de IA:",
      error,
    );

    return;
  }

  const monthCost =
    (data ?? []).reduce(
      (
        total,
        row,
      ) =>
        total +
        Number(
          row.cost_usd ??
            0,
        ),
      0,
    );

  if (
    monthCost >=
    settings.monthlyBudgetUsd
  ) {
    throw new Error(
      "O limite mensal de IA foi atingido.",
    );
  }
}

export async function recordAiUsage(
  supabase: SupabaseClient,
  input: AiUsageInput,
) {
  const {
    error,
  } = await supabase
    .from("pf_ai_usage")
    .insert({
      household_id:
        input.householdId,

      created_by:
        input.userId,

      provider:
        input.provider ??
        "openrouter",

      provider_name:
        input.providerName ??
        null,

      model:
        input.model,

      request_kind:
        input.requestKind ??
        "chat",

      status:
        input.status ??
        "success",

      generation_id:
        input.generationId ??
        null,

      prompt_tokens:
        Math.max(
          0,
          Math.trunc(
            input.promptTokens ??
              0,
          ),
        ),

      completion_tokens:
        Math.max(
          0,
          Math.trunc(
            input.completionTokens ??
              0,
          ),
        ),

      total_tokens:
        Math.max(
          0,
          Math.trunc(
            input.totalTokens ??
              0,
          ),
        ),

      reasoning_tokens:
        Math.max(
          0,
          Math.trunc(
            input.reasoningTokens ??
              0,
          ),
        ),

      cached_tokens:
        Math.max(
          0,
          Math.trunc(
            input.cachedTokens ??
              0,
          ),
        ),

      cost_usd:
        Math.max(
          0,
          Number(
            input.costUsd ??
              0,
          ),
        ),

      error_message:
        input.errorMessage ??
        null,
    });

  if (error) {
    console.error(
      "Erro ao registrar consumo de IA:",
      error,
    );
  }
}
