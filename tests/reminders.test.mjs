import test from 'node:test';
import assert from 'node:assert/strict';
import { hkdfSync, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { encryptPayload, vapidAuthorization, base64url, bytes } from '../server/webpush.mjs';
import { validSubscription, handleSubscriptions } from '../server/subscriptions.mjs';
import { runSchedule } from '../server/scheduler.mjs';
const subtle = webcrypto.subtle;

async function fixture() {
  const keys = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { keys, subscription: {
    endpoint: 'https://web.push.apple.com/test-device',
    keys: { p256dh: base64url(await subtle.exportKey('raw', keys.publicKey)), auth: base64url(webcrypto.getRandomValues(new Uint8Array(16))) },
  } };
}
const flat = (s) => ({ endpoint: s.endpoint, ...s.keys });

test('RFC 8291 payload independently decrypts with receiver private key', async () => {
  const { keys, subscription } = await fixture();
  const payload = await encryptPayload(flat(subscription), 'Private test reminder');
  const salt = payload.slice(0, 16);
  assert.equal(new DataView(payload.buffer).getUint32(16), 4096);
  const sender = payload.slice(21, 21 + payload[20]);
  const senderKey = await subtle.importKey('raw', sender, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: senderKey }, keys.privateKey, 256);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(bytes(subscription.keys.p256dh)), sender]);
  const ikm = hkdfSync('sha256', Buffer.from(shared), bytes(subscription.keys.auth), info, 32);
  const cek = hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const result = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, payload.slice(21 + payload[20])));
  assert.equal(result.at(-1), 2);
  assert.equal(new TextDecoder().decode(result.slice(0, -1)), 'Private test reminder');
});

test('VAPID JWT verifies and is scoped to push service, not app origin', async () => {
  const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await subtle.exportKey('jwk', keys.privateKey);
  const env = { VAPID_PUBLIC_KEY: base64url(await subtle.exportKey('raw', keys.publicKey)), VAPID_PRIVATE_KEY: priv.d, VAPID_SUBJECT: 'mailto:test@example.com' };
  const auth = await vapidAuthorization('https://web.push.apple.com/device/123', env);
  const jwt = auth.match(/^vapid t=([^,]+)/)[1];
  const [header, claims, sig] = jwt.split('.');
  const decoded = JSON.parse(new TextDecoder().decode(bytes(claims)));
  assert.equal(decoded.aud, 'https://web.push.apple.com');
  assert.equal(decoded.sub, env.VAPID_SUBJECT);
  assert.ok(decoded.exp > Date.now() / 1000);
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, bytes(sig), new TextEncoder().encode(`${header}.${claims}`)));
});

test('subscription validation rejects SSRF destinations and malformed keys', async () => {
  const { subscription: s } = await fixture();
  assert.ok(validSubscription(s));
  for (const endpoint of ['http://web.push.apple.com/a', 'https://localhost/a', 'https://fcm.googleapis.com.evil.test/a', 'https://fcm.googleapis.com:999/a', 'https://name:pass@fcm.googleapis.com/a']) {
    assert.equal(validSubscription({ ...s, endpoint }), false);
  }
  assert.equal(validSubscription({ ...s, keys: { p256dh: 'junk', auth: 'junk' } }), false);
});

function database() {
  const rows = new Map();
  return { rows, prepare(sql) {
    return { bind(...args) {
      return {
        async first() { return rows.get(args[0]) || null; },
        async all() { return { results: [...rows.values()].filter(r => r.id > args[0]).sort((a,b) => a.id.localeCompare(b.id)).slice(0,50) }; },
        async run() {
          if (sql.startsWith('INSERT')) rows.set(args[0], { id: args[0], endpoint: args[1], p256dh: args[2], auth: args[3] });
          if (sql.startsWith('DELETE') && (!args[1] || rows.get(args[0])?.endpoint === args[1])) rows.delete(args[0]);
        },
      };
    } };
  } };
}
const request = (data, token = 'a'.repeat(64), origin = 'https://app.pages.dev') => new Request('https://app.pages.dev/api/reminders', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(data),
});

