import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Service-role client for DB operations (bypasses RLS)
export function getSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Anon-key client used only to verify inbound user JWTs. Held at module scope so
// the JWKS fetched on first use is reused for the life of the isolate.
// src: https://supabase.com/docs/guides/functions/auth · supabase-js 2.111.0 · 2026-08-02
let verifierClient: SupabaseClient | null = null;

function getVerifierClient(): SupabaseClient {
  if (verifierClient === null) {
    verifierClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return verifierClient;
}

function extractBearer(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Re-checks the claims that authorise the request, on top of the signature
 * check getClaims() already performed. `role` keeps anon and service-role
 * tokens out of a per-user identity, and the uuid shape on `sub` keeps a
 * non-user principal from being spliced into a `user_id` filter.
 */
function userIdFromClaims(claims: Record<string, unknown>): string | null {
  if (claims.role !== 'authenticated') return null;

  const exp = claims.exp;
  if (typeof exp !== 'number' || exp * 1000 <= Date.now()) return null;

  const sub = claims.sub;
  if (typeof sub !== 'string' || !UUID_RE.test(sub)) return null;

  return sub;
}

/**
 * Cryptographically verifies the caller's JWT and returns their user id.
 *
 * getClaims() validates the signature against the project's JWKS
 * (`/.well-known/jwks.json`, cached locally) for asymmetric signing keys, and
 * falls back to an Auth-server round trip for legacy HS256 secrets. A token the
 * caller minted themselves therefore never yields a user id, regardless of what
 * `sub` they put in the payload.
 *
 * Fails closed. A missing header, a malformed token, a bad signature, an
 * expired token, a non-`authenticated` role, a non-uuid `sub`, or a misconfigured
 * environment all return null — there is no path that returns an id without a
 * verified signature.
 *
 * src: https://supabase.com/docs/reference/javascript/auth-getclaims · supabase-js 2.111.0 · 2026-08-02
 */
export async function verifyJWT(req: Request): Promise<{ userId: string } | null> {
  const token = extractBearer(req);
  if (token === null) return null;

  try {
    const { data, error } = await getVerifierClient().auth.getClaims(token);
    if (error !== null || data === null) return null;
    const userId = userIdFromClaims(data.claims);
    return userId === null ? null : { userId };
  } catch {
    return null;
  }
}
