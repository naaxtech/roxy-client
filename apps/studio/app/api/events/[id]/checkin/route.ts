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

  // Verify caller is the event host (or staff)
  const { data: event } = await supabase
    .from('events')
    .select('host_id')
    .eq('id', event_id)
    .single();

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  if (event.host_id !== auth.ctx.userId && !auth.ctx.isStaff) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { data: attendee, error } = await supabase
    .from('event_attendees')
    .update({ is_checked_in: true, checked_in_at: now })
    .eq('event_id', event_id)
    .eq('ticket_code', ticket_code)
    .select('user_id, ticket_code')
    .single();

  if (error || !attendee) {
    return NextResponse.json({ error: 'Ticket not found for this event' }, { status: 404 });
  }

  return NextResponse.json({ success: true, checked_in_at: now, user_id: attendee.user_id });
}
