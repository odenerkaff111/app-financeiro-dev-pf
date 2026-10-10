import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/app/api');
const routeFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === 'route.ts') routeFiles.push(full);
  }
}
walk(root);

const rel = (file) => path.relative(process.cwd(), file).replaceAll('\\', '/');
const cronGuards = new Map([
  ['src/app/api/reminders/dispatch/route.ts', 'dispatchAuthorized(request)'],
  ['src/app/api/reminders/push-dispatch/route.ts', 'pushDispatchAuthorized(request)'],
]);

let tests = 0;
function test(name, fn) {
  fn();
  tests += 1;
  console.log(`OK ${name}`);
}

test('API publica legada de e-mail foi removida', () => {
  assert.equal(fs.existsSync('src/app/api/send-email/route.ts'), false);
});

test('Todas as rotas de API usam autenticacao de usuario ou segredo dedicado', () => {
  const unguarded = [];
  for (const file of routeFiles) {
    const name = rel(file);
    const source = fs.readFileSync(file, 'utf8');
    const cronGuard = cronGuards.get(name);
    const guarded = cronGuard
      ? source.includes(cronGuard)
      : source.includes('authorize(request)') || source.includes('auth.getUser');
    if (!guarded) unguarded.push(name);
  }
  assert.deepEqual(unguarded, []);
});

test('Endpoints de acao sensivel preservam throttling persistente', () => {
  const push = fs.readFileSync('src/app/api/push/route.ts', 'utf8');
  const whatsapp = fs.readFileSync('src/app/api/whatsapp/route.ts', 'utf8');
  assert.ok(push.includes('pf_claim_push_action_v1'));
  assert.ok(whatsapp.includes('pf_claim_whatsapp_action_v1'));
});

test('Headers de seguranca continuam ativos globalmente', () => {
  const config = fs.readFileSync('next.config.ts', 'utf8');
  for (const header of [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Strict-Transport-Security',
    'Content-Security-Policy',
    'Permissions-Policy',
  ]) {
    assert.ok(config.includes(header), `Header ausente: ${header}`);
  }
});

console.log(`\n${tests} testes de seguranca de API passaram.`);
