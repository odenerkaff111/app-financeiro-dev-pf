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

  const recurringActive =
    pathname === "/registros/recorrentes";

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <nav
          className="inline-flex rounded-2xl border border-[#0D1B2A]/10 bg-white p-1.5 shadow-sm"
          aria-label="SeÃ§Ãµes de movimentaÃ§Ãµes"
        >
          <Link
            href="/registros"
            className={[
              "rounded-xl px-5 py-2.5 text-sm font-semibold transition",
              !recurringActive
                ? "bg-[#0D1B2A] text-white shadow-sm"
                : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
            ].join(" ")}
          >
            MovimentaÃ§Ãµes
          </Link>

          <Link
            href="/registros/recorrentes"
            className={[
              "rounded-xl px-5 py-2.5 text-sm font-semibold transition",
              recurringActive
                ? "bg-[#0D1B2A] text-white shadow-sm"
                : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
            ].join(" ")}
          >
            Recorrentes
          </Link>
        </nav>
      </div>

      {children}
    </div>
  );
}