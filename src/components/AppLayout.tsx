"use client";

import {
  usePathname,
  useRouter,
} from "next/navigation";
import {
  useEffect,
  useState,
} from "react";
import {
  Eye,
  Loader2,
} from "lucide-react";
import {
  getSessionOnce,
  supabase,
} from "@/lib/supabase";
import {
  HouseholdProvider,
  useHousehold,
} from "@/contexts/HouseholdContext";
import {
  AppDock,
} from "./AppDock";
import {
  logSecurityEvent,
} from "@/lib/security-events";

export function AppLayout({
  children,
}: {
  children:
    React.ReactNode;
}) {
  const pathname =
    usePathname();

  const router =
    useRouter();

  const isAuthPage =
    pathname?.startsWith(
      "/auth",
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    authenticated,
    setAuthenticated,
  ] = useState(false);

  useEffect(() => {
    let active =
      true;

    async function checkAuth() {
      try {
        const {
          data: {
            session,
          },
          error,
        } =
          await getSessionOnce();

        if (!active) {
          return;
        }

        if (error) {
          console.error(
            "Erro ao verificar sessão:",
            error,
          );

          setAuthenticated(
            false,
          );

          if (
            !isAuthPage
          ) {
            router.replace(
              "/auth",
            );
          }

          setLoading(
            false,
          );

          return;
        }

        const hasSession =
          Boolean(
            session,
          );

        setAuthenticated(
          hasSession,
        );

        if (
          !hasSession &&
          !isAuthPage
        ) {
          router.replace(
            "/auth",
          );
        } else if (
          hasSession &&
          isAuthPage &&
          pathname ===
            "/auth"
        ) {
          router.replace(
            "/",
          );
        }

        setLoading(
          false,
        );
      } catch (error) {
        if (!active) {
          return;
        }

        console.error(
          "Não foi possível conectar ao Supabase:",
          error,
        );

        setAuthenticated(
          false,
        );

        if (
          !isAuthPage
        ) {
          router.replace(
            "/auth",
          );
        }

        setLoading(
          false,
        );
      }
    }

    void checkAuth();

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (
          _event,
          session,
        ) => {
          if (!active) {
            return;
          }

          const hasSession =
            Boolean(
              session,
            );

          setAuthenticated(
            hasSession,
          );

          if (
            !hasSession &&
            !isAuthPage
          ) {
            router.replace(
              "/auth",
            );
          } else if (
            hasSession &&
            isAuthPage &&
            pathname ===
              "/auth"
          ) {
            router.replace(
              "/",
            );
          }
        },
      );

    return () => {
      active =
        false;

      subscription.unsubscribe();
    };
  }, [
    isAuthPage,
    pathname,
    router,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F5EF]">
        <Loader2 className="h-8 w-8 animate-spin text-[#C8A15A]" />
      </div>
    );
  }

  if (isAuthPage) {
    return (
      <>
        {children}
      </>
    );
  }

  if (
    !authenticated
  ) {
    return null;
  }

  return (
    <HouseholdProvider>
      <AuthenticatedShell>
        {children}
      </AuthenticatedShell>
    </HouseholdProvider>
  );
}

function AuthenticatedShell({
  children,
}: {
  children:
    React.ReactNode;
}) {
  const pathname =
    usePathname();

  const {
    household,
    isViewer,
  } =
    useHousehold();

  const [
    financialDataVersion,
    setFinancialDataVersion,
  ] =
    useState(0);

  useEffect(() => {
    const storageKey =
      `pf:session-event:${household.id}`;

    if (
      window.sessionStorage.getItem(
        storageKey,
      )
    ) {
      return;
    }

    window.sessionStorage.setItem(
      storageKey,
      String(Date.now()),
    );

    void logSecurityEvent({
      householdId:
        household.id,
      eventType:
        "session_started",
      severity:
        "info",
      success:
        true,
      resourceType:
        "session",
      metadata: {
        route:
          pathname ?? "/",
        source:
          "web",
      },
    });
  }, [
    household.id,
    pathname,
  ]);

  useEffect(() => {
    function refreshFinancialData() {
      setFinancialDataVersion(
        (
          currentVersion,
        ) =>
          currentVersion +
          1,
      );
    }

    function handleStorage(
      event:
        StorageEvent,
    ) {
      if (
        event.key ===
        "pf:financial-data-version"
      ) {
        refreshFinancialData();
      }
    }

    window.addEventListener(
      "pf:financial-data-changed",
      refreshFinancialData,
    );

    window.addEventListener(
      "storage",
      handleStorage,
    );

    return () => {
      window.removeEventListener(
        "pf:financial-data-changed",
        refreshFinancialData,
      );

      window.removeEventListener(
        "storage",
        handleStorage,
      );
    };
  }, []);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#F7F5EF] text-[#0D1B2A]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(200,161,90,0.08),transparent_27%),radial-gradient(circle_at_92%_90%,rgba(13,27,42,0.05),transparent_30%)]" />

      <section className="relative mx-auto w-full max-w-[1600px] px-4 pb-10 pt-24 sm:px-6 sm:pt-28 lg:px-8">
        {isViewer && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <Eye
              size={17}
              className="shrink-0"
            />

            <span>
              Modo visualização. Você pode consultar os dados e conversar com a IA, mas não pode alterar informações financeiras.
            </span>
          </div>
        )}

        <div
          key={`${pathname}-${financialDataVersion}`}
          className="page-route-enter min-w-0"
        >
          {children}
        </div>
      </section>

      <AppDock />
    </main>
  );
}
