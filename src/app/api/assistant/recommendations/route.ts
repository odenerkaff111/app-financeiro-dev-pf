import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  assertAiUsageAllowed,
  getAiRuntimeSettings,
  recordAiUsage,
} from "@/lib/ai-server";

type Priority = "low" | "medium" | "high" | "critical";

type Recommendation = {
  priority: Priority;
  title: string;
  recommendation: string;
  rationale: string;
};

type OpenRouterResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    reasoning_tokens?: number;
    cached_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

function tokenFrom(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ")
    ? value.slice(7).trim()
    : null;
}

function authorizedClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!url || !key) {
    throw new Error("Supabase não configurado.");
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function toNumber(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function deterministicRecommendations(snapshot: {
  available: number;
  income30d: number;
  expense30d: number;
  payable: number;
  receivable: number;
  overdue: number;
  debtBalance: number;
  debtDailyGrowth: number;
  investmentValue: number;
  costOfLiving: number;
}) {
  const items: Recommendation[] = [];

  if (snapshot.overdue > 0) {
    items.push({
      priority: "critical",
      title: "Trate primeiro o que já venceu",
      recommendation: `Existem ${formatCurrency(snapshot.overdue)} em obrigações vencidas. Abra Próximas obrigações e organize um pagamento integral ou parcial hoje.`,
      rationale:
        "Contas vencidas tendem a gerar multa, juros e perda de previsibilidade.",
    });
  }

  if (snapshot.debtDailyGrowth > 0) {
    items.push({
      priority: "high",
      title: "Interrompa o crescimento diário das dívidas",
      recommendation: `Suas dívidas crescem aproximadamente ${formatCurrency(snapshot.debtDailyGrowth)} por dia. Priorize a obrigação com maior crescimento antes de antecipar dívidas sem juros.`,
      rationale:
        "A recomendação usa a taxa e o saldo projetado registrados no motor financeiro.",
    });
  }

  const resources = snapshot.available + snapshot.receivable;

  if (snapshot.payable > resources) {
    items.push({
      priority: "high",
      title: "As saídas previstas superam os recursos mapeados",
      recommendation: `Faltam aproximadamente ${formatCurrency(snapshot.payable - resources)} para cobrir as obrigações abertas, mesmo considerando os valores a receber. Renegocie datas ou reduza despesas não essenciais.`,
      rationale:
        "O cálculo compara saldo disponível, recebíveis e obrigações ainda abertas.",
    });
  }

  if (snapshot.expense30d > snapshot.income30d && snapshot.income30d > 0) {
    items.push({
      priority: "high",
      title: "O fluxo recente está negativo",
      recommendation: `Nos últimos 30 dias, as saídas superaram as entradas em ${formatCurrency(snapshot.expense30d - snapshot.income30d)}. Use o custo de vida médio como teto inicial de revisão.`,
      rationale:
        "A comparação considera somente movimentações realizadas nos últimos 30 dias.",
    });
  }

  if (
    snapshot.costOfLiving > 0 &&
    snapshot.income30d > 0 &&
    snapshot.costOfLiving > snapshot.income30d * 0.7
  ) {
    items.push({
      priority: "medium",
      title: "Seu custo essencial ocupa grande parte da renda recente",
      recommendation: `O custo de vida médio está em ${formatCurrency(snapshot.costOfLiving)}. Revise primeiro contratos essenciais com possibilidade real de redução, sem cortar itens críticos de saúde e educação.`,
      rationale:
        "O custo de vida usa apenas categorias marcadas como essenciais.",
    });
  }

  if (snapshot.investmentValue <= 0 && snapshot.overdue <= 0) {
    items.push({
      priority: "medium",
      title: "Crie uma reserva visível",
      recommendation:
        "Depois de proteger as contas essenciais e as dívidas com juros, programe um aporte pequeno e recorrente. A consistência importa mais que começar com um valor alto.",
      rationale:
        "Não há patrimônio registrado em contas do tipo investimento.",
    });
  }

  if (items.length === 0) {
    items.push({
      priority: "low",
      title: "Mantenha o ritmo atual",
      recommendation:
        "Não há alerta crítico nos dados atuais. Continue registrando as movimentações e revise as próximas obrigações antes de assumir novas parcelas.",
      rationale:
        "O motor não encontrou atraso, déficit projetado ou crescimento relevante de dívida.",
    });
  }

  return items.slice(0, 4);
}

function validateAiRecommendations(
  value: unknown,
  fallback: Recommendation[],
) {
  if (!Array.isArray(value)) return fallback;

  const valid = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const priority = record.priority;

      if (
        priority !== "low" &&
        priority !== "medium" &&
        priority !== "high" &&
        priority !== "critical"
      ) {
        return null;
      }

      const title = String(record.title ?? "").trim();
      const recommendation = String(
        record.recommendation ?? "",
      ).trim();
      const rationale = String(record.rationale ?? "").trim();

      if (!title || !recommendation) return null;

      return {
        priority,
        title: title.slice(0, 120),
        recommendation: recommendation.slice(0, 600),
        rationale: rationale.slice(0, 400),
      } satisfies Recommendation;
    })
    .filter((item): item is Recommendation => Boolean(item));

  return valid.length > 0 ? valid.slice(0, 4) : fallback;
}

