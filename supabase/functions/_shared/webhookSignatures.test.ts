// Provider webhook signatures: Daily.co and Cloudflare Stream.
//
// Run from supabase/functions/:
//   deno test --no-check _shared/webhookSignatures.test.ts
//
// Why: both handlers checked a scheme the provider never sends.
//  * daily-webhook compared `x-daily-signature` to 'v1=' + hex(HMAC(utf8
//    secret, body)). Daily sends X-Webhook-Signature = base64(HMAC-SHA256(
//    base64-decoded secret, X-Webhook-Timestamp + '.' + body)) — so every real
//    join/leave was a 401 and Daily's signed {"test":"test"} probe failed
//    webhook creation. (docs.daily.co/reference/rest-api/webhooks, "hmac")
//  * cloudflare-video-webhook compared the whole Webhook-Signature header to
//    the secret. Cloudflare sends `time=<unix>,sig1=<hex HMAC-SHA256(secret,
//    time + '.' + body)>`, so no real "video ready" event ever matched.
//    (developers.cloudflare.com/stream/manage-video-library/using-webhooks)
// The vectors below are computed independently with WebCrypto in the test,
// so a verifier that hashes the wrong string, key encoding or digest
// encoding fails here.

import { verifyCloudflareStreamSignature, verifyDailySignature } from './webhookSignatures.ts';

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const enc = new TextEncoder();
async function hmac(keyBytes: Uint8Array<ArrayBuffer>, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ── Daily ────────────────────────────────────────────────────────────────
// The secret shape from Daily's docs (base64 of 32 random bytes).
const DAILY_SECRET = 'NQrSA5z0FkJ44QPrFerW7uCc5kdNLv3l2FDEKDanL1U=';
const DAILY_BODY = '{"version":"1.0.0","type":"participant.joined","id":"ptcpt-join-1","payload":{"room":"roxy-room-abc","session_id":"s1"},"event_ts":1708972279.961}';
const DAILY_TS = '1708972280';
const dailySig = async (ts = DAILY_TS, body = DAILY_BODY, secret = DAILY_SECRET) =>
  b64(await hmac(fromB64(secret), `${ts}.${body}`));

Deno.test('daily: a correctly signed event verifies', async () => {
  eq(await verifyDailySignature({ secret: DAILY_SECRET, signature: await dailySig(), timestamp: DAILY_TS, rawBody: DAILY_BODY }), true, 'valid');
});

Deno.test("daily: Daily's signed {\"test\":\"test\"} creation probe verifies", async () => {
  const body = '{"test":"test"}';
  eq(await verifyDailySignature({ secret: DAILY_SECRET, signature: await dailySig(DAILY_TS, body), timestamp: DAILY_TS, rawBody: body }), true, 'probe');
});

Deno.test('daily: tampered body, other timestamp, other secret are rejected', async () => {
  const sig = await dailySig();
  eq(await verifyDailySignature({ secret: DAILY_SECRET, signature: sig, timestamp: DAILY_TS, rawBody: DAILY_BODY.replace('joined', 'left') }), false, 'body');
  eq(await verifyDailySignature({ secret: DAILY_SECRET, signature: sig, timestamp: '1708972281', rawBody: DAILY_BODY }), false, 'timestamp');
  eq(await verifyDailySignature({ secret: 'b3RoZXItc2VjcmV0LW90aGVyLXNlY3JldC1vdGhlcg==', signature: sig, timestamp: DAILY_TS, rawBody: DAILY_BODY }), false, 'secret');
});

Deno.test('daily: the old scheme (utf8 key, hex, body only, v1= prefix) is rejected', async () => {
  const old = 'v1=' + hex(await hmac(enc.encode(DAILY_SECRET), DAILY_BODY));
  eq(await verifyDailySignature({ secret: DAILY_SECRET, signature: old, timestamp: DAILY_TS, rawBody: DAILY_BODY }), false, 'old scheme');
  // utf8 key but otherwise right: proves the secret is base64-DECODED
  const utf8Key = b64(await hmac(enc.encode(DAILY_SECRET), `${DAILY_TS}.${DAILY_BODY}`));
  eq(await verifyDailySignature({ secret: DAILY_SECRET, signature: utf8Key, timestamp: DAILY_TS, rawBody: DAILY_BODY }), false, 'utf8 key');
});

Deno.test('daily: missing secret / header / timestamp fail closed', async () => {
  const sig = await dailySig();
  eq(await verifyDailySignature({ secret: '', signature: sig, timestamp: DAILY_TS, rawBody: DAILY_BODY }), false, 'no secret');
  eq(await verifyDailySignature({ secret: undefined, signature: sig, timestamp: DAILY_TS, rawBody: DAILY_BODY }), false, 'unset secret');
  eq(await verifyDailySignature({ secret: DAILY_SECRET, signature: null, timestamp: DAILY_TS, rawBody: DAILY_BODY }), false, 'no signature');
  eq(await verifyDailySignature({ secret: DAILY_SECRET, signature: sig, timestamp: null, rawBody: DAILY_BODY }), false, 'no timestamp');
  eq(await verifyDailySignature({ secret: 'not base64 !!', signature: sig, timestamp: DAILY_TS, rawBody: DAILY_BODY }), false, 'bad secret encoding');
});

// ── Cloudflare Stream ────────────────────────────────────────────────────
const CF_SECRET = 'cf-stream-webhook-secret-for-tests';
const CF_BODY = '{"uid":"6b9e68b07dfee8cc2d116e4c51d6a957","readyToStream":true,"status":{"state":"ready"},"meta":{"name":"00000000-0000-0000-0000-000000000001"}}\n';
const NOW = 1_760_000_000;
const cfHeader = async (time = NOW, body = CF_BODY, secret = CF_SECRET) =>
  `time=${time},sig1=${hex(await hmac(enc.encode(secret), `${time}.${body}`))}`;

Deno.test('cloudflare: a correctly signed event verifies (newline in body kept)', async () => {
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: await cfHeader(), rawBody: CF_BODY, nowSeconds: NOW + 5 }), true, 'valid');
});

