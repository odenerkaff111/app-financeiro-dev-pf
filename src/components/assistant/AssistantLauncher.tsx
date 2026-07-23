"use client";

import { Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FinancialAssistant } from "./FinancialAssistant";

export function AssistantLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (pathname?.startsWith("/assistente")) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group fixed bottom-24 right-4 z-[110] flex h-14 w-14 items-center justify-center rounded-2xl border border-[#C8A15A]/40 bg-[#0D1B2A] text-[#C8A15A] shadow-[0_18px_45px_rgba(13,27,42,0.30)] transition hover:-translate-y-1 hover:scale-105 sm:bottom-28 sm:right-6"
        aria-label="Abrir assistente financeiro"
        title="Assistente financeiro"
      >
        <Sparkles size={22} />
        <span className="absolute right-0 top-0 h-3 w-3 -translate-y-1/3 translate-x-1/3 rounded-full border-2 border-[#F7F5EF] bg-emerald-500" />
        <span className="pointer-events-none absolute -top-10 right-0 whitespace-nowrap rounded-lg bg-[#0D1B2A] px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100">
          Conversar com a IA
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[130]">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[#0D1B2A]/55 backdrop-blur-sm"
            aria-label="Fechar assistente"
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-xl overflow-hidden border-l border-[#C8A15A]/25 bg-white shadow-2xl">
            <FinancialAssistant
              variant="drawer"
              onClose={() => setOpen(false)}
            />
          </aside>
        </div>
      )}
    </>
  );
}
