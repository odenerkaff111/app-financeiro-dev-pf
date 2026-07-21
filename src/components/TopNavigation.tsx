"use client";

import Link from "next/link";
import {
  CircleDollarSign,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  WalletCards,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type NavigationItem = {
  href: string;
  label: string;
  exact?: boolean;
  icon: React.ComponentType<{
    className?: string;
    size?: number;
  }>;
};

const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Visão Geral",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/registros",
    label: "Movimentações",
    icon: CircleDollarSign,
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    icon: Settings,
  },
];

export function TopNavigation() {
  const pathname = usePathname();
  const router = useRouter();

  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [pathname]);

  function isItemActive(item: NavigationItem) {
    if (item.exact) {
      return pathname === item.href;
    }

    return pathname === item.href ||
      pathname.startsWith(`${item.href}/`);
  }

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      router.replace("/auth");
      router.refresh();
    } catch (error) {
      console.error("Erro ao sair da conta:", error);
      setLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-3"
          aria-label="Ir para a visão geral"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.25)]">
            <WalletCards size={21} />
          </div>

          <div className="hidden sm:block">
            <p className="text-base font-bold leading-none tracking-tight text-slate-950">
              Kyra
            </p>

            <p className="mt-1 text-[11px] font-medium text-slate-500">
              Finanças da família
            </p>
          </div>
        </Link>

        <nav
          className="top-nav-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-2"
          aria-label="Navegação principal"
        >
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item);

            return (
              <Link
                key={item.href}
                href={item.href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-all duration-200",
                  active
                    ? "bg-blue-50 text-blue-700 shadow-sm ring-1 ring-inset ring-blue-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                ].join(" ")}
              >
                <Icon
                  size={18}
                  className={active ? "text-blue-600" : "text-slate-500"}
                />

                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
          title="Sair da conta"
        >
          {loggingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut size={17} />
          )}

          <span className="hidden lg:inline">Sair</span>
        </button>
      </div>
    </header>
  );
}