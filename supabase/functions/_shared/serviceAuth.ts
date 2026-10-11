// Service-to-service authentication for edge functions that run with
// verify_jwt = false and are called only by pg_cron / pg_net / ops scripts
// with the service-role key (release-payout, process-refunds,
// auto-complete-events, push-dispatch, process-email-queue, reconcile-orders).
//
// Rules (tests: _shared/serviceAuth.test.ts):
//   * the header must be exactly `Bearer <key>` (scheme case-insensitive);
//   * the key is compared in constant time, never with includes()/===;
//   * an empty or unset SUPABASE_SERVICE_ROLE_KEY rejects EVERY caller.

/** Constant-time string compare (length leaks, content does not). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** The token of a well-formed `Bearer <token>` header, else null. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/**
 * True only when the request carries `Authorization: Bearer <service key>`.
 * `serviceKey` defaults to SUPABASE_SERVICE_ROLE_KEY; pass it explicitly in tests.
 */
export function isServiceRequest(req: Request, serviceKey?: string | null): boolean {
  // An explicitly passed key (even undefined/'') wins over the env var.
  const key = arguments.length >= 2 ? serviceKey : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) return false;
  const token = bearerToken(req.headers.get('Authorization'));
  if (token === null) return false;
  return constantTimeEqual(token, key);
}
