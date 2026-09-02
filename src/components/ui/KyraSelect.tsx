"use client";

import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type KyraSelectOption = {
  value: string;
  label: string;
  description?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: KyraSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

export function KyraSelect({
  value,
  onChange,
  options,
  placeholder = "Selecione",
  disabled = false,
  className = "",
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const gap = 8;
    const preferredHeight = Math.min(320, Math.max(120, options.length * 52 + 12));
    const spaceBelow = viewportHeight - rect.bottom - 16;
    const spaceAbove = rect.top - 16;
    const openUpwards = spaceBelow < Math.min(preferredHeight, 220) && spaceAbove > spaceBelow;
    const available = Math.max(120, openUpwards ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(preferredHeight, available);

    setMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      top: openUpwards
        ? Math.max(8, rect.top - maxHeight - gap)
        : Math.min(viewportHeight - maxHeight - 8, rect.bottom + gap),
      width: rect.width,
      maxHeight,
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleViewportChange = () => updateMenuPosition();

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updateMenuPosition]);

  const menu =
    open && menuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[1200] overflow-y-auto rounded-2xl border border-[#0D1B2A]/10 bg-white p-1.5 shadow-[0_22px_60px_rgba(13,27,42,0.22)]"
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
            }}
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={[
                    "flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition",
                    active
                      ? "bg-[#F7F5EF] text-[#0D1B2A]"
                      : "text-[#3A3A3C] hover:bg-[#F7F5EF]/75 hover:text-[#0D1B2A]",
                  ].join(" ")}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="mt-0.5 block text-[11px] leading-4 text-[#3A3A3C]/55">
                        {option.description}
                      </span>
                    )}
                  </span>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    {active && <Check size={15} className="text-[#C8A15A]" />}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        className={[
          "flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-[#0D1B2A]/15 bg-white px-4 text-left text-sm text-[#0D1B2A] outline-none transition",
          "hover:border-[#C8A15A]/70 focus:border-[#C8A15A] focus:ring-2 focus:ring-[#C8A15A]/15",
          disabled ? "cursor-not-allowed opacity-55" : "",
          className,
        ].join(" ")}
      >
        <span className={selected ? "truncate" : "truncate text-[#3A3A3C]/45"}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={17}
          className={[
            "shrink-0 text-[#C8A15A] transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>
      {menu}
    </>
  );
}
