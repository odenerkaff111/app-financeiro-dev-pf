import { createSupabaseAdmin } from '@/lib/supabase-admin';
import { applicationUrl, handled, json } from '@/lib/control/server';
import { PushDeliveryError, pushConfigured, pushDispatchAuthorized, sendWebPush } from '@/lib/web-push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Delivery = {
  id: string;
  household_id: string;
  user_id: string;
  subscription_id: string;
  day: string;
  slot: string;
};

export async function POST(request: Request) {
  if (!pushDispatchAuthorized(request)) return json({ error: 'Nao autorizado.' }, 401);
  if (!pushConfigured()) return json({ error: 'Web Push nao configurado.' }, 503);
  try {
    const admin = createSupabaseAdmin();
    const claimed = await admin.rpc('pf_claim_push_reminders_v1');
    if (claimed.error) throw claimed.error;
    const jobs = (claimed.data ?? []) as Delivery[];
    const target = new URL(applicationUrl()).pathname;
    const outcomes = await Promise.all(jobs.map(async (job) => {
      let status: 'sent' | 'failed' | 'unknown' | 'skipped' = 'sent';
      let errorCode: string | null = null;
      let providerId: string | null = null;
      try {
        const stillDue = await admin.rpc('pf_push_job_is_due_v1', { p_job: job.id });
        if (stillDue.error) throw stillDue.error;
        if (!stillDue.data) status = 'skipped';
        else {
          const subscription = await admin.from('pf_push_subscriptions').select('id,endpoint,p256dh,auth')
            .eq('id', job.subscription_id).eq('is_active', true).maybeSingle();
          if (subscription.error) throw subscription.error;
          if (!subscription.data) status = 'skipped';
          else {
            try {
              const sent = await sendWebPush(subscription.data, {
                title: 'Minhas Financas',
                body: `Hora de conferir seu controle financeiro (${job.slot}). Registre o que aconteceu e confirme na ferramenta.`,
                url: target,
                tag: `finance-reminder-${job.day}-${job.slot}`,
                badge: 1,
              });
              providerId = sent.providerId;
            } catch (error) {
              if (error instanceof PushDeliveryError) {
                errorCode = error.code;
                status = error.code === 'RESULTADO_DESCONHECIDO' ? 'unknown' : 'failed';
                if (error.gone) {
                  await admin.from('pf_push_subscriptions').update({
                    is_active: false,
                    disabled_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  }).eq('id', subscription.data.id);
                }
              } else throw error;
            }
          }
        }
      } catch {
        status = 'failed';
        errorCode = errorCode ?? 'ERRO_INTERNO';
      }
      const saved = await admin.from('pf_push_outbox').update({
        status,
        error_code: errorCode,
        provider_id: providerId,
        finished_at: new Date().toISOString(),
      }).eq('id', job.id).eq('status', 'sending');
      if (saved.error) return { status: 'unknown' as const };
      return { status };
    }));
    return json({
      processed: jobs.length,
      sent: outcomes.filter((item) => item.status === 'sent').length,
      skipped: outcomes.filter((item) => item.status === 'skipped').length,
      failed: outcomes.filter((item) => item.status === 'failed').length,
      unconfirmed: outcomes.filter((item) => item.status === 'unknown').length,
    });
  } catch (error) {
    return handled(error);
  }
}
