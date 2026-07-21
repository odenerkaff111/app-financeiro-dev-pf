"use client";

import Image from "next/image";
import { useHousehold } from "@/contexts/HouseholdContext";

export function AppHeader() {
  const { household } = useHousehold();

  const roleLabel =
    household.role === "owner"
      ? "Administrador da família"
      : household.role === "viewer"
        ? "Visualização"
        : "Membro da família";

  return (
    <header className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-6 px-4 pb-2 pt-5 sm:px-6 sm:pt-7 lg:px-8">
      <div className="flex min-w-0 items-center gap-5">
        <a
          href="/"
          aria-label="Ir para a visão geral"
          className="flex shrink-0 items-center"
        >
          <Image
            src="/brand/grupo-umso-logo.png"
            alt="Grupo Umsó"
            width={300}
            height={190}
            priority
            className="h-[68px] w-auto object-contain sm:h-[82px]"
          />
        </a>

        <div className="hidden h-12 w-px bg-[#C8A15A]/40 sm:block" />

        <div className="hidden min-w-0 sm:block">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#C8A15A]">
            Minhas Finanças
          </p>

          <h1 className="mt-1 truncate font-serif text-2xl font-semibold text-[#0D1B2A] lg:text-3xl">
            {household.name}
          </h1>
        </div>
      </div>

      <div className="hidden text-right md:block">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0D1B2A]">
          Patrimônio familiar
        </p>

        <p className="mt-1 text-xs text-[#3A3A3C]/65">
          {roleLabel}
        </p>
      </div>
    </header>
  );
}