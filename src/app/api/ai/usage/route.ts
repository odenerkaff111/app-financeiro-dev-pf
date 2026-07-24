import {
  createClient,
} from "@supabase/supabase-js";
import {
  NextResponse,
} from "next/server";

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
      throw new Error(
        "Grupo familiar não informado.",
      );
    }

    const supabase =
      createAuthorizedSupabase(
        accessToken,
      );

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
      .from(
        "pf_ai_usage",
      )
      .select(
        "provider, provider_name, model, request_kind, status, prompt_tokens, completion_tokens, total_tokens, reasoning_tokens, cached_tokens, cost_usd, created_at",
      )
      .eq(
        "household_id",
        householdId,
      )
      .gte(
        "created_at",
        monthStart,
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        },
      );

    if (error) {
      throw error;
    }

    const rows =
      data ?? [];

    const summary =
      rows.reduce(
        (
          total,
          row,
        ) => ({
          calls:
            total.calls +
            1,

          successfulCalls:
            total.successfulCalls +
            (
              row.status ===
              "success"
                ? 1
                : 0
            ),

          failedCalls:
            total.failedCalls +
            (
              row.status ===
              "failed"
                ? 1
                : 0
            ),

          promptTokens:
            total.promptTokens +
            Number(
              row.prompt_tokens ??
                0,
            ),

          completionTokens:
            total.completionTokens +
            Number(
              row.completion_tokens ??
                0,
            ),

          totalTokens:
            total.totalTokens +
            Number(
              row.total_tokens ??
                0,
            ),

          reasoningTokens:
            total.reasoningTokens +
            Number(
              row.reasoning_tokens ??
                0,
            ),

          cachedTokens:
            total.cachedTokens +
            Number(
              row.cached_tokens ??
                0,
            ),

          costUsd:
            total.costUsd +
            Number(
              row.cost_usd ??
                0,
            ),
        }),
        {
          calls:
            0,

          successfulCalls:
            0,

          failedCalls:
            0,

          promptTokens:
            0,

          completionTokens:
            0,

          totalTokens:
            0,

          reasoningTokens:
            0,

          cachedTokens:
            0,

          costUsd:
            0,
        },
      );

    return NextResponse.json({
      monthStart,
      summary,

      recent:
        rows.slice(
          0,
          20,
        ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao carregar consumo de IA.",
      },
      {
        status:
          400,
      },
    );
  }
}
