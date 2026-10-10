"use client";

import { ArrowUpRight, Banknote, CreditCard, Landmark, PiggyBank, Wallet } from "lucide-react";
import { type DashboardAccount } from "@/lib/dashboard/summary";

type Props = {
  banks: DashboardAccount[];
  cards: DashboardAccount[];
  reserves: DashboardAccount[];
  availableCash: number;
  totalInvested: number;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const displayMoney = (value: number) => brl.format(value);

function bankVisual(name: string) {
  const normalized = name.toLocaleLowerCase("pt-BR");
  if (normalized.includes("nubank")) {
    return { name: "Nubank", initials: "Nu", color: "bg-[#820AD1] text-white" };
  }
  if (normalized.includes("itaú") || normalized.includes("itau")) {
    return { name: "Itaú", initials: "I", color: "bg-[#F58B21] text-white" };
  }
  if (normalized.includes("santander")) {
    return { name: "Santander", initials: "S", color: "bg-[#E11919] text-white" };
  }
  if (/\bc6\b/i.test(name)) {
    return { name: "C6 Bank", initials: "C6", color: "bg-[#0D1B2A] text-white" };
  }
  if (normalized.includes("dinheiro") || normalized.includes("espécie") || normalized.includes("especie")) {
    return { name: "Em espécie", initials: "R$", color: "bg-[#E9E5D7] text-[#0D1B2A]" };
  }
  return { name: name.split(" - ")[0] || name, initials: "B", color: "bg-[#E6EBEF] text-[#0D1B2A]" };
}

function moneySum(accounts: DashboardAccount[]) {
  return accounts.reduce((total, account) => total + Math.round(Number(account.balance) * 100), 0) / 100;
}

export function BankBalanceOverview({ banks, cards, reserves, availableCash, totalInvested }: Props) {
  const personal = moneySum(banks.filter((account) => account.account_scope !== "business"));
  const business = moneySum(banks.filter((account) => account.account_scope === "business"));
  // Cartoes de terceiros nao representam credito proprio disponivel.
  const ownCards = cards.filter((account) => !/vanda|emprestad[oa]/i.test(account.name));
  const cardsWithLimit = ownCards.filter((account) => account.available_credit != null);
  const unknownLimitCount = ownCards.length - cardsWithLimit.length;
  const credit = cardsWithLimit.reduce((total, account) => total + Math.round(Number(account.available_credit) * 100), 0) / 100;
  const cardsLabel = cardsWithLimit.length === 0 ? "Não informado" : displayMoney(credit);

  const orderedBanks = [...banks].sort((a, b) => {
    const accountScope = Number(a.account_scope === "business") - Number(b.account_scope === "business");
    if (accountScope) return accountScope;
    return Number(b.balance) - Number(a.balance);
  });

  return (
    <section aria-label="Saldos por conta" className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(255px,0.82fr)_minmax(0,2fr)]">
        <div className="relative flex min-h-[198px] flex-col justify-between overflow-hidden rounded-[22px] bg-[#0D1B2A] p-5 text-white shadow-[0_12px_32px_rgba(13,27,42,0.14)] sm:p-6">
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full border-[36px] border-white/[0.045]" />
          <div className="relative flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium text-white/70">Saldo consolidado em contas</p>
            <span className="rounded-xl border border-white/10 bg-white/10 p-2"><Wallet size={17} aria-hidden="true" /></span>
          </div>
          <div className="relative my-4">
            <p className="break-words text-[clamp(1.65rem,3vw,2.2rem)] font-semibold tracking-[-0.055em] tabular-nums leading-tight">{displayMoney(availableCash)}</p>
            <p className="mt-2 text-[11px] text-white/60">PF e PJ somados · sem cartões ou reservas</p>
          </div>
          <div className="relative flex flex-wrap gap-x-4 gap-y-1 border-t border-white/15 pt-3 text-[11px] text-white/75">
            <span>PF <strong className="ml-1 font-semibold text-white tabular-nums">{displayMoney(personal)}</strong></span>
            <span>PJ <strong className="ml-1 font-semibold text-white tabular-nums">{displayMoney(business)}</strong></span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {orderedBanks.map((account) => {
            const visual = bankVisual(account.name);
            return (
              <article key={account.id} className="flex min-h-[105px] flex-col justify-between rounded-[20px] border border-[#0D1B2A]/[0.085] bg-[#FBFAF7] p-3.5 transition-colors hover:bg-white sm:p-4">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden="true" className={["flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-[12px] font-extrabold tracking-tight", visual.color].join(" ")}>{visual.initials}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-[#0D1B2A]" title={account.name}>{visual.name}</p>
                    <p className="text-[10px] text-[#3A3A3C]/55">{account.account_scope === "business" ? "Conta PJ" : account.type === "cash" ? "Dinheiro físico" : "Conta PF"}</p>
                  </div>
                </div>
                <p className="mt-3 break-words text-[clamp(0.94rem,1.5vw,1.17rem)] font-semibold tracking-[-0.035em] tabular-nums text-[#0D1B2A]">{displayMoney(Number(account.balance))}</p>
              </article>
            );
          })}
          {orderedBanks.length === 0 && (
            <div className="col-span-full flex items-center gap-2 rounded-2xl border border-[#0D1B2A]/10 p-4 text-sm text-[#3A3A3C]/65"><Landmark size={18}/>Nenhuma conta ativa cadastrada</div>
          )}
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#0D1B2A]/[0.085] bg-white px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EAF1FA] text-[#345D99]"><CreditCard size={19} aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[#3A3A3C]/60">Crédito disponível · cartões próprios</p>
            <p className="text-[17px] font-semibold tabular-nums tracking-tight text-[#0D1B2A]">{cardsLabel}</p>
            {unknownLimitCount > 0 && <p className="text-[10px] text-[#3A3A3C]/55">{unknownLimitCount} {unknownLimitCount === 1 ? "cartão sem limite informado" : "cartões sem limite informado"}</p>}
          </div>
          <ArrowUpRight className="text-[#0D1B2A]/25" size={17} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#0D1B2A]/[0.085] bg-white px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ECF6EB] text-[#447A52]"><PiggyBank size={19} aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[#3A3A3C]/60">Caixinhas e investimentos</p>
            <p className="text-[17px] font-semibold tabular-nums tracking-tight text-[#0D1B2A]">{displayMoney(totalInvested)}</p>
            <p className="text-[10px] text-[#3A3A3C]/55">{reserves.length} {reserves.length === 1 ? "reserva ativa" : "reservas ativas"} · fora do saldo em contas</p>
          </div>
          <Banknote className="text-[#0D1B2A]/25" size={17} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
