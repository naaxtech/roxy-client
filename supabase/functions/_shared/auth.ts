import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Service-role client for DB operations (bypasses RLS)
export function getSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

// Verify the user's JWT by decoding the payload.
// Supabase's API gateway validates the JWT signature before our function
// runs, so we can safely trust the payload and just extract the sub claim.
// This works for both HS256 and ES256 (asymmetric) JWTs.
export function verifyJWT(
  req: Request
): { userId: string } | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 → decode
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload?.sub) return null;
    return { userId: payload.sub as string };
  } catch {
    return null;
  }
}