async function loadSnapshot(
  supabase: ReturnType<typeof authorizedClient>,
  householdId: string,
) {
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);

  const [
    accountsResult,
    debtsResult,
    obligationsResult,
    costResult,
    investmentsResult,
    transactionsResult,
  ] = await Promise.all([
    supabase
      .from("pf_accounts")
      .select("type, balance, is_active")
      .eq("household_id", householdId)
      .eq("is_active", true),
    supabase
      .from("pf_debt_positions")
      .select("projected_balance, daily_growth, status")
      .eq("household_id", householdId)
      .not("status", "in", "(paid,cancelled)"),
    supabase
      .from("pf_upcoming_obligations")
      .select("direction, remaining_amount, computed_status")
      .eq("household_id", householdId),
    supabase
      .from("pf_cost_of_living_summary")
      .select("average_monthly_cost")
      .eq("household_id", householdId)
      .maybeSingle(),
    supabase
      .from("pf_investment_positions")
      .select("current_value, is_active")
      .eq("household_id", householdId)
      .eq("is_active", true),
    supabase
      .from("pf_transactions")
      .select("type, status, amount, occurred_on")
      .eq("household_id", householdId)
      .eq("status", "paid")
      .gte("occurred_on", thirtyDaysAgo),
  ]);

  const firstError =
    accountsResult.error ??
    debtsResult.error ??
    obligationsResult.error ??
    costResult.error ??
    investmentsResult.error ??
    transactionsResult.error;

  if (firstError) throw firstError;

  const available = (accountsResult.data ?? [])
    .filter((account) =>
      ["checking", "savings", "cash", "wallet"].includes(
        String(account.type),
      ),
    )
    .reduce((sum, account) => sum + toNumber(account.balance), 0);

  const debtBalance = (debtsResult.data ?? []).reduce(
    (sum, debt) => sum + toNumber(debt.projected_balance),
    0,
  );
  const debtDailyGrowth = (debtsResult.data ?? []).reduce(
    (sum, debt) => sum + toNumber(debt.daily_growth),
    0,
  );

  let payable = 0;
  let receivable = 0;
  let overdue = 0;

  for (const obligation of obligationsResult.data ?? []) {
    const amount = toNumber(obligation.remaining_amount);
    if (obligation.direction === "payable") payable += amount;
    if (obligation.direction === "receivable") receivable += amount;
    if (obligation.computed_status === "overdue") overdue += amount;
  }

  let income30d = 0;
  let expense30d = 0;

  for (const transaction of transactionsResult.data ?? []) {
    const amount = toNumber(transaction.amount);
    if (
      transaction.type === "income" ||
      transaction.type === "debt_received"
    ) {
      income30d += amount;
    }
    if (
      transaction.type === "expense" ||
      transaction.type === "debt_payment"
    ) {
      expense30d += amount;
    }
  }

  const investmentValue = (investmentsResult.data ?? []).reduce(
    (sum, investment) => sum + toNumber(investment.current_value),
    0,
  );

  return {
    available,
    income30d,
    expense30d,
    payable,
    receivable,
    overdue,
    debtBalance,
    debtDailyGrowth,
    investmentValue,
    costOfLiving: toNumber(costResult.data?.average_monthly_cost),
  };
}

async function currentRecommendations(
  supabase: ReturnType<typeof authorizedClient>,
  householdId: string,
) {
  const result = await supabase
    .from("pf_active_financial_recommendations")
    .select(
      "id, priority, title, recommendation, rationale, source, model, expires_at, created_at",
    )
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });

  if (result.error) throw result.error;
  return result.data ?? [];
}

