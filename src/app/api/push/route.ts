import { createHash } from 'node:crypto';
import { applicationUrl, authorize, ControlError, handled, json } from '@/lib/control/server';
import {
  endpointHash,
  PushDeliveryError,
  pushConfigured,
  sendWebPush,
  validateSubscriptionInput,
  vapidPublicKey,
  type StoredPushSubscription,
} from '@/lib/web-push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type SubscriptionBody = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

type ActionBody = {
  action?: unknown;
  subscription?: SubscriptionBody;
  endpoint?: unknown;
  deviceLabel?: unknown;
};

function readSubscription(value: SubscriptionBody | undefined): StoredPushSubscription {
  if (!value || typeof value.endpoint !== 'string' || !value.keys || typeof value.keys.p256dh !== 'string' || typeof value.keys.auth !== 'string') {
    throw new ControlError('Assinatura Web Push invalida.');
  }
  const subscription = { endpoint: value.endpoint, p256dh: value.keys.p256dh, auth: value.keys.auth };
  try { validateSubscriptionInput(subscription); } catch { throw new ControlError('Assinatura Web Push invalida.'); }
  return subscription;
}

function safeDeviceLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[\r\n\t]/g, ' ').slice(0, 80);
  return clean || null;
}

export async function GET(request: Request) {
  try {
    const { admin, household, user } = await authorize(request);
    const settings = await admin.from('pf_reminder_settings')
      .select('push_enabled,push_consented_at')
      .eq('household_id', household).eq('user_id', user).maybeSingle();
    if (settings.error) throw settings.error;
    const subscriptions = await admin.from('pf_push_subscriptions')
      .select('id,device_label,last_seen_at,created_at')
      .eq('household_id', household).eq('user_id', user).eq('is_active', true)
      .order('last_seen_at', { ascending: false });
    if (subscriptions.error) throw subscriptions.error;
    return json({
      configured: pushConfigured(),
      publicKey: pushConfigured() ? vapidPublicKey() : null,
      enabled: Boolean(settings.data?.push_enabled),
      consentedAt: settings.data?.push_consented_at ?? null,
      subscriptions: subscriptions.data ?? [],
    });
  } catch (error) {
    return handled(error);
  }
}

