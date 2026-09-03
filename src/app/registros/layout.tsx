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

  const statementActive = pathname === "/registros/extrato";
  const recurringActive = pathname === "/registros/recorrentes";
  const installmentsActive = pathname === "/registros/parcelamentos";
  const planningActive = pathname === "/registros/planejamentos";
  const movementsActive =
    !statementActive &&
    !recurringActive &&
    !installmentsActive &&
    !planningActive;

  const tabs = [
    { href: "/registros", label: "Movimentações", active: movementsActive },
    { href: "/registros/extrato", label: "Extrato", active: statementActive },
    { href: "/registros/recorrentes", label: "Recorrentes", active: recurringActive },
    { href: "/registros/parcelamentos", label: "Parcelamentos", active: installmentsActive },
    { href: "/registros/planejamentos", label: "Planejamentos", active: planningActive },
  ];

  return (
    <div className="space-y-6">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <nav
          className="mx-auto flex w-max rounded-2xl border border-[#0D1B2A]/10 bg-white p-1.5 shadow-sm"
          aria-label="Seções de movimentações"
        >
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={[
                "whitespace-nowrap rounded-xl px-5 py-2.5 text-sm font-semibold transition",
                tab.active
                  ? "bg-[#0D1B2A] text-white shadow-sm"
                  : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      {children}
    </div>
  );
}
