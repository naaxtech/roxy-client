import { NextResponse } from 'next/server';
import { releasePayout } from '@/app/(dashboard)/staff/payout-actions';

/**
 * Superseded by the releasePayout server action (ReleasePayoutButton no
 * longer calls this). Kept for a Studio tab opened before the deploy, on the
 * same path: core only, and a skipped release (not completed, waiting period,
 * blocked, already paid) is a 409 with the reason, not a 200 that looked like
 * money moved (ST-03).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { event_id?: unknown };
  try {
    const result = await releasePayout(typeof body.event_id === 'string' ? body.event_id : '');
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ success: true, message: result.message });
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}