export async function POST(request: Request) {
  try {
    const { admin, household, user } = await authorize(request);
    const raw = await request.text();
    if (raw.length > 16000) throw new ControlError('Solicitacao grande demais.');
    let body: ActionBody;
    try { body = JSON.parse(raw) as ActionBody; } catch { throw new ControlError('Solicitacao invalida.'); }
    const action = body.action;
    if (!['subscribe', 'unsubscribe', 'test', 'disable-all'].includes(String(action))) throw new ControlError('Acao invalida.');

    if (action === 'subscribe') {
      if (!pushConfigured()) throw new ControlError('Configure as chaves Web Push no servidor primeiro.', 503);
      const subscription = readSubscription(body.subscription);
      const hash = endpointHash(subscription.endpoint);
      const deviceLabel = safeDeviceLabel(body.deviceLabel);
      const expiration = body.subscription?.expirationTime;
      const expirationTime = typeof expiration === 'number' && Number.isFinite(expiration) ? Math.trunc(expiration) : null;
      const now = new Date().toISOString();
      const upsert = await admin.from('pf_push_subscriptions').upsert({
        household_id: household,
        user_id: user,
        endpoint: subscription.endpoint,
        endpoint_hash: hash,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        expiration_time: expirationTime,
        device_label: deviceLabel,
        user_agent_hash: createHash('sha256').update(request.headers.get('user-agent') ?? '').digest('hex'),
        is_active: true,
        disabled_at: null,
        last_seen_at: now,
        updated_at: now,
      }, { onConflict: 'endpoint_hash' }).select('id').single();
      if (upsert.error) throw upsert.error;
      const preference = await admin.from('pf_reminder_settings').upsert({
        household_id: household,
        user_id: user,
        push_enabled: true,
        push_consented_at: now,
        updated_at: now,
      }, { onConflict: 'household_id,user_id' });
      if (preference.error) throw preference.error;
      return json({ enabled: true, subscriptionId: upsert.data.id, message: 'Notificacoes ativadas neste dispositivo.' });
    }

    if (action === 'unsubscribe') {
      if (typeof body.endpoint !== 'string' || body.endpoint.length > 4096) throw new ControlError('Endpoint invalido.');
      const hash = endpointHash(body.endpoint);
      const now = new Date().toISOString();
      const disabled = await admin.from('pf_push_subscriptions').update({ is_active: false, disabled_at: now, updated_at: now })
        .eq('household_id', household).eq('user_id', user).eq('endpoint_hash', hash);
      if (disabled.error) throw disabled.error;
      const remaining = await admin.from('pf_push_subscriptions').select('id', { count: 'exact', head: true })
        .eq('household_id', household).eq('user_id', user).eq('is_active', true);
      if (remaining.error) throw remaining.error;
      if ((remaining.count ?? 0) === 0) {
        const pref = await admin.from('pf_reminder_settings').update({ push_enabled: false, updated_at: now })
          .eq('household_id', household).eq('user_id', user);
        if (pref.error) throw pref.error;
      }
      return json({ enabled: (remaining.count ?? 0) > 0, message: 'Notificacoes desativadas neste dispositivo.' });
    }

    if (action === 'disable-all') {
      const now = new Date().toISOString();
      const disabled = await admin.from('pf_push_subscriptions').update({ is_active: false, disabled_at: now, updated_at: now })
        .eq('household_id', household).eq('user_id', user).eq('is_active', true);
      if (disabled.error) throw disabled.error;
      const pref = await admin.from('pf_reminder_settings').update({ push_enabled: false, updated_at: now })
        .eq('household_id', household).eq('user_id', user);
      if (pref.error) throw pref.error;
      return json({ enabled: false, message: 'Notificacoes push desativadas em todos os dispositivos.' });
    }

    if (!pushConfigured()) throw new ControlError('Configure as chaves Web Push no servidor primeiro.', 503);
    const limited = await admin.rpc('pf_claim_push_action_v1', { p_household: household, p_user: user, p_action: 'test' });
    if (limited.error) throw limited.error;
    if (!limited.data) throw new ControlError('Aguarde 30 segundos antes de repetir o teste.', 429);
    if (typeof body.endpoint !== 'string' || body.endpoint.length > 4096) throw new ControlError('Ative as notificacoes neste dispositivo primeiro.');
    const hash = endpointHash(body.endpoint);
    const selected = await admin.from('pf_push_subscriptions').select('id,endpoint,p256dh,auth')
      .eq('household_id', household).eq('user_id', user).eq('endpoint_hash', hash).eq('is_active', true).maybeSingle();
    if (selected.error) throw selected.error;
    if (!selected.data) throw new ControlError('Este dispositivo nao possui uma assinatura ativa.');
    try {
      await sendWebPush(selected.data, {
        title: 'Minhas Financas',
        body: 'Teste de notificacao concluido. Toque para abrir suas movimentacoes.',
        url: new URL(applicationUrl()).pathname,
        tag: 'finance-test',
        badge: 1,
      });
    } catch (error) {
      if (error instanceof PushDeliveryError && error.gone) {
        await admin.from('pf_push_subscriptions').update({ is_active: false, disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', selected.data.id);
        throw new ControlError('A assinatura deste dispositivo expirou. Ative as notificacoes novamente.', 409);
      }
      if (error instanceof PushDeliveryError) throw new ControlError(`O servico de push respondeu com ${error.code}.`, 502);
      throw error;
    }
    return json({ enabled: true, message: 'Notificacao de teste enviada para este dispositivo.' });
  } catch (error) {
    return handled(error);
  }
}
