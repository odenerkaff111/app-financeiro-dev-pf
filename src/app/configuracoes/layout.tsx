"use client";

import Link from "next/link";
import {
  BellRing,
  BrainCircuit,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useHousehold } from "@/contexts/HouseholdContext";

type SettingsTab = {
  href: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const tabs: SettingsTab[] = [
  {
    href: "/configuracoes",
    label: "Geral",
    shortLabel: "Geral",
    icon: Settings,
  },
  {
    href: "/configuracoes/lembretes",
    label: "Lembretes e notificações",
    shortLabel: "Lembretes",
    icon: BellRing,
  },
  {
    href: "/configuracoes/ia",
    label: "Inteligência Artificial",
    shortLabel: "IA",
    icon: BrainCircuit,
    adminOnly: true,
  },
];

export default function ConfiguracoesLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { isAdmin } = useHousehold();

  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <div className="space-y-4">
      <div className="-mx-1 overflow-x-auto px-1 pb-1 app-scrollbar-none">
        <nav
          className="mx-auto grid w-max min-w-full grid-flow-col auto-cols-fr gap-1 rounded-2xl border border-[#0D1B2A]/10 bg-white p-1.5 shadow-sm sm:min-w-0"
          aria-label="Configurações"
        >
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = pathname === tab.href;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "inline-flex min-h-11 min-w-[104px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition sm:min-w-[140px] sm:text-sm",
                  active
                    ? "bg-[#0D1B2A] text-white shadow-sm"
                    : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
                ].join(" ")}
              >
                <Icon size={16} className="shrink-0" />
                <span className="sm:hidden">{tab.shortLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}
