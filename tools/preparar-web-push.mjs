import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const root = process.cwd();
if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error('Execute na raiz do projeto, onde esta package.json.');

const privateDir = path.join(root, '.push-private');
fs.mkdirSync(privateDir, { recursive: true });
const secretFile = path.join(privateDir, 'web-push-secrets.json');
const envFile = path.join(privateDir, 'vercel-web-push.env.txt');
const schedulerFile = path.join(privateDir, '041_configurar_agendamento_web_push.sql');
const verifyFile = path.join(privateDir, '042_verificar_agendamento_web_push.sql');

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generate() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey(undefined, 'uncompressed')),
    privateKey: b64url(ecdh.getPrivateKey()),
    dispatchSecret: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
}

function loadOrCreate() {
  if (fs.existsSync(secretFile)) {
    const value = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
    if (!value.publicKey || !value.privateKey || !value.dispatchSecret) throw new Error('Arquivo de chaves existente esta incompleto. Nao gere outra chave sem revisar as assinaturas atuais.');
    return value;
  }
  const value = generate();
  fs.writeFileSync(secretFile, JSON.stringify(value, null, 2), { mode: 0o600 });
  return value;
}

function upsertEnv(file, values) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const names = new Set(Object.keys(values));
  const kept = lines.filter((line) => !names.has(line.split('=', 1)[0]));
  for (const [name, value] of Object.entries(values)) kept.push(`${name}=${value}`);
  fs.writeFileSync(file, `${kept.join('\n')}\n`, 'utf8');
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const rl = readline.createInterface({ input, output });
let appUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? '';
if (!appUrl) appUrl = (await rl.question('URL HTTPS publicada da ferramenta (ex.: https://meu-app.vercel.app): ')).trim();
rl.close();
const parsed = new URL(appUrl);
if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Informe a URL HTTPS publica, sem credenciais, query ou fragmento.');
appUrl = parsed.origin;

const secrets = loadOrCreate();
const values = {
  APP_PUBLIC_URL: appUrl,
  VAPID_PUBLIC_KEY: secrets.publicKey,
  VAPID_PRIVATE_KEY: secrets.privateKey,
  PUSH_DISPATCH_SECRET: secrets.dispatchSecret,
};

const localEnv = path.join(root, '.env.local');
if (fs.existsSync(localEnv)) fs.copyFileSync(localEnv, path.join(privateDir, `.env.local.backup-${Date.now()}`));
upsertEnv(localEnv, values);
fs.writeFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });

const appUrlSql = sqlLiteral(appUrl);
const secretSql = sqlLiteral(secrets.dispatchSecret);
const scheduler = `-- PRIVADO. Execute no SQL Editor do Supabase como postgres.\n-- Requer 040_web_push_pwa.sql ja aplicado.\n\ndo $$\nbegin\n  if not exists(select 1 from pg_extension where extname='pg_cron') then\n    raise exception 'Ative Supabase Cron / extensao pg_cron no Dashboard antes deste SQL.';\n  end if;\n  if not exists(select 1 from pg_extension where extname='pg_net') then\n    raise exception 'Ative a extensao pg_net no Dashboard antes deste SQL.';\n  end if;\n  if to_regclass('vault.decrypted_secrets') is null then\n    raise exception 'Supabase Vault nao esta disponivel neste projeto.';\n  end if;\nend $$;\n\ndo $$\ndeclare v_id uuid;\nbegin\n  select id into v_id from vault.secrets where name='pf_push_app_url' limit 1;\n  if v_id is null then\n    perform vault.create_secret(${appUrlSql},'pf_push_app_url','URL publica do app para o cron Web Push');\n  else\n    perform vault.update_secret(v_id,${appUrlSql},'pf_push_app_url','URL publica do app para o cron Web Push');\n  end if;\n\n  select id into v_id from vault.secrets where name='pf_push_dispatch_secret' limit 1;\n  if v_id is null then\n    perform vault.create_secret(${secretSql},'pf_push_dispatch_secret','Segredo do endpoint de despacho Web Push');\n  else\n    perform vault.update_secret(v_id,${secretSql},'pf_push_dispatch_secret','Segredo do endpoint de despacho Web Push');\n  end if;\nend $$;\n\nselect cron.schedule(\n  'pf-push-reminders-every-minute',\n  '* * * * *',\n  $cron$\n    select net.http_post(\n      url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='pf_push_app_url' limit 1),'/') || '/api/reminders/push-dispatch',\n      headers := jsonb_build_object(\n        'Content-Type','application/json',\n        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='pf_push_dispatch_secret' limit 1)\n      ),\n      body := jsonb_build_object('source','supabase-cron','at',now()),\n      timeout_milliseconds := 10000\n    ) as request_id\n    where public.pf_push_dispatch_needed_v1();\n  $cron$\n);\n`;
fs.writeFileSync(schedulerFile, scheduler, { mode: 0o600 });

const verify = `-- SOMENTE LEITURA. Nao exibe os segredos.\nselect jobid,jobname,schedule,active from cron.job where jobname='pf-push-reminders-every-minute';\nselect name,created_at,updated_at from vault.secrets where name in ('pf_push_app_url','pf_push_dispatch_secret') order by name;\nselect id,household_id,user_id,device_label,is_active,created_at,last_seen_at,disabled_at from public.pf_push_subscriptions order by created_at desc;\nselect day,slot,status,error_code,created_at,finished_at from public.pf_push_outbox order by created_at desc limit 30;\n`;
fs.writeFileSync(verifyFile, verify, 'utf8');

console.log('');
console.log('Web Push preparado sem rotacionar chaves existentes.');
console.log(`1) Variaveis para Vercel: ${envFile}`);
console.log(`2) SQL do agendador Supabase: ${schedulerFile}`);
console.log(`3) SQL de conferencia: ${verifyFile}`);
console.log('4) .env.local foi atualizado para testes locais.');
console.log('Nao envie a pasta .push-private ao GitHub nem compartilhe seu conteudo.');
