import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { StatementPreviewRow } from "@/lib/financial-actions";

type ConfirmBody = {
  householdId?: string;
  accountId?: string;
  fileName?: string;
  rows?: StatementPreviewRow[];
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

function paidAtFor(date: string) {
  return new Date(`${date}T12:00:00-03:00`).toISOString();
}

export async function POST(request: Request) {
  try {
    const accessToken = tokenFrom(request);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Sessão não informada." },
        { status: 401 },
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

    const body = (await request.json()) as ConfirmBody;
    const householdId = body.householdId?.trim();
    const accountId = body.accountId?.trim();
    const fileName = body.fileName?.trim() || "extrato";
    const requestedRows = (body.rows ?? []).slice(0, 500);

    if (!householdId || !accountId) {
      throw new Error("Grupo familiar e conta são obrigatórios.");
    }

    if (requestedRows.length === 0) {
      throw new Error("Nenhuma movimentação foi selecionada.");
    }

    const [membershipResult, accountResult, categoriesResult] =
      await Promise.all([
        supabase
          .from("pf_household_members")
          .select("household_id, role")
          .eq("household_id", householdId)
          .eq("user_id", userData.user.id)
          .maybeSingle(),
        supabase
          .from("pf_accounts")
          .select("id")
          .eq("id", accountId)
          .eq("household_id", householdId)
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("pf_categories")
          .select("id")
          .eq("household_id", householdId),
      ]);

    if (membershipResult.error || !membershipResult.data) {
      throw new Error("Você não possui acesso a este grupo familiar.");
    }

    if (
      !["owner", "member"].includes(
        String(membershipResult.data.role),
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Seu acesso é somente leitura. Você não pode importar movimentações.",
        },
        {
          status: 403,
        },
      );
    }

    if (accountResult.error || !accountResult.data) {
      throw new Error("A conta selecionada não foi encontrada.");
    }

    if (categoriesResult.error) {
      throw categoriesResult.error;
    }

    const allowedCategoryIds = new Set(
      (categoriesResult.data ?? []).map((item) => String(item.id)),
    );

    const validRows = requestedRows.filter((row) => {
      return (
        !row.duplicate &&
        row.fingerprint &&
        row.occurred_on &&
        row.description?.trim() &&
        Number.isFinite(Number(row.amount)) &&
        Number(row.amount) > 0 &&
        (row.type === "income" || row.type === "expense")
      );
    });

    if (validRows.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        duplicates: requestedRows.length,
        message: "Nenhuma movimentação nova para importar.",
      });
    }

    const firstDate = validRows.reduce(
      (smallest, row) =>
        row.occurred_on < smallest ? row.occurred_on : smallest,
      validRows[0].occurred_on,
    );
    const lastDate = validRows.reduce(
      (largest, row) =>
        row.occurred_on > largest ? row.occurred_on : largest,
      validRows[0].occurred_on,
    );

    const existingResult = await supabase
      .from("pf_transactions")
      .select("metadata")
      .eq("household_id", householdId)
      .eq("account_id", accountId)
      .gte("occurred_on", firstDate)
      .lte("occurred_on", lastDate)
      .eq("source", "import");

    if (existingResult.error) {
      throw existingResult.error;
    }

    const existingFingerprints = new Set(
      (existingResult.data ?? [])
        .map((item) => {
          const metadata = item.metadata as Record<string, unknown> | null;

          return typeof metadata?.import_fingerprint === "string"
            ? metadata.import_fingerprint
            : null;
        })
        .filter((value): value is string => Boolean(value)),
    );

    const rowsToInsert = validRows.filter(
      (row) => !existingFingerprints.has(row.fingerprint),
    );

    const duplicates = requestedRows.length - rowsToInsert.length;

    if (rowsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        duplicates,
        message: "Todas as movimentações já tinham sido importadas.",
      });
    }

    const insertResult = await supabase
      .from("pf_transactions")
      .insert(
        rowsToInsert.map((row) => ({
          household_id: householdId,
          account_id: accountId,
          destination_account_id: null,
          category_id:
            row.category_id && allowedCategoryIds.has(row.category_id)
              ? row.category_id
              : null,
          created_by: userData.user.id,
          responsible_user_id: userData.user.id,
          type: row.type,
          status: "paid",
          description: row.description.trim(),
          merchant: row.description.trim(),
          amount: Number(row.amount),
          original_amount: Number(row.amount),
          occurred_on: row.occurred_on,
          due_date: row.occurred_on,
          paid_at: paidAtFor(row.occurred_on),
          source: "import",
          notes: `Importado do arquivo ${fileName}`,
          metadata: {
            origin: "statement_import",
            import_fingerprint: row.fingerprint,
            external_id: row.external_id,
            source_file: fileName,
          },
        })),
      )
      .select("id");

    if (insertResult.error) {
      throw insertResult.error;
    }

    const imported = insertResult.data?.length ?? 0;

    return NextResponse.json({
      success: true,
      imported,
      duplicates,
      message: `${imported} movimentação${
        imported === 1 ? "" : "ões"
      } importada${imported === 1 ? "" : "s"} com sucesso.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível importar o extrato.",
      },
      { status: 400 },
    );
  }
}
