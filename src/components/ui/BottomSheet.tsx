"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[360] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-[#071321]/55 backdrop-blur-[2px]"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-[#0D1B2A]/10 bg-[#F7F5EF] shadow-2xl sm:max-w-lg sm:rounded-[28px]"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[#0D1B2A]/15 sm:hidden" />

        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#0D1B2A]/8 px-5 py-4">
          <h2 className="font-sans text-base font-semibold text-[#0D1B2A]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#0D1B2A] shadow-sm"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>

        {footer && (
          <footer
            className="shrink-0 border-t border-[#0D1B2A]/8 bg-white/90 px-5 py-3 backdrop-blur-xl"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
          >
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
}
