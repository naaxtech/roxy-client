import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Service-role client for DB operations (bypasses RLS)
export function getSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

// Verify the user's JWT using getClaims() — works with Supabase's
// new asymmetric ES256 signing keys. The old auth.getUser() approach
// is broken with ES256 and always returns 401.
export async function verifyJWT(
  req: Request
): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');

  // Use the anon key client for JWT claim extraction (no network round-trip)
  const authClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await authClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;

  return { userId: data.claims.sub as string };
}
