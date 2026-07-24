import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  assertAiUsageAllowed,
  getAiRuntimeSettings,
  recordAiUsage,
} from "@/lib/ai-server";

type RequestHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type RequestContext = {
  accounts: Array<{
    id: string;
    name: string;
    institution_name: string | null;
    type: string;
  }>;

  categories: Array<{
    id: string;
    name: string;
    kind: string;
  }>;

  debts: Array<{
    id: string;
    creditor: string;
    installment_amount: number;
    current_balance: number;
    status: string;
  }>;
};

type ChatRequestBody = {
  message?: string;
  householdId?: string;
  history?: RequestHistoryItem[];
  context?: RequestContext;
};

type FinancialActionPayload = {
  account_id: string | null;
  account_name: string | null;

  destination_account_id: string | null;
  destination_account_name: string | null;

  category_id: string | null;
  category_name: string | null;

  debt_id: string | null;
  creditor: string | null;

  type: "income" | "expense" | null;

  amount: number | null;
  description: string | null;
  merchant: string | null;
  occurred_on: string | null;
  notes: string | null;

  count_installment: boolean | null;
};

type StructuredResponse = {
  reply: string;

  action_type:
    | "none"
    | "create_transaction"
    | "create_transfer"
    | "register_debt_payment";

  action_payload: FinancialActionPayload;
};

type OpenRouterResponse = {
  model?: string;

  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;

  error?: {
    message?: string;
  };
};

function createAuthorizedSupabase(
  accessToken: string,
) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  const supabaseKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "As variáveis públicas do Supabase não estão configuradas.",
    );
  }

  return createClient(
    supabaseUrl,
    supabaseKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },

      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function getAccessToken(
  request: Request,
) {
  const authorization =
    request.headers.get("authorization");

  if (
    !authorization?.startsWith("Bearer ")
  ) {
    return null;
  }

  return authorization.slice(7).trim();
}

function stripCodeFence(
  value: string,
) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeText(
  value: string,
) {
  return value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBrazilianAmount(
  message: string,
) {
  const patterns = [
    /r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i,
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*reais?/i,
  ];

  for (const pattern of patterns) {
    const match =
      message.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const normalized =
      match[1].includes(",")
        ? match[1]
            .replace(/\./g, "")
            .replace(",", ".")
        : match[1];

    const amount =
      Number(normalized);

    if (
      Number.isFinite(amount) &&
      amount > 0
    ) {
      return amount;
    }
  }

  return null;
}

function getTodayInBrazil() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "America/Sao_Paulo",

      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date());
}

function createEmptyPayload(): FinancialActionPayload {
  return {
    account_id: null,
    account_name: null,

    destination_account_id: null,
    destination_account_name: null,

    category_id: null,
    category_name: null,

    debt_id: null,
    creditor: null,

    type: null,

    amount: null,
    description: null,
    merchant: null,
    occurred_on: null,
    notes: null,

    count_installment: null,
  };
}

function containsWholePhrase(
  normalizedText: string,
  normalizedPhrase: string,
) {
  if (!normalizedPhrase) {
    return false;
  }

  return (` ${normalizedText} `).includes(
    ` ${normalizedPhrase} `,
  );
}

function findDebt(
  message: string,
  context: RequestContext,
) {
  const normalizedMessage =
    normalizeText(message);

  return [...context.debts]
    .sort(
      (first, second) =>
        normalizeText(second.creditor).length -
        normalizeText(first.creditor).length,
    )
    .find((debt) =>
      containsWholePhrase(
        normalizedMessage,
        normalizeText(debt.creditor),
      ),
    );
}

function findAccount(
  message: string,
  context: RequestContext,
) {
  const normalizedMessage =
    normalizeText(message);

  const exactByName =
    context.accounts.find(
      (account) =>
        normalizedMessage.includes(
          normalizeText(
            account.name,
          ),
        ),
    );

  if (exactByName) {
    return exactByName;
  }

  return context.accounts.find(
    (account) => {
      const institution =
        account.institution_name
          ? normalizeText(
              account.institution_name,
            )
          : "";

      return (
        institution.length >= 3 &&
        normalizedMessage.includes(
          institution,
        )
      );
    },
  );
}

