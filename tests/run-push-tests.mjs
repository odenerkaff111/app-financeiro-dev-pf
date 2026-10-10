import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
let tests=0;
const test=(name,fn)=>{fn();tests++;console.log(`OK ${name}`);};
function load(relative,mocks={}){
 const source=fs.readFileSync(relative,'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const output={exports:{}};
 vm.runInNewContext(code,{exports:output.exports,module:output,require:name=>name in mocks?mocks[name]:require(name),process,Buffer,Response,Request,URL,AbortSignal,fetch:globalThis.fetch,console,setTimeout,clearTimeout},{filename:relative});
 return output.exports;
}
const push=load('src/lib/web-push-server.ts',{'server-only':{}});
const b64=push.base64UrlEncode;
const hmac=(key,data)=>crypto.createHmac('sha256',key).update(data).digest();
const expand=(prk,info,len)=>hmac(prk,Buffer.concat([info,Buffer.from([1])])).subarray(0,len);

const client=crypto.createECDH('prime256v1');client.generateKeys();
const auth=crypto.randomBytes(16);
const subscription={endpoint:'https://push.example.test/send/abc',p256dh:b64(client.getPublicKey(undefined,'uncompressed')),auth:b64(auth)};
test('Assinatura valida aceita',()=>assert.doesNotThrow(()=>push.validateSubscriptionInput(subscription)));
for(const bad of [
 {...subscription,endpoint:'http://push.example.test/send'},
 {...subscription,p256dh:'abc'},
 {...subscription,auth:'abc'},
])test('Assinatura invalida rejeitada',()=>assert.throws(()=>push.validateSubscriptionInput(bad)));
test('Hash de endpoint e estavel',()=>assert.equal(push.endpointHash(subscription.endpoint),push.endpointHash(subscription.endpoint)));

const server=crypto.createECDH('prime256v1');server.generateKeys();
const salt=crypto.randomBytes(16);
const message=Buffer.from(JSON.stringify({title:'Teste',body:'Mensagem',url:'/registros'}));
const encrypted=push.encryptWebPushPayload(subscription,message,{serverPrivateKey:server.getPrivateKey(),salt});
test('Header aes128gcm usa salt, rs=4096 e chave efemera',()=>{
 assert.deepEqual(Buffer.from(encrypted.body.subarray(0,16)),salt);
 assert.equal(encrypted.body.readUInt32BE(16),4096);
 assert.equal(encrypted.body[20],65);
 assert.deepEqual(Buffer.from(encrypted.body.subarray(21,86)),server.getPublicKey(undefined,'uncompressed'));
});
test('Payload Web Push descriptografa conforme RFC8291',()=>{
 const serverPublic=Buffer.from(encrypted.body.subarray(21,86));
 const shared=client.computeSecret(serverPublic);
 const prkKey=hmac(auth,shared);
 const keyInfo=Buffer.concat([Buffer.from('WebPush: info\0','ascii'),client.getPublicKey(undefined,'uncompressed'),serverPublic]);
 const ikm=expand(prkKey,keyInfo,32);
 const prk=hmac(salt,ikm);
 const cek=expand(prk,Buffer.from('Content-Encoding: aes128gcm\0','ascii'),16);
 const nonce=expand(prk,Buffer.from('Content-Encoding: nonce\0','ascii'),12);
 const cipherText=Buffer.from(encrypted.body.subarray(86));
 const tag=cipherText.subarray(cipherText.length-16);
 const ciphertext=cipherText.subarray(0,cipherText.length-16);
 const decipher=crypto.createDecipheriv('aes-128-gcm',cek,nonce,{authTagLength:16});
 decipher.setAuthTag(tag);
 const plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
 assert.equal(plain[plain.length-1],2);
 assert.deepEqual(plain.subarray(0,-1),message);
});
test('Payload acima do limite e rejeitado',()=>assert.throws(()=>push.encryptWebPushPayload(subscription,Buffer.alloc(3994))));

const old={pub:process.env.VAPID_PUBLIC_KEY,priv:process.env.VAPID_PRIVATE_KEY,url:process.env.APP_PUBLIC_URL};
const vapid=crypto.createECDH('prime256v1');vapid.generateKeys();
process.env.VAPID_PUBLIC_KEY=b64(vapid.getPublicKey(undefined,'uncompressed'));
process.env.VAPID_PRIVATE_KEY=b64(vapid.getPrivateKey());
process.env.APP_PUBLIC_URL='https://financeiro.example.test';
test('Configuracao VAPID correspondente e aceita',()=>assert.equal(push.pushConfigured(),true));
process.env.VAPID_PUBLIC_KEY=b64(client.getPublicKey(undefined,'uncompressed'));
test('Chaves VAPID divergentes sao rejeitadas',()=>assert.equal(push.pushConfigured(),false));
for(const [key,value] of [['VAPID_PUBLIC_KEY',old.pub],['VAPID_PRIVATE_KEY',old.priv],['APP_PUBLIC_URL',old.url]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}

const sw=fs.readFileSync('public/sw.js','utf8');
test('Service worker trata push, clique e badge sem cache financeiro',()=>{assert.ok(sw.includes("addEventListener('push',"));assert.ok(sw.includes("addEventListener('notificationclick',"));assert.ok(sw.includes('showNotification'));assert.ok(sw.includes('self.navigator.setAppBadge'));assert.ok(sw.includes('self.navigator.clearAppBadge'));assert.equal(sw.includes('caches.open'),false);});
const manifest=fs.readFileSync('src/app/manifest.ts','utf8');
test('Manifest e standalone com icones',()=>{assert.ok(manifest.includes("display: 'standalone'"));assert.ok(manifest.includes('/icons/icon-192.png'));assert.ok(manifest.includes('/icons/icon-512.png'));});
const reminder=fs.readFileSync('src/components/control/ReminderSettings.tsx','utf8');
test('Permissao push depende de botao explicito',()=>{assert.ok(reminder.includes('Ativar neste dispositivo'));assert.ok(reminder.includes('subscribeBrowserPush'));});
test('iPhone pede permissao antes de qualquer chamada de rede no clique',()=>{const start=reminder.indexOf('async function activatePush');const end=reminder.indexOf('async function testPush');const body=reminder.slice(start,end);assert.ok(body.indexOf('subscribeBrowserPush')>=0);assert.equal(body.includes("await server<PushState>('/api/push'"),false);});
const migration=fs.readFileSync('supabase/migrations/040_web_push_pwa.sql','utf8');
test('Assinaturas nao sao legiveis diretamente pelo authenticated',()=>{assert.ok(migration.includes('revoke all on public.pf_push_subscriptions from public,anon,authenticated'));assert.ok(migration.includes('grant select on public.pf_push_outbox to authenticated'));});
test('Claim de push respeita janela e confirmacao diaria',()=>{assert.ok(migration.includes("now()-due>interval '5 minutes'"));assert.ok(migration.includes('c.confirmed_at>=due'));assert.ok(migration.includes('unique(subscription_id,day,slot)'));});
test('Cron so precisa chamar Vercel quando ha push pendente',()=>{assert.ok(migration.includes('pf_push_dispatch_needed_v1'));const prep=fs.readFileSync('tools/preparar-web-push.mjs','utf8');assert.ok(prep.includes('where public.pf_push_dispatch_needed_v1()'));});
const pushFix=fs.readFileSync('supabase/migrations/041_web_push_dispatch_fixes.sql','utf8');
test('Hotfix persistido evita ambiguidade de slot no Cron e no claim',()=>{assert.ok(pushFix.includes('v_slot'));assert.ok(pushFix.includes('o.slot=v_slot'));assert.ok(pushFix.includes('pf_claim_push_reminders_v1'));});
const dispatch=fs.readFileSync('src/app/api/reminders/push-dispatch/route.ts','utf8');
test('Despacho exige segredo e revalida job',()=>{assert.ok(dispatch.includes('pushDispatchAuthorized(request)'));assert.ok(dispatch.includes("pf_push_job_is_due_v1"));});
console.log(`\n${tests} testes de PWA/Web Push passaram.`);
