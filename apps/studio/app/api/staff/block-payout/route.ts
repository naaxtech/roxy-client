import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff-auth';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const auth = await requireStaff();
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const { event_id, reason } = body as { event_id?: string; reason?: string };
  if (!event_id) {
    return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  }

  // Service-role client to bypass RLS for staff operation
  const supabase = await createClient();
  const { error } = await supabase
    .from('events')
    .update({ payout_blocked: true })
    .eq('id', event_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Write audit log
  await supabase.from('audit_log').insert({
    event_id,
    action: 'payout_blocked',
    staff_id: auth.ctx.userId,
    notes: reason ?? null,
  });

  return NextResponse.json({ success: true });
}
