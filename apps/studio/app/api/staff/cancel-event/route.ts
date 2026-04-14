import { requireStaff, proxyToEdge } from '@/lib/staff-auth';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const auth = await requireStaff();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const { event_id, reason } = body as { event_id?: string; reason?: string };
  if (!event_id) {
    return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  }

  return proxyToEdge('cancel-event', auth.ctx.accessToken, { event_id, reason });
}
