"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function RegistrosLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

  const recurringActive = pathname === "/registros/recorrentes";
  const planningActive = pathname === "/registros/planejamentos";
  const movementsActive = !recurringActive && !planningActive;

  return (
    <div className="space-y-6">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <nav
          className="mx-auto flex w-max rounded-2xl border border-[#0D1B2A]/10 bg-white p-1.5 shadow-sm"
          aria-label="Seções de movimentações"
        >
          <Link
            href="/registros"
            className={[
              "whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold transition",
              movementsActive
                ? "bg-[#0D1B2A] text-white shadow-sm"
                : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
            ].join(" ")}
          >
            Movimentações
          </Link>

          <Link
            href="/registros/recorrentes"
            className={[
              "whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold transition",
              recurringActive
                ? "bg-[#0D1B2A] text-white shadow-sm"
                : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
            ].join(" ")}
          >
            Recorrentes
          </Link>

          <Link
            href="/registros/planejamentos"
            className={[
              "whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold transition",
              planningActive
                ? "bg-[#0D1B2A] text-white shadow-sm"
                : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
            ].join(" ")}
          >
            Planejamentos
          </Link>
        </nav>
      </div>

      {children}
    </div>
  );
}