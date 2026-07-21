"use client";

import Link from "next/link";
import {
  CircleDollarSign,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
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

export function AppDock() {
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

    return (
      pathname === item.href ||
      pathname.startsWith(`${item.href}/`)
    );
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
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex justify-center px-3 sm:bottom-6">
      <nav
        className="pointer-events-auto flex items-center gap-1.5 rounded-[24px] border border-[#C8A15A]/30 bg-[#0D1B2A]/95 p-2 shadow-[0_20px_60px_rgba(13,27,42,0.32)] backdrop-blur-2xl"
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
              aria-label={item.label}
              title={item.label}
              aria-current={active ? "page" : undefined}
              className={[
                "group relative flex h-12 w-12 items-center justify-center rounded-[16px] transition-all duration-200",
                "hover:-translate-y-1.5 hover:scale-105",
                active
                  ? "bg-[#F7F5EF] text-[#0D1B2A] shadow-[0_8px_22px_rgba(0,0,0,0.22)]"
                  : "text-[#F7F5EF]/75 hover:bg-white/10 hover:text-white",
              ].join(" ")}
            >
              <Icon
                size={21}
                strokeWidth={active ? 2.3 : 1.9}
              />

              {active && (
                <span className="absolute -bottom-1.5 h-1 w-1 rounded-full bg-[#C8A15A]" />
              )}

              <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#0D1B2A] px-2.5 py-1.5 text-[11px] font-medium text-[#F7F5EF] opacity-0 shadow-lg transition group-hover:opacity-100">
                {item.label}
              </span>
            </Link>
          );
        })}

        <div className="mx-1 h-7 w-px bg-[#C8A15A]/30" />

        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          aria-label="Sair da conta"
          title="Sair"
          className="group relative flex h-12 w-12 items-center justify-center rounded-[16px] text-[#F7F5EF]/75 transition-all duration-200 hover:-translate-y-1.5 hover:scale-105 hover:bg-red-500/15 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loggingOut ? (
            <Loader2 className="h-[21px] w-[21px] animate-spin" />
          ) : (
            <LogOut size={21} strokeWidth={1.9} />
          )}

          <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#0D1B2A] px-2.5 py-1.5 text-[11px] font-medium text-[#F7F5EF] opacity-0 shadow-lg transition group-hover:opacity-100">
            Sair
          </span>
        </button>
      </nav>
    </div>
  );
}