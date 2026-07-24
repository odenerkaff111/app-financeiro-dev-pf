import {
  createClient,
} from "@supabase/supabase-js";

export function createSupabaseAdmin() {
  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL
      ?.trim();

  const secretKey = (
    process.env
      .SUPABASE_SECRET_KEY ??
    process.env
      .SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (
    !supabaseUrl ||
    !secretKey
  ) {
    throw new Error(
      "SUPABASE_SECRET_KEY não foi configurada no servidor.",
    );
  }

  return createClient(
    supabaseUrl,
    secretKey,
    {
      auth: {
        autoRefreshToken:
          false,

        persistSession:
          false,

        detectSessionInUrl:
          false,
      },
    },
  );
}