test('API requires setup, same-origin intent, and a device capability', async () => {
  assert.equal((await handleSubscriptions(new Request('https://app.pages.dev/api/reminders'), {})).status, 503);
  const env = { REMINDERS_DB: database(), VAPID_PUBLIC_KEY: 'test' };
  assert.equal((await handleSubscriptions(request({ action: 'status' }, 'a'.repeat(64), 'https://evil.test'), env)).status, 403);
  assert.equal((await handleSubscriptions(request({ action: 'status' }, 'bad'), env)).status, 401);
  assert.equal((await handleSubscriptions(request({ action: 'enable', subscription: {} }), env)).status, 400);
});

test('enable is idempotent; device cannot disable another device; no financial data persisted', async () => {
  const env = { REMINDERS_DB: database(), VAPID_PUBLIC_KEY: 'test' };
  const { subscription } = await fixture();
  const body = { action: 'enable', subscription, financialRecords: [{ amount: 99 }] };
  assert.equal((await handleSubscriptions(request(body), env)).status, 200);
  assert.equal((await handleSubscriptions(request(body), env)).status, 200);
  assert.equal(env.REMINDERS_DB.rows.size, 1);
  assert.deepEqual(Object.keys([...env.REMINDERS_DB.rows.values()][0]).sort(), ['id', 'endpoint', 'p256dh', 'auth'].sort());
  assert.deepEqual(await (await handleSubscriptions(request({ action: 'status' }), env)).json(), { enabled: true });
  await handleSubscriptions(request({ action: 'disable' }, 'b'.repeat(64)), env);
  assert.equal(env.REMINDERS_DB.rows.size, 1);
  await handleSubscriptions(request({ action: 'disable' }), env);
  assert.equal(env.REMINDERS_DB.rows.size, 0);
});

test('scheduler sends to all devices and removes only expired subscriptions', async () => {
  const db = database();
  for (let i = 1; i <= 55; i++) db.rows.set(String(i).padStart(3, '0'), { id: String(i).padStart(3, '0'), endpoint: 'https://web.push.apple.com/' + i });
  const statuses = [201, 404, 410, 429, 500];
  let calls = 0;
  await runSchedule({ REMINDERS_DB: db, VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'c' }, async () => {
    calls++;
    return new Response(null, { status: statuses[(calls - 1) % statuses.length] });
  });
  assert.equal(calls, 55);
  assert.equal(db.rows.size, 33);
});

