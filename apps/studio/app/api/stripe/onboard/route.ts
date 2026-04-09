import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get session for the access token to pass to the edge function
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await fetch(`${supabaseUrl}/functions/v1/stripe-connect-onboard`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  const json = await res.json();
  if (!json.success) {
    return NextResponse.json({ error: json.error ?? 'Failed to create onboarding link' }, { status: res.status });
  }
  return NextResponse.json(json.data);
}
