import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const ALLOWED_METADATA_KEYS = new Set([
  "action",
  "route",
  "source",
  "status_code",
  "reason_code",
  "record_count",
  "obligation_type",
  "recommendation_count",
]);

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

function hashValue(value: string | null) {
  if (!value) return null;

  const salt =
    process.env.SECURITY_LOG_SALT?.trim() ||
    process.env.OPENROUTER_APP_NAME?.trim() ||
    "pf-security-log";

  return createHash("sha256")
    .update(`${salt}:${value}`)
    .digest("hex");
}

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const [key, item] of Object.entries(value)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;

    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      sanitized[key] = item;
    }
  }

  return sanitized;
}

export async function POST(request: Request) {
  const accessToken = tokenFrom(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sessão não informada." },
      { status: 401 },
    );
  }

  try {
    const supabase = authorizedClient(accessToken);
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
      eventType?: string;
      severity?: "info" | "warning" | "critical";
      success?: boolean;
      resourceType?: string | null;
      resourceId?: string | null;
      metadata?: unknown;
    };

    const householdId = body.householdId?.trim();
    const eventType = body.eventType?.trim();

    if (!householdId || !eventType) {
      return NextResponse.json(
        { error: "Grupo familiar e tipo de evento são obrigatórios." },
        { status: 400 },
      );
    }

    const requestId =
      request.headers.get("x-request-id")?.trim() || randomUUID();

    const forwardedFor = request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();

    const userAgent = request.headers.get("user-agent");

    const result = await supabase.rpc("pf_log_security_event", {
      target_household_id: householdId,
      target_event_type: eventType,
      target_severity: body.severity ?? "info",
      target_success: body.success ?? true,
      target_resource_type: body.resourceType?.trim() || null,
      target_resource_id: body.resourceId?.trim() || null,
      target_request_id: requestId,
      target_ip_hash: hashValue(forwardedFor ?? null),
      target_user_agent_hash: hashValue(userAgent),
      target_metadata: sanitizeMetadata(body.metadata),
    });

    if (result.error) {
      throw result.error;
    }

    return NextResponse.json({
      success: true,
      requestId,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível registrar o evento.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
