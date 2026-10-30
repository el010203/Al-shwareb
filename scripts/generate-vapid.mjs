// Run locally. Never commit the output or paste private keys into chat.
import { webcrypto } from 'node:crypto';
const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await webcrypto.subtle.exportKey('raw', keys.publicKey);
const priv = await webcrypto.subtle.exportKey('jwk', keys.privateKey);
console.log('VAPID_PUBLIC_KEY=' + Buffer.from(pub).toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + priv.d);
