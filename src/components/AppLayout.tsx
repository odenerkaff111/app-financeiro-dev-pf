"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { TopNavigation } from "./TopNavigation";
import { getSessionOnce, supabase } from "@/lib/supabase";
import { HouseholdProvider } from "@/contexts/HouseholdContext";

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-900">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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
      <main className="min-h-screen bg-[#f7f9fc] text-slate-900">
        <TopNavigation />

        <section className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          <div
            key={pathname}
            className="page-route-enter min-w-0"
          >
            {children}
          </div>
        </section>
      </main>
    </HouseholdProvider>
  );
}