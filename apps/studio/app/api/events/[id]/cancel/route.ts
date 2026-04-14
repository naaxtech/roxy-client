import { getAuthContext, proxyToEdge } from '@/lib/staff-auth';
import { NextResponse } from 'next/server';

// Host cancels their own event — cancel-event edge function enforces host ownership
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext();
  if ('error' in auth) return auth.error;

  const { id: event_id } = await params;
  const body = await request.json().catch(() => ({}));
  const { reason } = body as { reason?: string };

  if (!event_id) {
    return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  }

  return proxyToEdge('cancel-event', auth.ctx.accessToken, { event_id, reason });
}
