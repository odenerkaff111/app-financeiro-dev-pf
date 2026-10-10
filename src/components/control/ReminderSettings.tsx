"use client";
/* eslint-disable @next/next/no-img-element -- Ephemeral QR must not be stored or proxied by the image optimizer. */

import {
  BellRing,
  Check,
  Clock3,
  MessageCircleMore,
  Plus,
  RefreshCw,
  Send,
  Smartphone,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useHousehold } from "@/contexts/HouseholdContext";
import { normalizeSlots } from "@/lib/control/core";
import { errorText, rpc, server, serverJson, rows } from "@/lib/control/client";
import {
  currentPushSubscription,
  isStandalonePwa,
  pushSupported,
  serializePushSubscription,
  subscribeBrowserPush,
} from "@/lib/push-client";
import { Alert, button, Field, input, panel, secondary } from "./FinanceControl";

type Settings = {
  times: string[];
  timezone: string;
  whatsapp_enabled: boolean;
  phone: string | null;
  consented_at: string | null;
  push_enabled?: boolean;
  push_consented_at?: string | null;
};

type WhatsAppState = {
  configured: boolean;
  connected: boolean;
  qr?: string;
  message?: string;
};

type Delivery = {
  id: string;
  day: string;
  slot: string;
  status: string;
  error_code: string | null;
  created_at: string;
};

type PushState = {
  configured: boolean;
  publicKey: string | null;
  enabled: boolean;
  consentedAt: string | null;
  subscriptions: Array<{
    id: string;
    device_label: string | null;
    last_seen_at: string;
    created_at: string;
  }>;
  message?: string;
};

type PushDelivery = Delivery & { device_label?: string | null };

const deliveryLabel: Record<string, string> = {
  sent: "Enviado",
  failed: "Falhou",
  unknown: "Resultado desconhecido",
  sending: "Enviando",
  skipped: "Dispensado",
};

const defaultTimes = ["08:00", "12:00", "18:00", "22:00"];

function deviceLabel() {
  if (typeof navigator === "undefined") return "Dispositivo";
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return ios ? `iPhone / ${isStandalonePwa() ? "PWA" : "Safari"}` : "Navegador / PWA";
}

function validReminderTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  return value >= "08:00" && value <= "22:00";
}