function getNaturalReply(
  response: StructuredResponse,
) {
  const payload =
    response.action_payload;

  const amount =
    payload.amount !== null
      ? new Intl.NumberFormat(
          "pt-BR",
          {
            style: "currency",
            currency: "BRL",
          },
        ).format(
          payload.amount,
        )
      : null;

  if (
    response.action_type ===
    "register_debt_payment"
  ) {
    return amount
      ? `Entendi. Vou registrar um pagamento de ${amount} para ${payload.creditor ?? "o credor informado"}. Revise os dados abaixo antes de confirmar.`
      : `Entendi. Vou preparar o pagamento para ${payload.creditor ?? "o credor informado"}. Revise os dados abaixo antes de confirmar.`;
  }

  if (
    response.action_type ===
    "create_transfer"
  ) {
    return amount
      ? `Entendi. Vou registrar uma transferência de ${amount}. Revise os dados abaixo antes de confirmar.`
      : "Entendi. Vou preparar a transferência. Revise os dados abaixo antes de confirmar.";
  }

  if (
    response.action_type ===
      "create_transaction" &&
    payload.type === "income"
  ) {
    return amount
      ? `Entendi. Vou registrar uma receita de ${amount}. Revise os dados abaixo antes de confirmar.`
      : "Entendi. Vou preparar o registro da receita. Revise os dados abaixo antes de confirmar.";
  }

  if (
    response.action_type ===
    "create_transaction"
  ) {
    return amount
      ? `Entendi. Vou registrar uma despesa de ${amount}. Revise os dados abaixo antes de confirmar.`
      : "Entendi. Vou preparar o registro da despesa. Revise os dados abaixo antes de confirmar.";
  }

  return response.reply;
}

function tryDeterministicDebtPayment(
  message: string,
  context: RequestContext,
): StructuredResponse | null {
  const normalizedMessage =
    normalizeText(message);

  const paymentWords = [
    "paguei",
    "mandei",
    "enviei",
    "transferi",
    "fiz um pix",
    "pix para",
  ];

  const looksLikePayment =
    paymentWords.some(
      (word) =>
        normalizedMessage.includes(
          word,
        ),
    );

  if (!looksLikePayment) {
    return null;
  }

  const debt =
    findDebt(
      message,
      context,
    );

  if (!debt) {
    return null;
  }

  const amount =
    parseBrazilianAmount(
      message,
    );

  const account =
    findAccount(
      message,
      context,
    );

  if (!amount) {
    return {
      reply:
        `Qual foi o valor pago para ${debt.creditor}?`,

      action_type:
        "none",

      action_payload:
        createEmptyPayload(),
    };
  }

  if (!account) {
    return {
      reply:
        `Por qual conta você pagou ${debt.creditor}?`,

      action_type:
        "none",

      action_payload:
        createEmptyPayload(),
    };
  }

  const explicitFullInstallment =
    [
      "parcela completa",
      "parcela inteira",
      "parcela cheia",
      "paguei a parcela",
    ].some(
      (phrase) =>
        normalizedMessage.includes(
          phrase,
        ),
    );

  const installmentAmount =
    Number(
      debt.installment_amount ??
        0,
    );

  const amountMatchesInstallment =
    installmentAmount > 0 &&
    Math.abs(
      installmentAmount -
        amount,
    ) <= 0.01;

  const countInstallment =
    explicitFullInstallment &&
    amountMatchesInstallment;

  return {
    reply:
      `Entendi. Vou registrar um pagamento de ${new Intl.NumberFormat(
        "pt-BR",
        {
          style: "currency",
          currency: "BRL",
        },
      ).format(amount)} para ${debt.creditor}. Revise os dados abaixo antes de confirmar.`,

    action_type:
      "register_debt_payment",

    action_payload: {
      account_id:
        account.id,

      account_name:
        account.name,

      destination_account_id:
        null,

      destination_account_name:
        null,

      category_id:
        null,

      category_name:
        null,

      debt_id:
        debt.id,

      creditor:
        debt.creditor,

      type:
        null,

      amount,

      description:
        `Pagamento de dívida - ${debt.creditor}`,

      merchant:
        debt.creditor,

      occurred_on:
        getTodayInBrazil(),

      notes:
        countInstallment
          ? "Parcela completa informada no chat."
          : "Pagamento parcial informado no chat.",

      count_installment:
        countInstallment,
    },
  };
}

function validateStructuredResponse(
  response: StructuredResponse,
  context: RequestContext,
) {
  const payload =
    response.action_payload;

  if (
    response.action_type ===
    "none"
  ) {
    return {
      ...response,
      action_payload:
        createEmptyPayload(),
    };
  }

  if (
    payload.account_id &&
    !context.accounts.some(
      (account) =>
        account.id ===
        payload.account_id,
    )
  ) {
    return {
      reply:
        "Não consegui identificar com segurança a conta. Qual conta devo usar?",

      action_type:
        "none" as const,

      action_payload:
        createEmptyPayload(),
    };
  }

  if (
    payload.destination_account_id &&
    !context.accounts.some(
      (account) =>
        account.id ===
        payload.destination_account_id,
    )
  ) {
    return {
      reply:
        "Não consegui identificar com segurança a conta de destino. Qual conta devo usar?",

      action_type:
        "none" as const,

      action_payload:
        createEmptyPayload(),
    };
  }

  if (
    payload.category_id &&
    !context.categories.some(
      (category) =>
        category.id ===
        payload.category_id,
    )
  ) {
    payload.category_id =
      null;

    payload.category_name =
      null;
  }

  if (
    payload.debt_id &&
    !context.debts.some(
      (debt) =>
        debt.id ===
        payload.debt_id,
    )
  ) {
    return {
      reply:
        "Não consegui identificar com segurança a dívida. Qual credor você pagou?",

      action_type:
        "none" as const,

      action_payload:
        createEmptyPayload(),
    };
  }

  return {
    ...response,
    reply:
      getNaturalReply(
        response,
      ),
  };
}

