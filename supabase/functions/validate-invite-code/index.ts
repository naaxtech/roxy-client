// validate-invite-code
//
// Pre-auth. This is the one endpoint an attacker can reach without an account,
// so it is also the one that has to be boring: it answers valid/invalid and
// nothing else, and it never tells the caller whether a code it rejected was
// real.
//
// Postgres cannot see the caller's IP, so the hashing happens here and the
// hash is passed to validate_invite_code(). That RPC is service-role only --
// exposing it to anon would let a client mint a fresh ip_hash per request and
// walk straight through its own rate limit.

import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

/** Reasons the client is allowed to see. Anything else collapses to 'invalid'. */
const PUBLIC_REASONS = new Set([
  'invalid',
  'revoked',
  'expired',
  'exhausted',
  'locked',
  'rate_limited',
]);

/**
 * Salted so the table cannot be rainbow-tabled back to an IP list. An
 * unsuccessful applicant's IP is still personal data and we have no reason to
 * hold it in the clear.
 */
async function hashIp(ip: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function callerIp(req: Request): string {
  // RIGHTMOST, not leftmost. x-forwarded-for is append-only: whatever the
  // client sends arrives on the left, and each trusted proxy appends its view
  // of the peer on the right. Taking the left-hand entry means an attacker sets
  // `X-Forwarded-For: <anything>` and receives a fresh rate-limit bucket on
  // every single request -- which would make the 5/hour limit on the only
  // pre-auth endpoint in the app purely decorative.
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const hops = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  // cf-connecting-ip is set by the edge and cannot be overridden from outside.
  // 'unknown' collapses everyone into one bucket, which throttles harder rather
  // than less -- the safe direction to fail.
  return req.headers.get('cf-connecting-ip') ?? 'unknown';
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { code } = await req.json();

    if (typeof code !== 'string' || code.trim().length < 4 || code.trim().length > 32) {
      // Same shape as a real rejection so length probing tells nothing.
      return successResponse({ ok: false, reason: 'invalid' });
    }

    const salt = Deno.env.get('CODE_HASH_SALT');
    if (!salt) {
      // Fail closed. Hashing with a missing salt would silently produce a
      // predictable digest across every deployment.
      return errorResponse('Verification is temporarily unavailable.', 503);
    }

    // Service role: validate_invite_code() is deliberately not granted to anon
    // or authenticated, so this is the only path that can reach it.
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.rpc('validate_invite_code', {
      p_code: code,
      p_ip_hash: await hashIp(callerIp(req), salt),
    });

    if (error) {
      // Never surface a Postgres message to a pre-auth caller.
      console.error('validate_invite_code failed', error.code);
      return errorResponse('Could not check that code. Try again.', 500);
    }

    if (!data?.ok) {
      const reason = PUBLIC_REASONS.has(data?.reason) ? data.reason : 'invalid';
      return successResponse({ ok: false, reason });
    }

    // On success the community name is returned so the applicant can see who
    // vouched for them before they commit to signing up. The code id is not
    // returned -- the signup RPC re-resolves it from the code itself.
    return successResponse({
      ok: true,
      community_name: data.community_name ?? null,
    });
  } catch (_err) {
    return errorResponse('Could not check that code. Try again.', 400);
  }
});
