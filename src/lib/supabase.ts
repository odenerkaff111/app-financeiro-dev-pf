import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

const supabaseKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)?.trim();

if (!supabaseUrl) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL não foi definida no arquivo .env.local."
  );
}

if (!supabaseKey) {
  throw new Error(
    "Defina NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ou NEXT_PUBLIC_SUPABASE_ANON_KEY no arquivo .env.local."
  );
}

declare global {
  var __kyraSupabaseClient: SupabaseClient | undefined;
}

export const supabase =
  globalThis.__kyraSupabaseClient ??
  createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__kyraSupabaseClient = supabase;
}

let sessionRequest: ReturnType<typeof supabase.auth.getSession> | null = null;

export function getSessionOnce() {
  if (!sessionRequest) {
    sessionRequest = supabase.auth.getSession().finally(() => {
      sessionRequest = null;
    });
  }

  return sessionRequest;
}