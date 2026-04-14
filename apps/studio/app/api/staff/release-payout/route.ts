import { NextResponse } from 'next/server';
import { requireStaff, proxyToEdgeServiceRole } from '@/lib/staff-auth';

export async function POST(request: Request) {
  const auth = await requireStaff();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const { event_id } = body as { event_id?: string };
  if (!event_id) {
    return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  }

  return proxyToEdgeServiceRole('release-payout', { event_id });
}
