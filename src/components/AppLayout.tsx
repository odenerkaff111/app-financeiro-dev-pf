"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getSessionOnce, supabase } from "@/lib/supabase";
import { HouseholdProvider } from "@/contexts/HouseholdContext";
import { AppHeader } from "./AppHeader";
import { AppDock } from "./AppDock";

export function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const isAuthPage = pathname?.startsWith("/auth");

  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkAuth() {
      try {
        const {
          data: { session },
          error,
        } = await getSessionOnce();

        if (!active) return;

        if (error) {
          console.error("Erro ao verificar sessão:", error);

          setAuthenticated(false);

          if (!isAuthPage) {
            router.replace("/auth");
          }

          setLoading(false);
          return;
        }

        const hasSession = Boolean(session);

        setAuthenticated(hasSession);

        if (!hasSession && !isAuthPage) {
          router.replace("/auth");
        } else if (hasSession && isAuthPage) {
          router.replace("/");
        }

        setLoading(false);
      } catch (error) {
        if (!active) return;

        console.error(
          "Não foi possível conectar ao Supabase:",
          error
        );

        setAuthenticated(false);

        if (!isAuthPage) {
          router.replace("/auth");
        }

        setLoading(false);
      }
    }

    void checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;

        const hasSession = Boolean(session);

        setAuthenticated(hasSession);

        if (!hasSession && !isAuthPage) {
          router.replace("/auth");
        } else if (hasSession && isAuthPage) {
          router.replace("/");
        }
      }
    );

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [isAuthPage, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F5EF] text-[#0D1B2A]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#C8A15A]" />

          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0D1B2A]/60">
            Preparando suas finanças
          </p>
        </div>
      </div>
    );
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (!authenticated) {
    return null;
  }

  return (
    <HouseholdProvider>
      <main className="relative min-h-screen overflow-x-hidden bg-[#F7F5EF] text-[#0D1B2A]">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(200,161,90,0.12),transparent_27%),radial-gradient(circle_at_92%_90%,rgba(13,27,42,0.06),transparent_30%)]" />

        <div className="pointer-events-none fixed left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-[#C8A15A]/45 to-transparent" />

        <div className="relative">
          <AppHeader />

          <section className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-4 sm:px-6 sm:pb-36 lg:px-8">
            <div
              key={pathname}
              className="page-route-enter min-w-0"
            >
              {children}
            </div>
          </section>
        </div>

        <AppDock />
      </main>
    </HouseholdProvider>
  );
}