"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartNoAxesCombined,
  CircleDollarSign,
  Settings,
  UserRound,
  WalletCards,
} from "lucide-react";

const links = [
  { href: "/", label: "Visão Geral", icon: ChartNoAxesCombined },
  { href: "/registros", label: "Movimentações", icon: CircleDollarSign },
  { href: "/clientes", label: "Pessoas", icon: UserRound },
  { href: "/produtos", label: "Categorias", icon: WalletCards },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[280px] shrink-0 border-r border-white/10 bg-white/[0.05] px-5 py-6 backdrop-blur-2xl md:block">
      <div className="mb-10 rounded-[28px] border border-white/10 bg-white/[0.07] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-200/70">
          Financeiro
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
          Kyra
        </h2>
        <p className="mt-2 text-xs leading-5 text-white/50">
          Controle pessoal moderno, simples e direto.
        </p>
      </div>

      <nav className="space-y-2">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={[
                "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition",
                isActive
                  ? "bg-gradient-to-r from-fuchsia-600/80 to-cyan-500/80 text-white shadow-[0_14px_35px_rgba(34,211,238,0.18)]"
                  : "text-white/58 hover:bg-white/[0.08] hover:text-white",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="absolute bottom-6 left-5 right-5 rounded-[24px] border border-white/10 bg-black/15 p-4 text-xs text-white/45">
        <p className="font-medium text-white/70">Modo PF</p>
        <p className="mt-1 leading-5">Organize entradas, saídas e metas pessoais.</p>
      </div>
    </aside>
  );
}

