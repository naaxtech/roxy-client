import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getHostScope } from '@/lib/hostScope';
import { Badge } from '@/components/ui/badge';
import { CreateEventForm } from './CreateEventForm';

export default async function EventsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const scope = await getHostScope(supabase, userId, ['admin']);
  const communities = scope.communities.map((c) => ({ id: c.id, name: c.name }));
  const communityIds = communities.map((c) => c.id);

  const { data: events } = await supabase
    .from('events')
    .select('id, title, starts_at, is_paid, price_cents, status, communities(name)')
    .in('community_id', communityIds.length ? communityIds : ['none'])
    .order('starts_at', { ascending: false })
    .limit(50);

  const { data: stripeAccount } = await supabase
    .from('host_stripe_accounts')
    .select('onboarding_complete')
    .eq('user_id', userId)
    .maybeSingle();

  const stripeConnected = stripeAccount?.onboarding_complete ?? false;

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Events</h1>
        <p className="text-muted-foreground mt-1">
          {scope.isCore
            ? 'Every event on Roxy. Create, edit, and cancel any of them.'
            : 'Create and manage your events.'}
        </p>
      </div>

      {communities.length > 0 ? (
        <CreateEventForm
          communities={communities}
          stripeConnected={stripeConnected}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {scope.isCore
            ? 'There are no communities yet, so there is nowhere to put an event.'
            : 'You are not an admin of any community yet.'}
        </p>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{scope.isCore ? 'All events' : 'Your Events'}</h2>
        {(events ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No events yet.</p>
        ) : (
          <ul className="space-y-2">
            {(events ?? []).map((ev: any) => (
              <li key={ev.id}>
                <Link
                  href={`/events/${ev.id}`}
                  className="border rounded-lg p-4 flex items-center justify-between hover:bg-accent transition-colors block"
                >
                  <div>
                    <p className="font-medium">{ev.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(ev.starts_at).toLocaleDateString('en-US', {
                        weekday: 'short', day: 'numeric', month: 'short',
                        hour: 'numeric', minute: '2-digit',
                      })}{' '}
                      · {(ev.communities as any)?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ev.status === 'cancelled' && <Badge variant="destructive">Cancelled</Badge>}
                    {ev.status === 'completed' && <Badge variant="secondary">Completed</Badge>}
                    <Badge variant={ev.is_paid ? 'default' : 'secondary'}>
                      {ev.is_paid
                        ? `$${((ev.price_cents ?? 0) / 100).toFixed(2)}`
                        : 'Free'}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
