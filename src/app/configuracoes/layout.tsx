"use client";

import Link from "next/link";
import {
  BrainCircuit,
  Settings,
} from "lucide-react";
import {
  usePathname,
} from "next/navigation";
import type {
  ReactNode,
} from "react";
import {
  useHousehold,
} from "@/contexts/HouseholdContext";

export default function ConfiguracoesLayout({
  children,
}: {
  children:
    ReactNode;
}) {
  const pathname =
    usePathname();

  const {
    isAdmin,
  } =
    useHousehold();

  const aiActive =
    pathname ===
    "/configuracoes/ia";

  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <nav className="inline-flex max-w-full overflow-x-auto rounded-2xl border border-[#0D1B2A]/10 bg-white p-1.5 shadow-sm">
          <Link
            href="/configuracoes"
            className={[
              "inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
              !aiActive
                ? "bg-[#0D1B2A] text-white"
                : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF]",
            ].join(" ")}
          >
            <Settings
              size={16}
            />
            Geral
          </Link>

          {isAdmin && (
            <Link
              href="/configuracoes/ia"
              className={[
                "inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                aiActive
                  ? "bg-[#0D1B2A] text-white"
                  : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF]",
              ].join(" ")}
            >
              <BrainCircuit
                size={16}
              />
              Inteligência Artificial
            </Link>
          )}
        </nav>
      </div>

      {children}
    </div>
  );
}
