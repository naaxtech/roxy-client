// Pure verifiers for provider webhook signatures. No I/O; index.ts files are
// wiring only. Tests: _shared/webhookSignatures.test.ts.
import { constantTimeEqual } from './serviceAuth.ts';

const enc = new TextEncoder();

async function hmacSha256(key: Uint8Array<ArrayBuffer>, message: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

function toBase64(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}

function toHex(u: Uint8Array): string {
  return Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.trim());
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Daily.co webhook (docs.daily.co/reference/rest-api/webhooks, "hmac"):
 *   X-Webhook-Signature = base64( HMAC-SHA256( base64decode(secret),
 *                                              X-Webhook-Timestamp + '.' + rawBody ) )
 * The secret is the base64 `hmac` returned by (or passed to) POST /webhooks.
 * Daily also signs the {"test":"test"} probe it sends when a webhook is
 * created, updated or re-activated, so this must pass for that body too.
 */
export async function verifyDailySignature(input: {
  secret: string | null | undefined;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  rawBody: string;
}): Promise<boolean> {
  const { secret, signature, timestamp, rawBody } = input;
  if (!secret || !signature || !timestamp) return false;
  const key = fromBase64(secret);
  if (!key || key.length === 0) return false;
  const expected = toBase64(await hmacSha256(key, `${timestamp}.${rawBody}`));
  return constantTimeEqual(signature.trim(), expected);
}

/** Replay window for Cloudflare Stream deliveries, seconds. */
export const CLOUDFLARE_TOLERANCE_SECONDS = 300;

/**
 * Cloudflare Stream webhook (developers.cloudflare.com/stream/manage-video-library/using-webhooks):
 *   Webhook-Signature: time=<unix seconds>,sig1=<hex HMAC-SHA256(secret, time + '.' + rawBody)>
 * Requests whose `time` is more than CLOUDFLARE_TOLERANCE_SECONDS away from
 * now are discarded (Cloudflare: "discard requests with timestamps that are
 * too old").
 */
export async function verifyCloudflareStreamSignature(input: {
  secret: string | null | undefined;
  header: string | null | undefined;
  rawBody: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const { secret, header, rawBody } = input;
  if (!secret || !header) return false;

  let time: string | null = null;
  let sig1: string | null = null;
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 'time') time = v;
    else if (k === 'sig1') sig1 = v;
  }
  if (!time || !sig1 || !/^\d{1,12}$/.test(time) || !/^[0-9a-fA-F]{64}$/.test(sig1)) return false;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? CLOUDFLARE_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(time)) > tolerance) return false;

  const expected = toHex(await hmacSha256(enc.encode(secret), `${time}.${rawBody}`));
  return constantTimeEqual(sig1.toLowerCase(), expected);
}
