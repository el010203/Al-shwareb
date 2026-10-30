// RFC 8291 aes128gcm + RFC 8292 VAPID, using Workers' native Web Crypto.
const enc = new TextEncoder();
export const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const base64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
};
async function hkdf(secret, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}
export async function encryptPayload(subscription, message) {
  const receiver = bytes(subscription.p256dh);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sender = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const publicKey = await crypto.subtle.importKey('raw', receiver, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, pair.privateKey, 256);
  const ikm = await hkdf(shared, bytes(subscription.auth), join(enc.encode('WebPush: info\0'), receiver, sender), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plaintext = join(enc.encode(message), new Uint8Array([2])); // final record delimiter
  if (plaintext.length + 16 > 4096) throw new Error('Push payload too large');
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext));
  return join(salt, new Uint8Array([0, 0, 16, 0, sender.length]), sender, ciphertext);
}
export async function vapidAuthorization(endpoint, env) {
  const publicKey = bytes(env.VAPID_PUBLIC_KEY);
  const privateKey = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: base64url(publicKey.slice(1, 33)),
    y: base64url(publicKey.slice(33)), d: env.VAPID_PRIVATE_KEY,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = base64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 3600, sub: env.VAPID_SUBJECT,
  })));
  const input = `${header}.${claims}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(input));
  return `vapid t=${input}.${base64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}
export async function sendReminder(subscription, env) {
  const body = await encryptPayload(subscription, JSON.stringify({ title: 'New transaction', body: 'Any new transactions? Tap to record one.' }));
  return fetch(subscription.endpoint, {
    method: 'POST', redirect: 'error', headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, env),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: '900', Urgency: 'normal', Topic: 'new-transaction',
    }, body, signal: AbortSignal.timeout(15000),
  });
}
