import { bytes } from './webpush.mjs';
const enc = new TextEncoder();
export function validSubscription(s) {
  try {
    const url = new URL(s.endpoint);
    // Do not permit arbitrary endpoints: this API must not become an SSRF proxy.
    const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
        !allowed.includes(url.hostname) || s.endpoint.length > 2048) return false;
    return bytes(s.keys.p256dh).length === 65 && bytes(s.keys.p256dh)[0] === 4 && bytes(s.keys.auth).length === 16;
  } catch { return false; }
}
export async function handleSubscriptions(request, env) {
  const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!env.REMINDERS_DB || !env.VAPID_PUBLIC_KEY) return json({ error: 'Reminders are not configured on this deployment yet.' }, 503);
  if (request.method === 'GET') return json({ publicKey: env.VAPID_PUBLIC_KEY });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Invalid origin' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'JSON required' }, 415);
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!/^[a-f0-9]{64}$/.test(token || '')) return json({ error: 'Device token required' }, 401);
  const id = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
  let data;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: 'Request too large' }, 413);
    data = JSON.parse(text);
  } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (data.action === 'disable') {
    await env.REMINDERS_DB.prepare('DELETE FROM reminder_subscriptions WHERE id = ?').bind(id).run();
    return json({ enabled: false });
  }
  if (data.action === 'status') {
    const row = await env.REMINDERS_DB.prepare('SELECT id FROM reminder_subscriptions WHERE id = ?').bind(id).first();
    return json({ enabled: !!row });
  }
  if (data.action !== 'enable' || !validSubscription(data.subscription)) return json({ error: 'Invalid subscription' }, 400);
  const s = data.subscription;
  try {
    await env.REMINDERS_DB.prepare(`INSERT INTO reminder_subscriptions (id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint, p256dh=excluded.p256dh, auth=excluded.auth`)
      .bind(id, s.endpoint, s.keys.p256dh, s.keys.auth, Date.now()).run();
  } catch { return json({ error: 'Could not register this device. Disable reminders and try again.' }, 409); }
  return json({ enabled: true });
}
