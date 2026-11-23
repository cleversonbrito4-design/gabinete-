// Envio de "notificação push" (Web Push, RFC 8291 + VAPID RFC 8292) só com WebCrypto,
// sem biblioteca: funciona igual no Deno (Supabase) e no Node (testes).

const enc = new TextEncoder();
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const juntar = (...ps: Uint8Array[]) => { const o = new Uint8Array(ps.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
}

// par de chaves VAPID novo: { publica (65 bytes, base64url), privada (d, base64url) }
export async function novasChavesVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
  return { publica: b64u(pub), privada: jwk.d as string };
}

async function assinaturaVapid(endpoint: string, publica: string, privada: string, contato: string) {
  const p = deB64u(publica);
  const chave = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: privada, x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cab = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contato })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, enc.encode(cab + '.' + corpo)));
  return `vapid t=${cab}.${corpo}.${b64u(sig)}, k=${publica}`;
}

// cifra a mensagem para o aparelho (aes128gcm)
export async function cifrar(texto: string, p256dh: string, auth: string) {
  const uaPub = deB64u(p256dh);
  const segredo = deB64u(auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(segredo, ecdh, juntar(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cif = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, juntar(enc.encode(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return juntar(salt, rs, new Uint8Array([asPub.length]), asPub, cif);
}

export type Aparelho = { endpoint: string; p256dh: string; auth: string };
export async function enviarPush(ap: Aparelho, dados: unknown, vapid: { publica: string; privada: string }, contato: string, ttl = 1800) {
  const corpo = await cifrar(JSON.stringify(dados), ap.p256dh, ap.auth);
  return fetch(ap.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await assinaturaVapid(ap.endpoint, vapid.publica, vapid.privada, contato),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'high',
    },
    body: corpo,
  });
}