export async function POST(
  request: Request,
) {
  try {
    const accessToken =
      getAccessToken(request);

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Sessão não informada.",
        },
        {
          status: 401,
        },
      );
    }

    const supabase =
      createAuthorizedSupabase(
        accessToken,
      );

    const {
      data: userResult,
      error: userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !userResult.user
    ) {
      return NextResponse.json(
        {
          error:
            "Sua sessão expirou. Entre novamente.",
        },
        {
          status: 401,
        },
      );
    }

    const body =
      (await request.json()) as
        ChatRequestBody;

    const message =
      body.message?.trim();

    const householdId =
      body.householdId?.trim();

    if (!message) {
      return NextResponse.json(
        {
          error:
            "Digite uma mensagem.",
        },
        {
          status: 400,
        },
      );
    }

    if (!householdId) {
      return NextResponse.json(
        {
          error:
            "Grupo familiar não informado.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from(
        "pf_household_members",
      )
      .select("household_id")
      .eq(
        "household_id",
        householdId,
      )
      .eq(
        "user_id",
        userResult.user.id,
      )
      .maybeSingle();

    if (
      membershipError ||
      !membership
    ) {
      return NextResponse.json(
        {
          error:
            "Você não possui acesso a este grupo familiar.",
        },
        {
          status: 403,
        },
      );
    }

    const context =
      body.context ?? {
        accounts: [],
        categories: [],
        debts: [],
      };

    const deterministicResult =
      tryDeterministicDebtPayment(
        message,
        context,
      );

    if (deterministicResult) {
      return NextResponse.json({
        ...deterministicResult,
        model:
          "deterministic-parser",
      });
    }

    const apiKey =
      process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "OPENROUTER_API_KEY não foi configurada.",
        },
        {
          status: 500,
        },
      );
    }

    const aiSettings =
      await getAiRuntimeSettings(
        supabase,
        householdId,
      );

    await assertAiUsageAllowed(
      supabase,
      householdId,
      aiSettings,
    );

    const model =
      aiSettings.model;

    const history =
      (body.history ?? [])
        .filter(
          (item) =>
            item.content?.trim(),
        )
        .slice(-10)
        .map(
          (item) => ({
            role:
              item.role,

            content:
              item.content.trim(),
          }),
        );

    const systemPrompt = `
Você é o assistente financeiro do Grupo Umsó.

Sua tarefa é conversar em português do Brasil e interpretar pedidos financeiros.
Você NÃO executa ações. Você apenas propõe uma ação estruturada para confirmação posterior.

Data de hoje no Brasil: ${getTodayInBrazil()}.

REGRAS OBRIGATÓRIAS:
1. Nunca invente IDs, contas, categorias ou dívidas.
2. Use somente IDs presentes no CONTEXTO.
3. Leia com atenção o valor já informado pelo usuário. Nunca pergunte novamente um valor explícito.
4. Se faltar conta, destino, credor ou outro dado essencial, use action_type "none" e faça uma pergunta curta.
5. Para despesa ou receita comum use "create_transaction".
6. Para transferência entre duas contas use "create_transfer".
7. Para pagamento a um credor listado em dívidas use "register_debt_payment".
8. Pagamento parcial de dívida deve usar count_installment false.
9. Use count_installment true somente quando o usuário disser claramente que pagou a parcela completa.
10. Não trate empréstimo recebido como receita comum. Neste MVP, explique que esse tipo ainda precisa ser registrado manualmente.
11. occurred_on deve ser YYYY-MM-DD. Quando o usuário não informar data, use a data de hoje.
12. O campo reply deve conter somente uma resposta humana curta. Nunca coloque JSON, IDs, payload ou código dentro de reply.
13. Quando houver uma ação, diga apenas que entendeu e que os dados estão abaixo para revisão.
14. Para action_type "none", todos os campos do action_payload devem ser null.

CONTEXTO DISPONÍVEL:
${JSON.stringify(context, null, 2)}
`.trim();

    const response =
      await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json",

            "HTTP-Referer":
              process.env
                .OPENROUTER_SITE_URL ??
              "http://localhost:3000",

            "X-Title":
              process.env
                .OPENROUTER_APP_NAME ??
              "Grupo Umso Financeiro",
          },

          body:
            JSON.stringify({
              model,

              messages: [
                {
                  role:
                    "system",

                  content:
                    systemPrompt,
                },

                ...history,

                {
                  role:
                    "user",

                  content:
                    message,
                },
              ],

              temperature:
                0.1,

              provider: {
                require_parameters:
                  true,
              },

              plugins: [
                {
                  id:
                    "response-healing",
                },
              ],

              response_format: {
                type:
                  "json_schema",

                json_schema: {
                  name:
                    "financial_assistant_response",

                  strict:
                    true,

                  schema: {
                    type:
                      "object",

                    properties: {
                      reply: {
                        type:
                          "string",
                      },

                      action_type:
                        {
                          type:
                            "string",

                          enum: [
                            "none",
                            "create_transaction",
                            "create_transfer",
                            "register_debt_payment",
                          ],
                        },

                      action_payload:
                        {
                          type:
                            "object",

                          properties:
                            {
                              account_id:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              account_name:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              destination_account_id:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              destination_account_name:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              category_id:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              category_name:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              debt_id:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              creditor:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              type: {
                                type: [
                                  "string",
                                  "null",
                                ],

                                enum: [
                                  "income",
                                  "expense",
                                  null,
                                ],
                              },

                              amount: {
                                type: [
                                  "number",
                                  "null",
                                ],
                              },

                              description:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              merchant:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              occurred_on:
                                {
                                  type: [
                                    "string",
                                    "null",
                                  ],
                                },

                              notes: {
                                type: [
                                  "string",
                                  "null",
                                ],
                              },

                              count_installment:
                                {
                                  type: [
                                    "boolean",
                                    "null",
                                  ],
                                },
                            },

                          required: [
                            "account_id",
                            "account_name",
                            "destination_account_id",
                            "destination_account_name",
                            "category_id",
                            "category_name",
                            "debt_id",
                            "creditor",
                            "type",
                            "amount",
                            "description",
                            "merchant",
                            "occurred_on",
                            "notes",
                            "count_installment",
                          ],

                          additionalProperties:
                            false,
                        },
                    },

                    required: [
                      "reply",
                      "action_type",
                      "action_payload",
                    ],

                    additionalProperties:
                      false,
                  },
                },
              },
            }),
        },
      );

    const responseBody =
      (await response.json()) as
        OpenRouterResponse;

    if (!response.ok) {
      console.error(
        "Erro do OpenRouter:",
        responseBody,
      );

      return NextResponse.json(
        {
          error:
            responseBody.error
              ?.message ||
            "A IA não conseguiu responder agora.",
        },
        {
          status:
            response.status,
        },
      );
    }

    const rawContent =
      responseBody.choices?.[0]
        ?.message?.content;

    if (!rawContent) {
      return NextResponse.json(
        {
          error:
            "A IA retornou uma resposta vazia.",
        },
        {
          status: 502,
        },
      );
    }

    const parsed =
      JSON.parse(
        stripCodeFence(
          rawContent,
        ),
      ) as StructuredResponse;

    const validated =
      validateStructuredResponse(
        parsed,
        context,
      );

    const meteredResponse =
      responseBody as OpenRouterResponse & {
        id?: string;
        provider?: string;

        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          cost?: number;

          prompt_tokens_details?: {
            cached_tokens?: number;
          };

          completion_tokens_details?: {
            reasoning_tokens?: number;
          };
        };
      };

    await recordAiUsage(
      supabase,
      {
        householdId,
        userId:
          userResult.user.id,

        provider:
          "openrouter",

        providerName:
          meteredResponse.provider ??
          null,

        model:
          responseBody.model ??
          model,

        requestKind:
          "chat",

        status:
          "success",

        generationId:
          meteredResponse.id ??
          null,

        promptTokens:
          meteredResponse.usage
            ?.prompt_tokens ??
          0,

        completionTokens:
          meteredResponse.usage
            ?.completion_tokens ??
          0,

        totalTokens:
          meteredResponse.usage
            ?.total_tokens ??
          0,

        reasoningTokens:
          meteredResponse.usage
            ?.completion_tokens_details
            ?.reasoning_tokens ??
          0,

        cachedTokens:
          meteredResponse.usage
            ?.prompt_tokens_details
            ?.cached_tokens ??
          0,

        costUsd:
          meteredResponse.usage
            ?.cost ??
          0,
      },
    );

    return NextResponse.json({
      ...validated,

      model:
        responseBody.model ??
        model,
    });
  } catch (error) {
    console.error(
      "Erro no assistente financeiro:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro inesperado no assistente.",
      },
      {
        status: 500,
      },
    );
  }
}
