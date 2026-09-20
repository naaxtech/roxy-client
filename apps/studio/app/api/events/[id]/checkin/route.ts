import { getAuthContext } from '@/lib/staff-auth';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Host checks in an attendee by ticket_code
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext();
  if ('error' in auth) return auth.error;

  const { id: event_id } = await params;
  const body = await request.json().catch(() => ({}));
  const { ticket_code } = body as { ticket_code?: string };

  if (!ticket_code) {
    return NextResponse.json({ error: 'ticket_code required' }, { status: 400 });
  }

  const supabase = await createClient();

  // Host/staff check + the column-restricted update both happen inside the
  // checkin_attendee() SECURITY DEFINER RPC (066_checkin_attendee_rpc.sql) --
  // there's no longer a direct-update RLS policy for a client to bypass this
  // route with.
  const { data, error } = await supabase
    .rpc('checkin_attendee', { p_event_id: event_id, p_ticket_code: ticket_code })
    .single();

  if (error) {
    const status = error.message === 'Event not found' ? 404
      : error.message === 'Forbidden' ? 403
      : 404;
    return NextResponse.json({ error: error.message || 'Ticket not found for this event' }, { status });
  }

  const attendee = data as { user_id: string; ticket_code: string; checked_in_at: string };
  return NextResponse.json({ success: true, checked_in_at: attendee.checked_in_at, user_id: attendee.user_id });
}
