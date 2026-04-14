import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export interface AuthContext {
  userId: string;
  accessToken: string;
  isStaff: boolean;
}

/**
 * Verifies JWT and returns auth context. Returns a 401 NextResponse if invalid.
 * Caller decides whether to enforce is_staff.
 */
export async function getAuthContext(): Promise<{ ctx: AuthContext } | { error: NextResponse }> {
  const supabase = await createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .single();

  return {
    ctx: {
      userId: user.id,
      accessToken,
      isStaff: profile?.is_staff === true,
    },
  };
}

/** Require is_staff = true. Returns 403 NextResponse if not staff. */
export async function requireStaff(): Promise<{ ctx: AuthContext } | { error: NextResponse }> {
  const result = await getAuthContext();
  if ('error' in result) return result;
  if (!result.ctx.isStaff) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return result;
}

/** Forward a POST body to a Supabase edge function with the user's JWT. */
export async function proxyToEdge(
  functionName: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) {
    return NextResponse.json({ error: json.error ?? 'Edge function error' }, { status: res.status });
  }
  return NextResponse.json(json.data ?? json);
}

/** Forward with service-role key (staff-only operations). */
export async function proxyToEdgeServiceRole(
  functionName: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) {
    return NextResponse.json({ error: json.error ?? 'Edge function error' }, { status: res.status });
  }
  return NextResponse.json(json.data ?? json);
}