Deno.test('cloudflare: tampered body, other secret, swapped time are rejected', async () => {
  const h = await cfHeader();
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: h, rawBody: CF_BODY.trimEnd(), nowSeconds: NOW }), false, 'body (newline stripped)');
  eq(await verifyCloudflareStreamSignature({ secret: 'other', header: h, rawBody: CF_BODY, nowSeconds: NOW }), false, 'secret');
  const swapped = h.replace(`time=${NOW}`, `time=${NOW + 1}`);
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: swapped, rawBody: CF_BODY, nowSeconds: NOW }), false, 'time edited');
});

Deno.test('cloudflare: replay older than the tolerance (5 min) is rejected', async () => {
  const h = await cfHeader();
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: h, rawBody: CF_BODY, nowSeconds: NOW + 301 }), false, 'too old');
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: h, rawBody: CF_BODY, nowSeconds: NOW - 301 }), false, 'from the future');
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: h, rawBody: CF_BODY, nowSeconds: NOW + 299 }), true, 'inside tolerance');
});

Deno.test('cloudflare: the old static-secret header and malformed headers are rejected', async () => {
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: CF_SECRET, rawBody: CF_BODY, nowSeconds: NOW }), false, 'old: header == secret');
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: 'time=abc,sig1=00', rawBody: CF_BODY, nowSeconds: NOW }), false, 'non-numeric time');
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: `time=${NOW}`, rawBody: CF_BODY, nowSeconds: NOW }), false, 'no sig1');
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: null, rawBody: CF_BODY, nowSeconds: NOW }), false, 'no header');
  eq(await verifyCloudflareStreamSignature({ secret: '', header: `time=${NOW},sig1=${'0'.repeat(64)}`, rawBody: CF_BODY, nowSeconds: NOW }), false, 'empty secret fails closed');
});

Deno.test('cloudflare: header with spaces and upper-case hex still verifies', async () => {
  const h = (await cfHeader()).replace(',', ', ').replace(/sig1=([0-9a-f]+)/, (_, s) => `sig1=${s.toUpperCase()}`);
  eq(await verifyCloudflareStreamSignature({ secret: CF_SECRET, header: h, rawBody: CF_BODY, nowSeconds: NOW }), true, 'lenient parse');
});
