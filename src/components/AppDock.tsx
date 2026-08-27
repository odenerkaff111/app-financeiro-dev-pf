"use client";

import Link from "next/link";
import {
  CircleDollarSign,
  HandCoins,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  Sparkles,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type NavigationItem = {
  href: string;
  label: string;
  compactLabel: string;
  icon: LucideIcon;
  exact?: boolean;
};

const navigationItems: NavigationItem[] = [
  {
    href: "/",
    label: "Painel",
    compactLabel: "Painel",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/contas",
    label: "Contas e cartões",
    compactLabel: "Contas",
    icon: WalletCards,
  },
  {
    href: "/registros",
    label: "Movimentações",
    compactLabel: "Movimentações",
    icon: CircleDollarSign,
  },
  {
    href: "/dividas",
    label: "Dívidas",
    compactLabel: "Dívidas",
    icon: HandCoins,
  },
  {
    href: "/assistente",
    label: "Assistente",
    compactLabel: "Assistente",
    icon: Sparkles,
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    compactLabel: "Ajustes",
    icon: Settings,
  },
];

export function AppDock() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [pathname]);

  function isItemActive(item: NavigationItem) {
    if (item.exact) {
      return pathname === item.href;
    }

    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      router.replace("/auth");
      router.refresh();
    } catch (error) {
      console.error("Erro ao sair da conta:", error);
      setLoggingOut(false);
    }
  }

  return (
    <header className="fixed inset-x-0 top-0 z-[120] border-b border-[#C8A15A]/20 bg-[#071321]/[0.98] shadow-[0_10px_35px_rgba(7,19,33,0.16)] backdrop-blur-2xl">
      <div className="mx-auto flex h-[70px] w-full max-w-[1800px] items-center gap-3 px-3 sm:px-5 lg:px-7">
        <Link
          href="/"
          className="hidden min-w-[132px] shrink-0 items-center gap-2 lg:flex"
          aria-label="Ir para o painel"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#C8A15A]/35 bg-white/5 text-[#C8A15A]">
            <CircleDollarSign size={19} strokeWidth={2.2} />
          </span>
          <span className="leading-none">
            <span className="block text-[13px] font-bold tracking-[0.12em] text-white">
              KYRA
            </span>
            <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.2em] text-[#C8A15A]">
              Finanças
            </span>
          </span>
        </Link>

        <div className="min-w-0 flex-1">
          <nav
            className="mx-auto flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-white/12 bg-white/[0.035] p-1.5"
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
                  title={item.label}
                  className={[
                    "flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition-all sm:px-4 sm:text-sm",
                    active
                      ? "bg-[#F7F5EF] text-[#0D1B2A] shadow-sm"
                      : "text-white/72 hover:bg-white/8 hover:text-white",
                  ].join(" ")}
                >
                  <Icon
                    size={17}
                    strokeWidth={active ? 2.35 : 1.9}
                    className="shrink-0"
                  />
                  <span className="hidden md:inline lg:hidden xl:inline">
                    {item.compactLabel}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex min-w-[44px] shrink-0 justify-end lg:min-w-[132px]">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            aria-label="Sair da conta"
            title="Sair"
            className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/70 transition hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-100 disabled:opacity-50"
          >
            {loggingOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut size={17} />
            )}
            <span className="hidden lg:inline">Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
}
