import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type FamilyData, type Row, str } from "./family-finance";

export class FamilyError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
export const familyJson = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
  });
export async function familyAuthorize(
  request: Request,
  household: unknown,
  write = false,
) {
  if (!uuid(household)) throw new FamilyError("Grupo familiar inválido.");
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 9000)
    throw new FamilyError("Entre novamente para continuar.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new FamilyError("Supabase não configurado no servidor.", 503);
  const db = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const user = await db.auth.getUser();
  if (user.error || !user.data.user)
    throw new FamilyError("Sessão inválida. Entre novamente.", 401);
  const member = await db
    .from("pf_household_members")
    .select("role")
    .eq("household_id", household)
    .eq("user_id", user.data.user.id)
    .maybeSingle();
  if (
    member.error ||
    !member.data ||
    (write && !["owner", "member"].includes(member.data.role))
  )
    throw new FamilyError("Sem permissão para esta operação no grupo.", 403);
  return { db, household, user: user.data.user, role: str(member.data.role) };
}
export async function familyRows(
  db: SupabaseClient,
  table: string,
  household: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const result = await db
      .from(table)
      .select("*")
      .eq("household_id", household)
      .order("id")
      .range(offset, offset + 999);
    if (result.error)
      throw new FamilyError(
        `Não consegui consultar ${table}. Confira as migrações e permissões do grupo.`,
        503,
      );
    const page = (result.data ?? []) as Row[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new FamilyError(
    "Há muitos registros para esta consulta. Nenhum total parcial foi apresentado.",
    413,
  );
}
export async function loadFamilyData(
  db: SupabaseClient,
  household: string,
): Promise<FamilyData> {
  const tables = [
    "pf_accounts",
    "pf_transactions",
    "pf_card_statement_dashboard",
    "pf_categories",
    "pf_debt_progress",
    "pf_personal_loan_positions",
    "pf_budgets",
    "pf_recurring_templates",
  ] as const;
  const results = await Promise.all(
    tables.map((t) => familyRows(db, t, household)),
  );
  const pref = await db
    .from("pf_family_preferences")
    .select("minimum_reserve")
    .eq("household_id", household)
    .maybeSingle();
  if (pref.error && !["42P01", "PGRST205"].includes(pref.error.code))
    throw new FamilyError("Não consegui consultar a reserva mínima.", 503);
  return {
    accounts: results[0],
    transactions: results[1],
    statements: results[2],
    categories: results[3],
    debts: results[4],
    loans: results[5],
    budgets: results[6],
    recurring: results[7],
    preferences: pref.data ? [pref.data] : [],
  };
}
export function familyFailure(error: unknown) {
  if (error instanceof FamilyError)
    return familyJson({ error: error.message }, error.status);
  console.error(
    "[family-finance]",
    error instanceof Error ? error.name : "Unknown",
  );
  return familyJson(
    {
      error:
        "Não foi possível concluir a consulta. Nenhuma atualização foi confirmada.",
    },
    503,
  );
}