export async function GET(request: Request) {
  const accessToken = tokenFrom(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sessão não informada." },
      { status: 401 },
    );
  }

  try {
    const url = new URL(request.url);
    const householdId = url.searchParams.get("householdId")?.trim();

    if (!householdId) {
      return NextResponse.json(
        { error: "Grupo familiar não informado." },
        { status: 400 },
      );
    }

    const supabase = authorizedClient(accessToken);
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Sua sessão expirou." },
        { status: 401 },
      );
    }

    return NextResponse.json({
      recommendations: await currentRecommendations(
        supabase,
        householdId,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar as recomendações.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const accessToken = tokenFrom(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sessão não informada." },
      { status: 401 },
    );
  }

  const supabase = authorizedClient(accessToken);

  try {
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Sua sessão expirou." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as {
      householdId?: string;
      force?: boolean;
    };
    const householdId = body.householdId?.trim();

    if (!householdId) {
      return NextResponse.json(
        { error: "Grupo familiar não informado." },
        { status: 400 },
      );
    }

    if (!body.force) {
      const existing = await currentRecommendations(
        supabase,
        householdId,
      );
      if (existing.length > 0) {
        return NextResponse.json({
          recommendations: existing,
          refreshed: false,
        });
      }
    }

    const snapshot = await loadSnapshot(supabase, householdId);
    const fallback = deterministicRecommendations(snapshot);
    let recommendations = fallback;
    let source: "deterministic" | "ai" = "deterministic";
    let model: string | null = null;

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    if (apiKey) {
      try {
        const settings = await getAiRuntimeSettings(
          supabase,
          householdId,
        );
        await assertAiUsageAllowed(supabase, householdId, settings);
        model = settings.model;

        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer":
                process.env.OPENROUTER_SITE_URL ??
                "http://localhost:3000",
              "X-Title":
                process.env.OPENROUTER_APP_NAME ??
                "Grupo Umso Financeiro",
            },
            body: JSON.stringify({
              model,
              temperature: 0.1,
              messages: [
                {
                  role: "system",
                  content: [
                    "Você é a Kyra, agente de orientação financeira pessoal.",
                    "Os cálculos já foram feitos por um motor determinístico.",
                    "Não altere números, não invente dados e não recomende crédito novo.",
                    "Reescreva e priorize no máximo 4 recomendações práticas em português do Brasil.",
                    "Responda somente JSON no formato {\"recommendations\":[{\"priority\":\"low|medium|high|critical\",\"title\":\"...\",\"recommendation\":\"...\",\"rationale\":\"...\"}]}.",
                  ].join("\n"),
                },
                {
                  role: "user",
                  content: JSON.stringify({
                    snapshot,
                    calculated_recommendations: fallback,
                  }),
                },
              ],
            }),
          },
        );

        const responseBody =
          (await response.json()) as OpenRouterResponse;

        if (!response.ok) {
          throw new Error(
            responseBody.error?.message ||
              "OpenRouter não conseguiu gerar as recomendações.",
          );
        }

        const content =
          responseBody.choices?.[0]?.message?.content?.trim();

        if (content) {
          const parsed = JSON.parse(stripCodeFence(content)) as {
            recommendations?: unknown;
          };
          recommendations = validateAiRecommendations(
            parsed.recommendations,
            fallback,
          );
          source = "ai";
        }

        await recordAiUsage(supabase, {
          householdId,
          userId: userData.user.id,
          model: responseBody.model ?? model,
          requestKind: "financial_recommendations",
          status: "success",
          generationId: responseBody.id ?? null,
          promptTokens: responseBody.usage?.prompt_tokens ?? 0,
          completionTokens:
            responseBody.usage?.completion_tokens ?? 0,
          totalTokens: responseBody.usage?.total_tokens ?? 0,
          reasoningTokens:
            responseBody.usage?.reasoning_tokens ?? 0,
          cachedTokens: responseBody.usage?.cached_tokens ?? 0,
          costUsd: responseBody.usage?.cost ?? 0,
        });
      } catch (aiError) {
        console.warn(
          "Recomendações de IA indisponíveis; usando motor determinístico.",
          aiError,
        );
      }
    }

    await supabase
      .from("pf_financial_recommendations")
      .update({
        status: "superseded",
        updated_at: new Date().toISOString(),
      })
      .eq("household_id", householdId)
      .eq("status", "active");

    const expiresAt = new Date(
      Date.now() + 6 * 60 * 60 * 1000,
    ).toISOString();

    const insertResult = await supabase
      .from("pf_financial_recommendations")
      .insert(
        recommendations.map((item) => ({
          household_id: householdId,
          generated_by: userData.user.id,
          priority: item.priority,
          title: item.title,
          recommendation: item.recommendation,
          rationale: item.rationale,
          source,
          model,
          basis: snapshot,
          status: "active",
          expires_at: expiresAt,
        })),
      )
      .select(
        "id, priority, title, recommendation, rationale, source, model, expires_at, created_at",
      );

    if (insertResult.error) throw insertResult.error;

    await supabase.rpc("pf_log_security_event", {
      target_household_id: householdId,
      target_event_type: "financial_recommendations_generated",
      target_severity: "info",
      target_success: true,
      target_resource_type: "financial_recommendation",
      target_resource_id: null,
      target_request_id: null,
      target_ip_hash: null,
      target_user_agent_hash: null,
      target_metadata: {
        source,
        recommendation_count: recommendations.length,
      },
    });

    return NextResponse.json({
      recommendations: insertResult.data ?? [],
      refreshed: true,
      source,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível gerar recomendações.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
