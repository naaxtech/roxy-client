import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { AttendeeList } from './AttendeeList';
import { CancelEventButton } from './CancelEventButton';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: event } = await supabase
    .from('events')
    .select(`
      id, title, description, starts_at, ends_at, location_text, status,
      is_paid, price_cents, currency, payout_delay_days, payout_blocked,
      host_id, max_attendees,
      communities(id, name)
    `)
    .eq('id', id)
    .single();

  if (!event) notFound();

  // Must be host or member of this community
  const { data: membership } = await supabase
    .from('community_members')
    .select('role')
    .eq('community_id', (event.communities as any)?.id)
    .eq('user_id', user.id)
    .maybeSingle();

  const isHost = event.host_id === user.id;
  const isAdmin = membership?.role === 'admin';
  if (!isHost && !isAdmin) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', user.id)
    .single();
  const isStaff = profile?.is_staff === true;

  const { data: attendees } = await supabase
    .from('event_attendees')
    .select('user_id, ticket_code, is_checked_in, checked_in_at, rsvp_at, profiles(display_name, avatar_url)')
    .eq('event_id', id)
    .order('rsvp_at', { ascending: true });

  const dateStr = new Date(event.starts_at).toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit',
  });

  const checkedInCount = (attendees ?? []).filter(a => a.is_checked_in).length;
  const totalCount = (attendees ?? []).length;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold">{event.title}</h1>
            {event.status === 'cancelled' && <Badge variant="destructive">Cancelled</Badge>}
            {event.status === 'completed' && <Badge variant="secondary">Completed</Badge>}
            {event.status === 'active' && <Badge variant="default">Active</Badge>}
          </div>
          <p className="text-muted-foreground">{dateStr}</p>
          {event.location_text && (
            <p className="text-sm text-muted-foreground mt-1">📍 {event.location_text}</p>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            Community: {(event.communities as any)?.name}
          </p>
          {(event as any).description && (
            <p className="text-sm text-foreground/80 mt-3 leading-relaxed max-w-xl">
              {(event as any).description}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge variant={event.is_paid ? 'default' : 'secondary'} className="text-base px-3 py-1">
            {event.is_paid
              ? `$${((event.price_cents ?? 0) / 100).toFixed(2)}`
              : 'Free'}
          </Badge>
          {event.status === 'active' && (isHost || isStaff) && (
            <CancelEventButton eventId={id} isStaff={isStaff} />
          )}
        </div>
      </div>

      {event.is_paid && (
        <div className="border rounded-lg p-4 bg-muted/40 space-y-1 text-sm">
          <p><span className="font-medium">Payout delay:</span> {event.payout_delay_days ?? 7} days after event ends</p>
          {event.payout_blocked && (
            <p className="text-destructive font-medium">⚠️ Payout is blocked — contact support</p>
          )}
        </div>
      )}

      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Attendees</h2>
          <span className="text-sm text-muted-foreground">
            {checkedInCount}/{totalCount} checked in
            {event.max_attendees ? ` · cap ${event.max_attendees}` : ''}
          </span>
        </div>
        <AttendeeList attendees={(attendees ?? []) as any} eventId={id} canCheckin={isHost || isAdmin} />
      </div>
    </div>
  );
}
