"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronUp, CreditCard, Loader2 } from "lucide-react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, toNumber } from "@/lib/financial-engine";

type InstallmentTransaction = {
  id: string;
  description: string;
  merchant: string | null;
  amount: number | string;
  status: string;
  due_date: string | null;
  paid_at: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  metadata: Record<string, unknown> | null;
};

type Group = {
  id: string;
  description: string;
  merchant: string | null;
  cardHolder: string | null;
  institution: string | null;
  totalAmount: number;
  installmentTotal: number;
  paidCount: number;
  nextDueDate: string | null;
  firstDueDate: string | null;
  rows: InstallmentTransaction[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function InstallmentPurchasesPanel() {
  const { household, canWrite } = useHousehold();
  const [rows, setRows] = useState<InstallmentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [firstDueDate, setFirstDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await supabase
      .from("pf_transactions")
      .select(
        "id, description, merchant, amount, status, due_date, paid_at, installment_group_id, installment_number, installment_total, metadata",
      )
      .eq("household_id", household.id)
      .not("installment_group_id", "is", null)
      .order("due_date", { ascending: true });

    if (result.error) {
      setError(result.error.message);
      setRows([]);
    } else {
      setRows((result.data ?? []) as InstallmentTransaction[]);
    }

    setLoading(false);
  }, [household.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, InstallmentTransaction[]>();

    for (const row of rows) {
      if (!row.installment_group_id) continue;
      const current = map.get(row.installment_group_id) ?? [];
      current.push(row);
      map.set(row.installment_group_id, current);
    }

    return [...map.entries()]
      .map(([id, items]) => {
        const ordered = [...items].sort(
          (a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0),
        );
        const first = ordered[0];
        const metadata = first?.metadata ?? {};
        const pending = ordered.find((item) => item.status !== "paid");

        return {
          id,
          description: first?.description ?? "Compra parcelada",
          merchant: first?.merchant ?? null,
          cardHolder:
            typeof metadata.card_holder === "string" ? metadata.card_holder : null,
          institution:
            typeof metadata.card_institution === "string"
              ? metadata.card_institution
              : null,
          totalAmount: ordered.reduce((sum, item) => sum + toNumber(item.amount), 0),
          installmentTotal: first?.installment_total ?? ordered.length,
          paidCount: ordered.filter((item) => item.status === "paid").length,
          nextDueDate: pending?.due_date ?? null,
          firstDueDate: first?.due_date ?? null,
          rows: ordered,
        };
      })
      .sort((a, b) => (a.nextDueDate ?? "9999").localeCompare(b.nextDueDate ?? "9999"));
  }, [rows]);

  async function saveSchedule(group: Group) {
    if (!canWrite || !firstDueDate) return;
    setSaving(true);
    setError(null);

    const result = await supabase.rpc("pf_update_installment_schedule_v1", {
      target_household_id: household.id,
      target_installment_group_id: group.id,
      new_first_due_date: firstDueDate,
    });

    if (result.error) {
      setError(result.error.message);
    } else {
      setEditing(null);
      setFirstDueDate("");
      window.dispatchEvent(new Event("pf:financial-data-changed"));
      await load();
    }

    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-3xl border border-[#0D1B2A]/10 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-[#C8A15A]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-3xl border border-[#0D1B2A]/10 bg-white p-8 text-center text-sm text-[#3A3A3C]/60">
          Nenhuma compra parcelada registrada ainda.
        </div>
      ) : (
        groups.map((group) => {
          const isExpanded = expanded === group.id;
          const isEditing = editing === group.id;
          const remaining = Math.max(group.installmentTotal - group.paidCount, 0);

          return (
            <section
              key={group.id}
              className="overflow-hidden rounded-3xl border border-[#0D1B2A]/10 bg-white shadow-sm"
            >
              <div className="grid gap-4 p-5 md:grid-cols-[1.6fr_.8fr_.8fr_auto] md:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <CreditCard size={17} className="text-[#C8A15A]" />
                    <h2 className="font-semibold text-[#0D1B2A]">{group.description}</h2>
                  </div>
                  <p className="mt-1 text-xs text-[#3A3A3C]/55">
                    {[group.merchant, group.cardHolder, group.institution]
                      .filter(Boolean)
                      .join(" · ") || "Cartão não informado"}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#3A3A3C]/45">
                    Compra total
                  </p>
                  <p className="mt-1 font-semibold text-[#0D1B2A]">
                    {formatCurrency(group.totalAmount)}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#3A3A3C]/45">
                    Situação
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#0D1B2A]">
                    {remaining} de {group.installmentTotal} parcelas restantes
                  </p>
                  <p className="text-xs text-[#3A3A3C]/55">
                    Próxima: {formatDate(group.nextDueDate)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : group.id)}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#0D1B2A]/10 px-4 text-sm font-semibold text-[#0D1B2A] hover:bg-[#F7F5EF]"
                >
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {isExpanded ? "Fechar" : "Ver parcelas"}
                </button>
              </div>

              {isExpanded && (
                <div className="border-t border-[#0D1B2A]/8 bg-[#F7F5EF]/60 p-5">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-[#3A3A3C]/55">
                        Primeiro vencimento atual: {formatDate(group.firstDueDate)}
                      </p>
                      <p className="mt-1 text-xs text-[#3A3A3C]/55">
                        Ajustar esta data desloca todo o parcelamento, evitando duas parcelas no mesmo mês.
                      </p>
                    </div>

                    {canWrite && !isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(group.id);
                          setFirstDueDate(group.firstDueDate ?? "");
                        }}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#0D1B2A] px-4 text-xs font-semibold text-white"
                      >
                        <CalendarDays size={14} />
                        Ajustar 1º vencimento
                      </button>
                    )}
                  </div>

                  {isEditing && (
                    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-[#C8A15A]/25 bg-white p-4">
                      <label className="min-w-56 flex-1">
                        <span className="mb-1.5 block text-xs font-semibold text-[#0D1B2A]">
                          Novo primeiro vencimento
                        </span>
                        <input
                          type="date"
                          value={firstDueDate}
                          onChange={(event) => setFirstDueDate(event.target.value)}
                          className="h-11 w-full rounded-xl border border-[#0D1B2A]/12 bg-white px-3 text-sm outline-none focus:border-[#C8A15A]"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void saveSchedule(group)}
                        disabled={saving || !firstDueDate}
                        className="h-11 rounded-xl bg-[#0D1B2A] px-5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {saving ? "Salvando..." : "Reorganizar parcelas"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="h-11 rounded-xl border border-[#0D1B2A]/10 px-4 text-sm font-semibold"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="text-[10px] uppercase tracking-wider text-[#3A3A3C]/45">
                        <tr>
                          <th className="pb-2">Parcela</th>
                          <th className="pb-2">Vencimento</th>
                          <th className="pb-2">Valor</th>
                          <th className="pb-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((item) => (
                          <tr key={item.id} className="border-t border-[#0D1B2A]/7">
                            <td className="py-3 font-medium text-[#0D1B2A]">
                              {item.installment_number}/{item.installment_total}
                            </td>
                            <td className="py-3 text-[#3A3A3C]/70">{formatDate(item.due_date)}</td>
                            <td className="py-3 font-semibold text-[#0D1B2A]">
                              {formatCurrency(toNumber(item.amount))}
                            </td>
                            <td className="py-3">
                              <span
                                className={[
                                  "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                                  item.status === "paid"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-amber-50 text-amber-700",
                                ].join(" ")}
                              >
                                {item.status === "paid" ? "Pago" : "A pagar"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
