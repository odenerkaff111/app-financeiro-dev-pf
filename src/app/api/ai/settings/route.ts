import {
  createClient,
} from "@supabase/supabase-js";
import {
  NextResponse,
} from "next/server";

type SettingsBody = {
  householdId?: string;
  model?: string;
  monthlyBudgetUsd?: number;
  isEnabled?: boolean;
};

type OpenRouterKeyResponse = {
  data?: {
    label?: string | null;
    is_free_tier?: boolean;
    limit?: number | null;
    limit_remaining?: number | null;
    limit_reset?: string | null;
    usage?: number;
    usage_daily?: number;
    usage_weekly?: number;
    usage_monthly?: number;
  };
};

function getAccessToken(
  request: Request,
) {
  const authorization =
    request.headers.get(
      "authorization",
    );

  if (
    !authorization?.startsWith(
      "Bearer ",
    )
  ) {
    return null;
  }

  return authorization
    .slice(7)
    .trim();
}

function createAuthorizedSupabase(
  accessToken: string,
) {
  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL
      ?.trim();

  const supabaseKey = (
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env
      .NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (
    !supabaseUrl ||
    !supabaseKey
  ) {
    throw new Error(
      "Supabase não configurado.",
    );
  }

  return createClient(
    supabaseUrl,
    supabaseKey,
    {
      global: {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
      },

      auth: {
        autoRefreshToken:
          false,

        persistSession:
          false,
      },
    },
  );
}

async function validateMembership(
  supabase:
    ReturnType<
      typeof createAuthorizedSupabase
    >,
  householdId: string,
  userId: string,
) {
  const {
    data,
    error,
  } = await supabase
    .from(
      "pf_household_members",
    )
    .select(
      "household_id",
    )
    .eq(
      "household_id",
      householdId,
    )
    .eq(
      "user_id",
      userId,
    )
    .maybeSingle();

  if (
    error ||
    !data
  ) {
    throw new Error(
      "Você não possui acesso a este grupo familiar.",
    );
  }
}

async function getSafeKeyInfo() {
  const apiKey =
    process.env
      .OPENROUTER_API_KEY
      ?.trim();

  if (!apiKey) {
    return {
      configured:
        false,

      suffix:
        null,

      key:
        null,
    };
  }

  const suffix =
    apiKey.slice(-4);

  try {
    const response =
      await fetch(
        "https://openrouter.ai/api/v1/key",
        {
          headers: {
            Authorization:
              `Bearer ${apiKey}`,
          },

          cache:
            "no-store",
        },
      );

    if (!response.ok) {
      return {
        configured:
          true,

        suffix,

        key:
          null,
      };
    }

    const body =
      (await response.json()) as
        OpenRouterKeyResponse;

    return {
      configured:
        true,

      suffix,

      key: {
        label:
          body.data?.label ??
          null,

        isFreeTier:
          Boolean(
            body.data
              ?.is_free_tier,
          ),

        limit:
          body.data?.limit ??
          null,

        limitRemaining:
          body.data
            ?.limit_remaining ??
          null,

        limitReset:
          body.data
            ?.limit_reset ??
          null,

        usage:
          Number(
            body.data?.usage ??
              0,
          ),

        usageDaily:
          Number(
            body.data
              ?.usage_daily ??
              0,
          ),

        usageWeekly:
          Number(
            body.data
              ?.usage_weekly ??
              0,
          ),

        usageMonthly:
          Number(
            body.data
              ?.usage_monthly ??
              0,
          ),
      },
    };
  } catch (error) {
    console.error(
      "Erro ao consultar chave OpenRouter:",
      error,
    );

    return {
      configured:
        true,

      suffix,

      key:
        null,
    };
  }
}

export async function GET(
  request: Request,
) {
  try {
    const accessToken =
      getAccessToken(
        request,
      );

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Sessão não informada.",
        },
        {
          status:
            401,
        },
      );
    }

    const url =
      new URL(
        request.url,
      );

    const householdId =
      url.searchParams.get(
        "householdId",
      );

    if (!householdId) {
      return NextResponse.json(
        {
          error:
            "Grupo familiar não informado.",
        },
        {
          status:
            400,
        },
      );
    }

    const supabase =
      createAuthorizedSupabase(
        accessToken,
      );

    const {
      data:
        userResult,
      error:
        userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !userResult.user
    ) {
      return NextResponse.json(
        {
          error:
            "Sua sessão expirou.",
        },
        {
          status:
            401,
        },
      );
    }

    await validateMembership(
      supabase,
      householdId,
      userResult.user.id,
    );

    const [
      settingsResult,
      keyInfo,
    ] =
      await Promise.all([
        supabase
          .from(
            "pf_ai_settings",
          )
          .select(
            "provider, model, monthly_budget_usd, is_enabled, updated_at",
          )
          .eq(
            "household_id",
            householdId,
          )
          .maybeSingle(),

        getSafeKeyInfo(),
      ]);

    if (
      settingsResult.error
    ) {
      throw settingsResult.error;
    }

    const settings =
      settingsResult.data;

    return NextResponse.json({
      provider:
        settings?.provider ??
        "openrouter",

      model:
        settings?.model ??
        process.env
          .OPENROUTER_MODEL ??
        "openrouter/free",

      monthlyBudgetUsd:
        Number(
          settings
            ?.monthly_budget_usd ??
            0,
        ),

      isEnabled:
        settings
          ?.is_enabled ??
        true,

      updatedAt:
        settings
          ?.updated_at ??
        null,

      keyInfo,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar configurações de IA.",
      },
      {
        status:
          400,
      },
    );
  }
}

export async function PUT(
  request: Request,
) {
  try {
    const accessToken =
      getAccessToken(
        request,
      );

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Sessão não informada.",
        },
        {
          status:
            401,
        },
      );
    }

    const body =
      (await request.json()) as
        SettingsBody;

    const householdId =
      body.householdId?.trim();

    const model =
      body.model?.trim();

    if (!householdId) {
      throw new Error(
        "Grupo familiar não informado.",
      );
    }

    if (!model) {
      throw new Error(
        "Informe o modelo.",
      );
    }

    const monthlyBudgetUsd =
      Number(
        body.monthlyBudgetUsd ??
          0,
      );

    if (
      !Number.isFinite(
        monthlyBudgetUsd,
      ) ||
      monthlyBudgetUsd < 0
    ) {
      throw new Error(
        "O limite mensal é inválido.",
      );
    }

    const supabase =
      createAuthorizedSupabase(
        accessToken,
      );

    const {
      data:
        userResult,
      error:
        userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !userResult.user
    ) {
      throw new Error(
        "Sua sessão expirou.",
      );
    }

    await validateMembership(
      supabase,
      householdId,
      userResult.user.id,
    );

    const {
      data,
      error,
    } = await supabase
      .from(
        "pf_ai_settings",
      )
      .upsert(
        {
          household_id:
            householdId,

          created_by:
            userResult.user.id,

          provider:
            "openrouter",

          model,

          monthly_budget_usd:
            monthlyBudgetUsd,

          is_enabled:
            body.isEnabled ??
            true,

          updated_at:
            new Date()
              .toISOString(),
        },
        {
          onConflict:
            "household_id",
        },
      )
      .select(
        "provider, model, monthly_budget_usd, is_enabled, updated_at",
      )
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success:
        true,

      settings:
        data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao salvar configurações de IA.",
      },
      {
        status:
          400,
      },
    );
  }
}
