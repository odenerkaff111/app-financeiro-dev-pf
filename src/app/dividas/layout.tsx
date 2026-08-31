"use client";

import Link from "next/link";
import { CreditCard, HandCoins, Landmark } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const items = [
  {
    href: "/dividas",
    label: "Pessoais",
    icon: HandCoins,
    exact: true,
  },
  {
    href: "/dividas/outras",
    label: "Outras dívidas",
    icon: Landmark,
  },
  {
    href: "/dividas/cartoes-terceiros",
    label: "Cartões de terceiros",
    icon: CreditCard,
  },
];

export default function DividasLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <nav className="flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-[#0D1B2A]/10 bg-white p-1.5 shadow-sm">
          {items.map((item) => {
            const Icon = item.icon;
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                  active
                    ? "bg-[#0D1B2A] text-white"
                    : "text-[#3A3A3C]/65 hover:bg-[#F7F5EF] hover:text-[#0D1B2A]",
                ].join(" ")}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}
