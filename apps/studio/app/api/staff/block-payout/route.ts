import { NextResponse } from 'next/server';
import { setPayoutBlock } from '@/app/(dashboard)/staff/payout-actions';

/**
 * Superseded by the setPayoutBlock server action (BlockPayoutButton no longer
 * calls this). Kept so a Studio tab opened before the deploy still works, but
 * it now takes the same path: core only, reason required, through
 * staff_set_payout_block (migration 131), and it answers with what really
 * happened. The old body updated `events` directly — a non-core update matched
 * 0 rows and still returned success — and its audit insert could never land
 * (ST-03, SB-12).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { event_id?: unknown; reason?: unknown };
  try {
    const result = await setPayoutBlock(
      typeof body.event_id === 'string' ? body.event_id : '',
      true,
      typeof body.reason === 'string' ? body.reason : '',
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, message: result.message });
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
}
