// KYC adapter.
//
// Roxy never holds an identity document. The vendor runs the capture, the
// vendor stores the artifact, and we keep a status, a session id, and a
// duplicate signal. That is a deliberate structural choice, not a convenience:
// a breach of our database has to be incapable of outing anyone.
//
// Everything vendor-specific lives behind KycAdapter so the choice stays
// reversible. Didit is the v1 pick (500 free full-KYC bundles/month, $0.33
// after, no minimum), but its DPA availability on the free tier is unconfirmed
// -- see the spec. If that answer comes back wrong, only this file changes.
//
// src: https://docs.didit.me/reference/api-authentication  · x-api-key header
// src: https://docs.didit.me/getting-started/quick-start   · POST /v2/session/
// src: https://docs.didit.me/reference/webhooks            · X-Signature-V2 HMAC over the raw body
// Verified 2026-08-01. The reference pages do not render for automated
// fetching, so the response field names below are matched permissively and
// validated at runtime rather than assumed -- an unexpected shape throws with
// the observed keys instead of silently writing a null session id.

export type KycStatus = 'pending' | 'approved' | 'declined' | 'expired' | 'abandoned';

export interface KycSession {
  /** Vendor-side session identifier. Stored, never secret. */
  providerSessionId: string;
  /** Hosted flow the applicant opens. The vendor owns this UI entirely. */
  verificationUrl: string;
}

export interface KycDecision {
  providerSessionId: string;
  status: KycStatus;
  /** Our own application id, round-tripped through the vendor's reference field. */
  applicationId: string | null;
  /**
   * Vendor-side identity hash used only to spot the same person returning
   * through a different community's code. Not a document number and not
   * derived from one we hold.
   */
  duplicateSignal: string | null;
}

export interface KycAdapter {
  readonly provider: string;
  createSession(applicationId: string, redirectUrl: string): Promise<KycSession>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<boolean>;
  parseWebhook(rawBody: string): KycDecision;
}

/** Constant-time compare. A naive === on an HMAC leaks it a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

/** First present, non-empty string among the candidate keys. */
function pick(source: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = source[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

const STATUS_MAP: Record<string, KycStatus> = {
  approved: 'approved',
  declined: 'declined',
  rejected: 'declined',
  expired: 'expired',
  abandoned: 'abandoned',
  pending: 'pending',
  in_progress: 'pending',
  not_started: 'pending',
  in_review: 'pending',
};

export class DiditAdapter implements KycAdapter {
  readonly provider = 'didit';

  constructor(
    private readonly apiKey: string,
    private readonly workflowId: string,
    private readonly webhookSecret: string,
    private readonly baseUrl = 'https://verification.didit.me/v2',
  ) {}

  async createSession(applicationId: string, redirectUrl: string): Promise<KycSession> {
    const res = await fetch(`${this.baseUrl}/session/`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: this.workflowId,
        // Round-tripped back to us on the webhook. It is our application id and
        // nothing else -- no email, no name, nothing that would tell the vendor
        // more about the applicant than the documents already do.
        vendor_data: applicationId,
        callback: redirectUrl,
      }),
    });

    if (!res.ok) {
      throw new Error(`didit create session failed: ${res.status}`);
    }

    const body = (await res.json()) as Record<string, unknown>;

    const providerSessionId = pick(body, ['session_id', 'id', 'sessionId']);
    const verificationUrl = pick(body, ['url', 'session_url', 'verification_url', 'sessionUrl']);

    if (!providerSessionId || !verificationUrl) {
      // Loud on the first sandbox call rather than a null session id in
      // production three weeks later.
      throw new Error(
        `didit session response missing id or url; keys were: ${Object.keys(body).join(',')}`,
      );
    }

    return { providerSessionId, verificationUrl };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<boolean> {
    const signature = headers.get('x-signature-v2') ?? headers.get('x-signature');
    const timestamp = headers.get('x-timestamp');
    if (!signature) return false;

    // Required, not optional. Treating a missing timestamp as "skip the freshness
    // check" means anyone who captures one valid callback can replay it forever
    // simply by dropping the header. If the vendor turns out not to send one,
    // this fails closed and says so in the logs on the first sandbox call --
    // which is the failure we want.
    if (!timestamp) {
      console.error('kyc: webhook rejected -- no x-timestamp header');
      return false;
    }

    const sent = Number(timestamp);
    if (!Number.isFinite(sent)) return false;
    const skewSeconds = Math.abs(Date.now() / 1000 - (sent > 1e11 ? sent / 1000 : sent));
    if (skewSeconds > 300) return false;

    // NOTE ON REPLAY. The vendor documents signing the raw JSON body, so the
    // timestamp above is almost certainly NOT part of the signed input -- which
    // means an attacker replaying a captured callback can rewrite the header to
    // "now" and the signature still validates. The freshness check is therefore
    // defence in depth and nothing more; the control that actually stops replay
    // is idempotency at the data layer in kyc-webhook, which refuses to move a
    // session that has already reached a terminal state.
    //
    // If Didit confirms the timestamp is bound into the HMAC, change the signed
    // input below to `${timestamp}.${rawBody}` and this becomes real protection.
    // Do not change it on assumption: sign the wrong string and every webhook
    // fails, silently stranding every applicant at "verification pending".

    // Signed over the exact bytes received. Re-stringifying the parsed JSON
    // reorders keys and changes whitespace, and the HMAC stops matching.
    const expected = await hmacSha256Hex(this.webhookSecret, rawBody);
    return timingSafeEqual(expected.toLowerCase(), signature.toLowerCase());
  }

  parseWebhook(rawBody: string): KycDecision {
    const body = JSON.parse(rawBody) as Record<string, unknown>;

    const providerSessionId = pick(body, ['session_id', 'id', 'sessionId']);
    if (!providerSessionId) {
      throw new Error(`didit webhook missing session id; keys were: ${Object.keys(body).join(',')}`);
    }

    const rawStatus = (pick(body, ['status', 'decision', 'session_status']) ?? '').toLowerCase();
    const status = STATUS_MAP[rawStatus] ?? 'pending';

    return {
      providerSessionId,
      status,
      applicationId: pick(body, ['vendor_data', 'vendorData', 'reference_id']),
      duplicateSignal: pick(body, ['duplicate_signal', 'identity_hash', 'face_hash']),
    };
  }
}

/**
 * Reads configuration once, at call time rather than module scope, so a missing
 * secret surfaces as a handled 503 instead of taking the whole function down on
 * cold start.
 */
export function getKycAdapter(): KycAdapter {
  const apiKey = Deno.env.get('DIDIT_API_KEY');
  const workflowId = Deno.env.get('DIDIT_WORKFLOW_ID');
  const webhookSecret = Deno.env.get('DIDIT_WEBHOOK_SECRET');

  if (!apiKey || !workflowId || !webhookSecret) {
    throw new Error('KYC provider is not configured');
  }

  return new DiditAdapter(apiKey, workflowId, webhookSecret);
}