export function ReminderSettings() {
  const { household, canWrite } = useHousehold();
  const [times, setTimes] = useState<string[]>(defaultTimes);
  const [newTime, setNewTime] = useState("20:00");
  const [phone, setPhone] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [consent, setConsent] = useState(false);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [connection, setConnection] = useState<WhatsAppState | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [pushDeliveries, setPushDeliveries] = useState<PushDelivery[]>([]);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [browserSubscription, setBrowserSubscription] = useState<PushSubscription | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const sortedTimes = useMemo(() => normalizeSlots(times), [times]);

  const whatsappStatus = useCallback(async () => {
    try {
      const next = await server<WhatsAppState>("/api/whatsapp", household.id);
      setConnection((old) => ({
        ...next,
        qr: next.connected ? undefined : next.qr ?? old?.qr,
      }));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [household.id]);

  const loadPushStatus = useCallback(async () => {
    try {
      const [state, subscription] = await Promise.all([
        server<PushState>("/api/push", household.id),
        currentPushSubscription(),
      ]);
      setPushState(state);
      setBrowserSubscription(subscription);
      setStandalone(isStandalonePwa());
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [household.id]);

  const loadPushDeliveries = useCallback(async () => {
    try {
      const list = await rows<PushDelivery>("pf_push_outbox", household.id);
      setPushDeliveries(
        list.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30),
      );
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [household.id]);

  useEffect(() => {
    let active = true;

    void rpc<{ settings: Settings }>("pf_daily_state_v1", {
      p_household: household.id,
    })
      .then((result) => {
        if (!active || !result.settings) return;
        setTimes(normalizeSlots(result.settings.times));
        setTimezone(result.settings.timezone);
        setPhone(result.settings.phone ?? "");
        setEnabled(result.settings.whatsapp_enabled);
        setConsent(Boolean(result.settings.consented_at));
      })
      .catch((caught) => setError(errorText(caught)));

    void rows<Delivery>("pf_reminder_outbox", household.id)
      .then((list) => {
        if (active) {
          setDeliveries(
            list.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30),
          );
        }
      })
      .catch((caught) => setError(errorText(caught)));

    void whatsappStatus();

    if (pushSupported()) {
      void loadPushStatus();
      void loadPushDeliveries();
    } else {
      setStandalone(isStandalonePwa());
    }

    return () => {
      active = false;
    };
  }, [household.id, loadPushDeliveries, loadPushStatus, whatsappStatus]);

  useEffect(() => {
    if (!connection?.qr || connection.connected) return;
    const id = setInterval(() => void whatsappStatus(), 10000);
    return () => clearInterval(id);
  }, [connection?.qr, connection?.connected, whatsappStatus]);

  function addTime() {
    setError("");
    setMessage("");

    if (!validReminderTime(newTime)) {
      setError("Escolha um horário entre 08:00 e 22:00.");
      return;
    }

    if (times.includes(newTime)) {
      setError("Este horário já foi adicionado.");
      return;
    }

    setTimes(normalizeSlots([...times, newTime]));
  }

  function removeTime(value: string) {
    if (times.length <= 1) {
      setError("Mantenha pelo menos um horário de lembrete.");
      return;
    }
    setError("");
    setTimes((current) => current.filter((item) => item !== value));
  }

  function applyPreset(values: string[]) {
    setError("");
    setMessage("");
    setTimes(normalizeSlots(values));
  }

  async function saveSettings() {
    if (!canWrite || busy) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const normalized = normalizeSlots(times);
      if (!normalized.length || normalized.some((value) => !validReminderTime(value))) {
        throw new Error("Escolha pelo menos um horário entre 08:00 e 22:00.");
      }

      await rpc("pf_save_reminder_settings_v1", {
        p_household: household.id,
        p_times: normalized,
        p_timezone: timezone,
        p_whatsapp: enabled,
        p_phone: phone.replace(/\D/g, ""),
        p_consent: consent,
      });

      setTimes(normalized);
      setMessage("Agenda salva. As notificações usarão estes horários.");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await saveSettings();
  }

  async function whatsappAction(value: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await server<WhatsAppState>("/api/whatsapp", household.id, value);
      setConnection(result);
      setMessage(result.message ?? "Solicitação concluída.");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function activatePush() {
    if (!canWrite || pushBusy) return;
    setPushBusy(true);
    setError("");
    setMessage("");

    try {
      if (!pushSupported()) {
        throw new Error(
          "Este navegador não oferece Web Push. No iPhone, abra a ferramenta pelo ícone adicionado à Tela de Início.",
        );
      }

      const status = pushState;
      if (!status?.configured || !status.publicKey) {
        throw new Error("O Web Push ainda não foi configurado na Vercel.");
      }

      // No iPhone a solicitação de permissão precisa nascer diretamente do clique.
      const subscription = await subscribeBrowserPush(status.publicKey);
      const serialized = serializePushSubscription(subscription);
      const result = await serverJson<{ message: string }>("/api/push", household.id, {
        action: "subscribe",
        subscription: serialized,
        deviceLabel: deviceLabel(),
      });

      setBrowserSubscription(subscription);
      setMessage(result.message);
      await Promise.all([loadPushStatus(), loadPushDeliveries()]);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    if (!browserSubscription || pushBusy) return;
    setPushBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await serverJson<{ message: string }>("/api/push", household.id, {
        action: "test",
        endpoint: browserSubscription.endpoint,
      });
      setMessage(result.message);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    if (!browserSubscription || pushBusy) return;
    if (!confirm("Desativar notificações neste dispositivo?")) return;
    setPushBusy(true);
    setError("");
    setMessage("");

    try {
      const endpoint = browserSubscription.endpoint;
      const result = await serverJson<{ message: string }>("/api/push", household.id, {
        action: "unsubscribe",
        endpoint,
      });
      await browserSubscription.unsubscribe().catch(() => false);
      setBrowserSubscription(null);
      setMessage(result.message);
      await loadPushStatus();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="space-y-2">
        <Alert error={error} />
        {message && (
          <p role="status" className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </p>
        )}
      </div>

      <form className={panel} onSubmit={save}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0D1B2A] text-[#C8A15A]">
            <Clock3 size={19} />
          </div>
          <div>
            <h2 className="font-sans text-base font-semibold text-[#0D1B2A]">Agenda</h2>
            <p className="mt-0.5 text-xs text-[#3A3A3C]/55">
              A Kyra lembra você nos horários que escolher.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {sortedTimes.map((time) => (
            <div
              key={time}
              className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-[#0D1B2A]/8 bg-[#F7F5EF] px-4"
            >
              <div className="flex items-center gap-3">
                <BellRing size={17} className="text-[#9A773A]" />
                <span className="text-base font-semibold tabular-nums text-[#0D1B2A]">{time}</span>
              </div>
              <button
                type="button"
                onClick={() => removeTime(time)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#3A3A3C]/45 transition hover:bg-white hover:text-red-700"
                aria-label={`Remover horário ${time}`}
              >
                <X size={17} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="time"
            min="08:00"
            max="22:00"
            step="60"
            value={newTime}
            onChange={(event) => setNewTime(event.target.value)}
            className="h-11 min-w-0 flex-1 rounded-xl border border-[#0D1B2A]/12 bg-white px-3 text-sm font-semibold text-[#0D1B2A] outline-none focus:border-[#C8A15A]"
            aria-label="Novo horário"
          />
          <button
            type="button"
            onClick={addTime}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#0D1B2A]/12 bg-white px-4 text-sm font-semibold text-[#0D1B2A]"
          >
            <Plus size={17} />
            Adicionar
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 app-scrollbar-none">
          <button type="button" className={secondary} onClick={() => applyPreset(["21:00"])}>
            1x ao dia
          </button>
          <button type="button" className={secondary} onClick={() => applyPreset(defaultTimes)}>
            4x ao dia
          </button>
          <button
            type="button"
            className={secondary}
            onClick={() =>
              applyPreset(
                Array.from({ length: 15 }, (_, index) => `${String(index + 8).padStart(2, "0")}:00`),
              )
            }
          >
            De hora em hora
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Fuso horário">
            <select
              className={input}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              <option>America/Sao_Paulo</option>
              <option>America/Manaus</option>
              <option>America/Rio_Branco</option>
              <option>America/Fortaleza</option>
            </select>
          </Field>
          <button className={button} disabled={busy || !canWrite}>
            {busy ? "Salvando..." : "Salvar agenda"}
          </button>
        </div>
      </form>

      <section className={panel}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0D1B2A] text-[#C8A15A]">
              <Smartphone size={19} />
            </div>
            <div className="min-w-0">
              <h2 className="font-sans text-base font-semibold text-[#0D1B2A]">Notificações neste iPhone</h2>
              <p className="mt-0.5 text-xs text-[#3A3A3C]/55">
                Web Push do próprio app, sem expor dados financeiros na mensagem.
              </p>
            </div>
          </div>
          <span
            className={[
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold",
              browserSubscription
                ? "bg-emerald-50 text-emerald-700"
                : "bg-[#F7F5EF] text-[#3A3A3C]/60",
            ].join(" ")}
          >
            {browserSubscription && <Check size={12} />}
            {browserSubscription ? "Ativo" : "Inativo"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <StatusCell label="Servidor" value={pushState?.configured ? "Configurado" : "Pendente"} />
          <StatusCell label="Modo" value={standalone ? "App instalado" : "Navegador"} />
          <StatusCell label="Dispositivo" value={browserSubscription ? "Autorizado" : "Não autorizado"} />
          <StatusCell label="Ativos" value={String(pushState?.subscriptions.length ?? 0)} />
        </div>

        {!pushSupported() && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No iPhone, adicione a Kyra à Tela de Início pelo Safari e abra pelo novo ícone.
          </p>
        )}

        {pushSupported() &&
          !standalone &&
          /iPhone|iPad|iPod/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent) && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Abra a Kyra pelo ícone da Tela de Início para ativar notificações no iPhone.
            </p>
          )}

        <div className="mt-4 flex flex-wrap gap-2">
          {!browserSubscription ? (
            <button
              className={button}
              disabled={pushBusy || !canWrite || !pushSupported() || !pushState?.configured || !pushState.publicKey}
              onClick={() => void activatePush()}
            >
              {pushBusy ? "Ativando..." : "Ativar neste dispositivo"}
            </button>
          ) : (
            <>
              <button className={button} disabled={pushBusy || !canWrite} onClick={() => void testPush()}>
                <Send size={15} className="mr-1.5 inline" />
                {pushBusy ? "Enviando..." : "Testar notificação"}
              </button>
              <button className={secondary} disabled={pushBusy || !canWrite} onClick={() => void disablePush()}>
                Desativar
              </button>
            </>
          )}
          <button className={secondary} disabled={pushBusy || !pushSupported()} onClick={() => void loadPushStatus()}>
            <RefreshCw size={15} className="mr-1.5 inline" />
            Atualizar
          </button>
        </div>
      </section>

      <details className={panel}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F7F5EF] text-[#0D1B2A]">
              <BellRing size={18} />
            </div>
            <div>
              <h2 className="font-sans text-base font-semibold text-[#0D1B2A]">Histórico de notificações</h2>
              <p className="text-xs text-[#3A3A3C]/50">
                {pushDeliveries.length ? `${pushDeliveries.length} envio(s) recente(s)` : "Nenhum envio automático ainda"}
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold text-[#9A773A]">Ver</span>
        </summary>

        <div className="mt-4 space-y-2">
          {pushDeliveries.map((delivery) => (
            <div key={delivery.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#F7F5EF] px-3 py-2 text-xs">
              <span>{delivery.day} · {delivery.slot}</span>
              <span className="font-semibold">
                {deliveryLabel[delivery.status] ?? delivery.status}
                {delivery.error_code ? ` · ${delivery.error_code}` : ""}
              </span>
            </div>
          ))}
          {!pushDeliveries.length && (
            <p className="text-sm text-[#3A3A3C]/50">Nenhum push automático registrado ainda.</p>
          )}
        </div>
      </details>

      <details className={panel}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F7F5EF] text-[#0D1B2A]">
              <MessageCircleMore size={18} />
            </div>
            <div>
              <h2 className="font-sans text-base font-semibold text-[#0D1B2A]">WhatsApp</h2>
              <p className="text-xs text-[#3A3A3C]/50">Canal opcional</p>
            </div>
          </div>
          <span className="text-xs font-semibold text-[#9A773A]">Configurar</span>
        </summary>

        <div className="mt-5 space-y-4">
          <p className="text-sm text-[#3A3A3C]/60">
            O Web Push acima funciona sem WhatsApp. Use este canal somente se quiser uma segunda forma de lembrete.
          </p>

          <Field label="Telefone (país + DDD + número)">
            <input
              className={input}
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Receber também no WhatsApp
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            Autorizo o envio dos lembretes para este número. As mensagens não incluem saldos nem detalhes financeiros.
          </label>

          <p className="text-sm">
            {connection?.configured
              ? connection.connected
                ? "WhatsApp conectado."
                : "Evolution configurada; WhatsApp ainda não conectado."
              : "Infraestrutura externa não configurada."}
          </p>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !canWrite} className={button} onClick={() => void saveSettings()}>
              {busy ? "Salvando..." : "Salvar WhatsApp"}
            </button>
            <button type="button" disabled={busy || !canWrite || !connection?.configured} className={secondary} onClick={() => void whatsappAction("connect")}>
              Gerar QR code
            </button>
            <button type="button" disabled={busy || !canWrite || !connection?.connected} className={secondary} onClick={() => void whatsappAction("test")}>
              Testar
            </button>
            <button type="button" className={secondary} onClick={() => void whatsappStatus()}>
              Atualizar status
            </button>
          </div>

          {connection?.qr && !connection.connected && (
            <div>
              <p className="mb-2 text-sm">WhatsApp → Aparelhos conectados → Conectar aparelho.</p>
              <img
                src={connection.qr}
                alt="QR code temporário para conectar o WhatsApp"
                className="h-64 w-64 rounded-xl bg-white p-2"
                referrerPolicy="no-referrer"
              />
            </div>
          )}

          {deliveries.length > 0 && (
            <details className="rounded-xl border border-[#0D1B2A]/8 bg-[#F7F5EF] p-3">
              <summary className="cursor-pointer text-sm font-semibold">Últimos envios pelo WhatsApp</summary>
              <div className="mt-2 space-y-1 text-xs">
                {deliveries.map((delivery) => (
                  <p key={delivery.id}>
                    {delivery.day} {delivery.slot} · {deliveryLabel[delivery.status] ?? delivery.status}
                    {delivery.error_code ? ` · ${delivery.error_code}` : ""}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      </details>
    </div>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#F7F5EF] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-[#3A3A3C]/45">{label}</p>
      <p className="mt-0.5 truncate font-semibold text-[#0D1B2A]">{value}</p>
    </div>
  );
}
