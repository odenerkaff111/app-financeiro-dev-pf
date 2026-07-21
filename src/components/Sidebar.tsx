"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesCombined, CircleDollarSign, Settings } from "lucide-react";

const links = [
  { href: "/", label: "Visão Geral", icon: ChartNoAxesCombined },
  { href: "/registros", label: "Movimentações", icon: CircleDollarSign },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[280px] shrink-0 border-r border-gray-200 bg-white px-5 py-6 md:block">
      <nav className="space-y-2">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={[
                "group flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition",
                isActive
                  ? "bg-blue-50 text-blue-600 border border-blue-200"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}



