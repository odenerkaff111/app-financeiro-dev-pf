"use client";
import { UpcomingObligations } from "@/components/dashboard/UpcomingObligations";
import { CardStatementsPanel, LoansPanel } from "@/components/control/FinanceControl";
export default function Page(){return <div className="space-y-5"><header><h1 className="text-2xl font-semibold">Proximas obrigacoes</h1><p className="mt-2 text-sm text-slate-600">Faturas, contas a pagar e valores a receber. As compras dos seus cartoes aparecem agrupadas nas faturas, sem duplicar obrigacoes.</p></header><CardStatementsPanel/><UpcomingObligations/><LoansPanel/></div>;}
