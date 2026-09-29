'use client';
/* eslint-disable @next/next/no-img-element -- Ephemeral QR must not be stored or proxied by the image optimizer. */
import { normalizeSlots } from '@/lib/control/core';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { errorText, rpc, server, serverJson, rows } from '@/lib/control/client';
import {
  currentPushSubscription,
  isStandalonePwa,
  pushSupported,
  serializePushSubscription,
  subscribeBrowserPush,
} from '@/lib/push-client';
import { Alert, button, Field, input, panel, secondary } from './FinanceControl';

type Settings = {
  times: string[];
  timezone: string;
  whatsapp_enabled: boolean;
  phone: string | null;
  consented_at: string | null;
  push_enabled?: boolean;
  push_consented_at?: string | null;
};

type WhatsAppState = { configured: boolean; connected: boolean; qr?: string; message?: string };
type Delivery = { id: string; day: string; slot: string; status: string; error_code: string | null; created_at: string };
type PushState = {
  configured: boolean;
  publicKey: string | null;
  enabled: boolean;
  consentedAt: string | null;
  subscriptions: Array<{ id: string; device_label: string | null; last_seen_at: string; created_at: string }>;
  message?: string;
};

type PushDelivery = Delivery & { device_label?: string | null };

const deliveryLabel: Record<string, string> = {
  sent: 'Enviado',
  failed: 'Falhou',
  unknown: 'Resultado desconhecido',
  sending: 'Enviando',
  skipped: 'Dispensado',
};

function deviceLabel() {
  if (typeof navigator === 'undefined') return 'Dispositivo';
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return ios ? `iPhone / ${isStandalonePwa() ? 'PWA' : 'Safari'}` : 'Navegador / PWA';
}

