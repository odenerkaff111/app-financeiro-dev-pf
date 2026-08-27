import { supabase } from "@/lib/supabase";

type SecurityEventInput = {
  householdId: string;
  eventType: string;
  severity?: "info" | "warning" | "critical";
  success?: boolean;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logSecurityEvent(
  input: SecurityEventInput,
) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) return;

    await fetch("/api/security/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch (error) {
    console.warn("Não foi possível registrar evento de segurança.", error);
  }
}