test('service worker shows reminder, reuses existing app, and bypasses API caching', async () => {
  const listeners = {};
  let shown, message, focused = false, opened;
  const scope = 'https://app.pages.dev/';
  const context = vm.createContext({ URL, console, Response, fetch, self: {
    location: new URL(scope), registration: { scope, showNotification: async (...args) => { shown = args; } },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    clients: {
      matchAll: async () => [{ url: scope + 'index.html', postMessage: data => { message = data; }, focus: async () => { focused = true; } }],
      openWindow: async url => { opened = url; },
    },
  } });
  await vm.runInContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), context);
  let pending;
  listeners.push({ waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(shown[0], 'New transaction');
  assert.match(shown[1].body, /Tap to record/);
  listeners.notificationclick({ notification: { close() {} }, waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(message.type, 'OPEN_NEW_TRANSACTION');
  assert.ok(focused);
  assert.equal(opened, undefined);
  context.self.clients.matchAll = async () => [];
  listeners.notificationclick({ notification: { close() {} }, waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(opened, scope + 'index.html#new-transaction');
  let intercepted = false;
  listeners.fetch({ request: new Request(scope + 'api/reminders'), respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false);
});

test('cron is every three hours with no quiet hours; public build uses a whitelist', async () => {
  const config = await readFile(new URL('../server/wrangler.toml', import.meta.url), 'utf8');
  assert.match(config, /crons = \["0 \*\/3 \* \* \*"\]/);
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.ok(!build.includes("'server'"));
  assert.ok(!build.includes("'functions'"));
});

async function reminderUI({ supported = true, stored = false, permission = 'granted' } = {}) {
  const elements = new Map();
  for (const id of ['pf-reminder-enable', 'pf-reminder-disable', 'pf-reminder-status', 'pf-entry-form', 'pf-entry-amount']) {
    elements.set(id, { disabled: false, listeners: {}, textContent: '', addEventListener(name, fn) { this.listeners[name] = fn; }, scrollIntoView() {}, focus() {} });
  }
  const storage = new Map(stored ? [['alshwareb_reminder_device_v1', 'a'.repeat(64)]] : []);
  let unsubscribed = 0;
  let prompts = 0;
  let fail = false;
  const requests = [];
  const subscription = { toJSON: () => ({ endpoint: 'https://web.push.apple.com/device', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => { unsubscribed++; } };
  const navigator = { serviceWorker: { addEventListener() {}, getRegistration: async () => ({ active: true, pushManager: { getSubscription: async () => subscription } }) } };
  const notification = { permission, requestPermission: async () => { prompts++; return permission; } };
  const document = { readyState: 'complete', getElementById: id => elements.get(id), querySelector: () => null };
  const window = { isSecureContext: true, addEventListener() {}, Notification: notification, ...(supported ? { PushManager: {} } : {}) };
  const context = vm.createContext({ window, document, navigator, Notification: notification, crypto: webcrypto,
    location: { hash: '' }, Uint8Array, atob, AbortSignal, console,
    localStorage: { getItem: key => storage.get(key), setItem: (key, val) => storage.set(key, val) },
    fetch: async (_url, options = {}) => {
      requests.push(options);
      if (fail) throw new Error('Network unavailable');
      return Response.json(options.method === 'POST' ? { enabled: JSON.parse(options.body).action !== 'disable' } : { publicKey: base64url(new Uint8Array(65)) });
    },
  });
  vm.runInContext(await readFile(new URL('../js/reminders.js', import.meta.url), 'utf8'), context);
  return { elements, requests, prompts: () => prompts, unsubscribed: () => unsubscribed, fail: () => { fail = true; } };
}

test('UI never requests permission on load; opt-in sends subscription only and can disable', async () => {
  const ui = await reminderUI();
  assert.equal(ui.prompts(), 0);
  assert.equal(ui.requests.length, 0);
  await ui.elements.get('pf-reminder-enable').listeners.click();
  assert.equal(ui.prompts(), 1);
  assert.match(ui.elements.get('pf-reminder-status').textContent, /Enabled on this device/);
  const post = ui.requests.find(r => r.method === 'POST');
  assert.deepEqual(Object.keys(JSON.parse(post.body)).sort(), ['action', 'subscription']);
  assert.match(post.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
  await ui.elements.get('pf-reminder-disable').listeners.click();
  assert.equal(ui.unsubscribed(), 1);
  assert.match(ui.elements.get('pf-reminder-status').textContent, /off/);
});

test('UI does not pretend offline disable succeeded', async () => {
  const ui = await reminderUI();
  ui.fail();
  await ui.elements.get('pf-reminder-disable').listeners.click();
  assert.match(ui.elements.get('pf-reminder-status').textContent, /Network unavailable/);
  assert.equal(ui.unsubscribed(), 0);
  assert.equal(ui.elements.get('pf-reminder-disable').disabled, false);
});

test('unsupported iPhone context explains installation; denied permission makes no API call', async () => {
  const unsupported = await reminderUI({ supported: false });
  assert.equal(unsupported.elements.get('pf-reminder-enable').disabled, true);
  assert.match(unsupported.elements.get('pf-reminder-status').textContent, /Home Screen/);
  const denied = await reminderUI({ permission: 'denied' });
  await denied.elements.get('pf-reminder-enable').listeners.click();
  assert.match(denied.elements.get('pf-reminder-status').textContent, /not allowed/);
  assert.equal(denied.requests.length, 0);
});