export function ReminderSettings() {
  const { household, canWrite } = useHousehold();
  const [times, setTimes] = useState('08:00, 12:00, 18:00, 22:00');
  const [phone, setPhone] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [consent, setConsent] = useState(false);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [connection, setConnection] = useState<WhatsAppState | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [pushDeliveries, setPushDeliveries] = useState<PushDelivery[]>([]);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [browserSubscription, setBrowserSubscription] = useState<PushSubscription | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const whatsappStatus = useCallback(async () => {
    try {
      const next = await server<WhatsAppState>('/api/whatsapp', household.id);
      setConnection((old) => ({ ...next, qr: next.connected ? undefined : next.qr ?? old?.qr }));
    } catch (e) {
      setError(errorText(e));
    }
  }, [household.id]);

  const loadPushStatus = useCallback(async () => {
    try {
      const [state, subscription] = await Promise.all([
        server<PushState>('/api/push', household.id),
        currentPushSubscription(),
      ]);
      setPushState(state);
      setBrowserSubscription(subscription);
      setStandalone(isStandalonePwa());
    } catch (e) {
      setError(errorText(e));
    }
  }, [household.id]);

  const loadPushDeliveries = useCallback(async () => {
    try {
      const list = await rows<PushDelivery>('pf_push_outbox', household.id);
      setPushDeliveries(list.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30));
    } catch (e) {
      setError(errorText(e));
    }
  }, [household.id]);

  useEffect(() => {
    let active = true;
    void rpc<{ settings: Settings }>('pf_daily_state_v1', { p_household: household.id }).then((result) => {
      if (active && result.settings) {
        setTimes(result.settings.times.join(', '));
        setTimezone(result.settings.timezone);
        setPhone(result.settings.phone ?? '');
        setEnabled(result.settings.whatsapp_enabled);
        setConsent(Boolean(result.settings.consented_at));
      }
    }).catch((e) => setError(errorText(e)));
    void rows<Delivery>('pf_reminder_outbox', household.id).then((list) => {
      if (active) setDeliveries(list.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30));
    }).catch((e) => setError(errorText(e)));
    void whatsappStatus();
    if (pushSupported()) {
      void loadPushStatus();
      void loadPushDeliveries();
    } else setStandalone(isStandalonePwa());
    return () => { active = false; };
  }, [household.id, loadPushDeliveries, loadPushStatus, whatsappStatus]);

  useEffect(() => {
    if (!connection?.qr || connection.connected) return;
    const id = setInterval(() => void whatsappStatus(), 10000);
    return () => clearInterval(id);
  }, [connection?.qr, connection?.connected, whatsappStatus]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await rpc('pf_save_reminder_settings_v1', {
        p_household: household.id,
        p_times: normalizeSlots(times.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean)),
        p_timezone: timezone,
        p_whatsapp: enabled,
        p_phone: phone.replace(/\D/g, ''),
        p_consent: consent,
      });
      setMessage('Horarios salvos. Web Push e WhatsApp usam esta mesma agenda.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function whatsappAction(value: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await server<WhatsAppState>('/api/whatsapp', household.id, value);
      setConnection(result);
      setMessage(result.message ?? 'Solicitacao concluida.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function activatePush() {
    if (!canWrite || pushBusy) return;
    setPushBusy(true);
    setError('');
    setMessage('');
    try {
      if (!pushSupported()) throw new Error('Este navegador nao oferece Web Push. No iPhone, abra a ferramenta pelo icone adicionado a Tela de Inicio.');
      const status = pushState;
      if (!status?.configured || !status.publicKey) throw new Error('O Web Push ainda nao foi configurado na Vercel. Atualize o status depois de publicar as chaves desta atualizacao.');
      // No iPhone a solicitacao de permissao precisa nascer diretamente do clique.
      // Nao coloque nenhuma chamada de rede antes de subscribeBrowserPush().
      const subscription = await subscribeBrowserPush(status.publicKey);
      const serialized = serializePushSubscription(subscription);
      const result = await serverJson<{ message: string }>('/api/push', household.id, {
        action: 'subscribe',
        subscription: serialized,
        deviceLabel: deviceLabel(),
      });
      setBrowserSubscription(subscription);
      setMessage(result.message);
      await Promise.all([loadPushStatus(), loadPushDeliveries()]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    if (!browserSubscription || pushBusy) return;
    setPushBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await serverJson<{ message: string }>('/api/push', household.id, {
        action: 'test',
        endpoint: browserSubscription.endpoint,
      });
      setMessage(result.message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    if (!browserSubscription || pushBusy) return;
    if (!confirm('Desativar notificacoes neste dispositivo?')) return;
    setPushBusy(true);
    setError('');
    setMessage('');
    try {
      const endpoint = browserSubscription.endpoint;
      const result = await serverJson<{ message: string }>('/api/push', household.id, { action: 'unsubscribe', endpoint });
      await browserSubscription.unsubscribe().catch(() => false);
      setBrowserSubscription(null);
      setMessage(result.message);
      await loadPushStatus();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className={panel}>
        <h1 className="text-2xl font-semibold">Lembretes e confirmacao diaria</h1>
        <p className="mt-2 text-sm text-slate-600">Escolha horarios entre 08:00 e 22:00. Cada horario abre uma nova conferencia. O popup aparece tambem na primeira entrada de cada dia.</p>
        <div className="my-4 space-y-2">
          <Alert error={error}/>
          {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm">{message}</p>}
        </div>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={save}>
          <Field label="Horarios separados por virgula"><input required className={input} value={times} onChange={(e) => setTimes(e.target.value)}/></Field>
          <Field label="Fuso horario"><select className={input} value={timezone} onChange={(e) => setTimezone(e.target.value)}><option>America/Sao_Paulo</option><option>America/Manaus</option><option>America/Rio_Branco</option><option>America/Fortaleza</option></select></Field>
          <div className="flex flex-wrap gap-2 md:col-span-2"><button type="button" className={secondary} onClick={() => setTimes('21:00')}>1 vez ao dia</button><button type="button" className={secondary} onClick={() => setTimes('08:00, 12:00, 18:00, 22:00')}>4 horarios</button><button type="button" className={secondary} onClick={() => setTimes(Array.from({ length: 15 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`).join(', '))}>De hora em hora</button></div>
          <Field label="Telefone que recebe o lembrete (pais + DDD + numero)"><input className={input} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel"/></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}/>Receber tambem no WhatsApp</label>
          <label className="flex items-start gap-2 text-sm md:col-span-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}/>Autorizo o envio dos lembretes para este numero. As mensagens nao incluem saldos nem detalhes financeiros.</label>
          <div><button className={button} disabled={busy || !canWrite}>Salvar horarios</button></div>
        </form>
      </section>

      <section className={panel}>
        <h2 className="text-xl font-semibold">Notificacoes no iPhone / PWA</h2>
        <p className="mt-2 text-sm text-slate-600">Receba o lembrete como notificacao do proprio aplicativo, sem WhatsApp ou SMS. A mensagem nao inclui valores, compras ou dividas.</p>
        <div className="mt-4 rounded-xl bg-[#F7F5EF] p-4 text-sm">
          <p><strong>Servidor:</strong> {pushState?.configured ? 'Web Push configurado' : 'aguardando chaves Web Push'}</p>
          <p><strong>Este dispositivo:</strong> {browserSubscription ? 'notificacoes ativas' : 'nao ativado'}</p>
          <p><strong>Modo aplicativo:</strong> {standalone ? 'aberto pela Tela de Inicio' : 'navegador comum'}</p>
          {pushState && <p><strong>Dispositivos ativos:</strong> {pushState.subscriptions.length}</p>}
        </div>
        {!pushSupported() && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Neste navegador o Web Push nao esta disponivel. No iPhone, use Safari → Compartilhar → Adicionar a Tela de Inicio e abra pelo novo icone.</p>}
        {pushSupported() && !standalone && /iPhone|iPad|iPod/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent) && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">No iPhone, a permissao de push funciona para o web app aberto pela Tela de Inicio. Se este atalho foi criado antes da atualizacao PWA, remova-o e adicione novamente depois do deploy.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {!browserSubscription ? <button className={button} disabled={pushBusy || !canWrite || !pushSupported() || !pushState?.configured || !pushState.publicKey} onClick={() => void activatePush()}>{pushBusy ? 'Ativando...' : 'Ativar notificacoes neste dispositivo'}</button> : <>
            <button className={button} disabled={pushBusy || !canWrite} onClick={() => void testPush()}>{pushBusy ? 'Enviando...' : 'Enviar notificacao de teste'}</button>
            <button className={secondary} disabled={pushBusy || !canWrite} onClick={() => void disablePush()}>Desativar neste dispositivo</button>
          </>}
          <button className={secondary} disabled={pushBusy || !pushSupported()} onClick={() => void loadPushStatus()}>Atualizar status</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">O push usa os horarios salvos acima. Se voce ja confirmou a conferencia depois daquele horario, a notificacao correspondente e dispensada.</p>
      </section>

      <section className={panel}>
        <h2 className="text-xl font-semibold">Ultimos envios por notificacao</h2>
        <p className="my-2 text-xs text-slate-500">Cada dispositivo recebe no maximo uma tentativa por horario. Assinaturas expiradas sao desativadas automaticamente.</p>
        {pushDeliveries.map((delivery) => <p className="border-t py-2 text-sm" key={delivery.id}>{delivery.day} {delivery.slot} | {deliveryLabel[delivery.status] ?? delivery.status}{delivery.error_code ? ` | ${delivery.error_code}` : ''}</p>)}
        {!pushDeliveries.length && <p className="text-sm text-slate-500">Nenhum push automatico registrado ainda.</p>}
      </section>

      <section className={panel}>
        <h2 className="text-xl font-semibold">Conectar meu WhatsApp por QR code</h2>
        <p className="my-3 text-sm">{connection?.configured ? (connection.connected ? 'Conectado.' : 'Evolution configurada, WhatsApp ainda nao conectado.') : 'A infraestrutura externa da Evolution ainda precisa ser configurada. Esta etapa e opcional se voce usar Web Push.'}</p>
        <p className="mb-4 text-xs text-slate-500">O Web Push acima nao depende do WhatsApp. Esta integracao permanece disponivel apenas como canal opcional.</p>
        <div className="flex flex-wrap gap-2"><button disabled={busy || !canWrite || !connection?.configured} className={button} onClick={() => void whatsappAction('connect')}>Gerar / atualizar QR code</button><button disabled={busy || !canWrite || !connection?.connected} className={secondary} onClick={() => void whatsappAction('test')}>Enviar lembrete de teste</button><button disabled={busy || !canWrite || !connection?.configured} className={secondary} onClick={() => { if (confirm('Desconectar esta sessao do WhatsApp?')) void whatsappAction('logout'); }}>Desconectar</button><button className={secondary} onClick={() => void whatsappStatus()}>Verificar conexao</button></div>
        {connection?.qr && !connection.connected && <div className="mt-4"><p className="mb-2 text-sm">No celular: WhatsApp / Aparelhos conectados / Conectar aparelho.</p><img src={connection.qr} alt="QR code temporario para conectar o WhatsApp" className="h-64 w-64 rounded-xl bg-white p-2" referrerPolicy="no-referrer"/></div>}
      </section>

      <section className={panel}>
        <h2 className="text-xl font-semibold">Ultimos envios pelo WhatsApp</h2>
        <p className="my-2 text-xs text-slate-500">Uma entrega por horario. Resultado desconhecido nao e reenviado automaticamente, para evitar duplicidade.</p>
        {deliveries.map((delivery) => <p className="border-t py-2 text-sm" key={delivery.id}>{delivery.day} {delivery.slot} | {deliveryLabel[delivery.status] ?? delivery.status}{delivery.error_code ? ` | ${delivery.error_code}` : ''}</p>)}
        {!deliveries.length && <p className="text-sm text-slate-500">Nenhum envio pelo WhatsApp registrado ainda.</p>}
      </section>
    </div>
  );
}
