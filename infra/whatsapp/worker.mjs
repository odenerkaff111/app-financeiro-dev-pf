import { setTimeout as wait } from 'node:timers/promises';

const url = new URL(process.env.APP_PUBLIC_URL ?? '');
const secret = process.env.REMINDER_DISPATCH_SECRET ?? '';
if (url.protocol !== 'https:' || url.username || url.password || secret.length < 32) {
  throw new Error('APP_PUBLIC_URL HTTPS e REMINDER_DISPATCH_SECRET sao obrigatorios.');
}
const endpoint = new URL('/api/reminders/dispatch', url.origin);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
console.info('Agendador iniciado. As preferencias e deduplicacao sao verificadas no Supabase.');
while (!stopping) {
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${secret}` },
      redirect: 'error', signal: AbortSignal.timeout(50000),
    });
    if (!response.ok) console.warn(`Despacho HTTP ${response.status}. Confira ambiente e logs privados da Vercel.`);
    else {
      const result = await response.json();
      if (result.processed) console.info(`Processados: ${Number(result.processed)}; enviados: ${Number(result.sent)}.`);
    }
  } catch {
    console.warn('Nao foi possivel concluir o despacho. Nenhum segredo ou corpo da resposta foi registrado.');
  }
  // Serial polling: never overlap requests. The database prevents duplicate deliveries.
  const remaining = Math.max(1000, 60000 - (Date.now() - started));
  for (let elapsed=0; elapsed<remaining && !stopping; elapsed+=1000) await wait(Math.min(1000, remaining-elapsed));
}
