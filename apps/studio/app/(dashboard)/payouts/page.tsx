import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { StripeDashboardButton } from './StripeDashboardButton';

type PayoutStatus = 'pending' | 'released' | 'blocked' | 'active';

function payoutStatus(ev: {
  status: string;
  payout_blocked: boolean;
  payout_released_at: string | null;
}): PayoutStatus {
  if (ev.status === 'active') return 'active';
  if (ev.payout_blocked) return 'blocked';
  if (ev.payout_released_at) return 'released';
  return 'pending';
}

function payoutBadge(ps: PayoutStatus) {
  switch (ps) {
    case 'released': return <Badge className="bg-green-600 hover:bg-green-600">Paid Out</Badge>;
    case 'blocked': return <Badge variant="destructive">Blocked</Badge>;
    case 'pending': return <Badge variant="secondary">Pending</Badge>;
    case 'active': return <Badge variant="outline">In Progress</Badge>;
  }
}

export default async function PayoutsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: stripeAccount } = await supabase
    .from('host_stripe_accounts')
    .select('stripe_account_id, onboarding_complete, fee_tier')
    .eq('user_id', userId)
    .maybeSingle();

  if (!stripeAccount?.onboarding_complete) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-muted-foreground">
          Connect and complete Stripe setup in{' '}
          <a href="/settings" className="underline">Settings</a>{' '}
          to see your payout information.
        </p>
      </div>
    );
  }

  // Events hosted by this user that are paid, with aggregated payment_logs
  const { data: events } = await supabase
    .from('events')
    .select(`
      id, title, starts_at, status, payout_blocked, payout_released_at,
      price_cents, currency, payout_delay_days
    `)
    .eq('host_id', userId)
    .eq('is_paid', true)
    .order('starts_at', { ascending: false })
    .limit(50);

  // Fetch payment_logs summary per event
  const eventIds = (events ?? []).map(e => e.id);
  const { data: paymentLogs } = eventIds.length
    ? await supabase
        .from('payment_logs')
        .select('event_id, amount_cents, status, stripe_refund_id')
        .in('event_id', eventIds)
    : { data: [] };

  // Build per-event summary
  const logsByEvent = new Map<string, { gross: number; refunded: number }>();
  for (const log of paymentLogs ?? []) {
    const cur = logsByEvent.get(log.event_id) ?? { gross: 0, refunded: 0 };
    if (log.status === 'succeeded') cur.gross += log.amount_cents;
    if (log.stripe_refund_id) cur.refunded += log.amount_cents;
    logsByEvent.set(log.event_id, cur);
  }

  const feeRate = stripeAccount.fee_tier === 'pro' ? 0.05 : stripeAccount.fee_tier === 'partner' ? 0.03 : 0.08;

  let totalGross = 0;
  let totalNet = 0;
  for (const { gross, refunded } of logsByEvent.values()) {
    const net = gross - refunded - Math.round((gross - refunded) * feeRate);
    totalGross += gross;
    totalNet += net;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-muted-foreground mt-1">Earnings reconciliation for your paid events.</p>
      </div>

      <div className="border rounded-lg p-5 flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">Stripe Account</p>
            <Badge>Connected</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Fee tier: <span className="font-medium capitalize">{stripeAccount.fee_tier}</span>
            {' '}({Math.round(feeRate * 100)}% platform fee)
          </p>
        </div>
        <StripeDashboardButton />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Total Gross (all events)</p>
          <p className="text-2xl font-bold mt-1">${(totalGross / 100).toFixed(2)}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Est. Net (after fees + refunds)</p>
          <p className="text-2xl font-bold mt-1">${(totalNet / 100).toFixed(2)}</p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Event Breakdown</h2>
        {(events ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No paid events yet.</p>
        ) : (
          <ul className="space-y-2">
            {(events ?? []).map(ev => {
              const logs = logsByEvent.get(ev.id) ?? { gross: 0, refunded: 0 };
              const net = logs.gross - logs.refunded - Math.round((logs.gross - logs.refunded) * feeRate);
              const ps = payoutStatus(ev as any);
              return (
                <li key={ev.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/events/${ev.id}`} className="font-medium hover:underline">
                        {ev.title}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(ev.starts_at).toLocaleDateString('en-US', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                        {ev.payout_delay_days
                          ? ` · payout ${ev.payout_delay_days}d after end`
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {payoutBadge(ps)}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Gross</p>
                      <p className="font-medium">${(logs.gross / 100).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Refunded</p>
                      <p className="font-medium">${(logs.refunded / 100).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Est. Net</p>
                      <p className="font-semibold text-green-600">${(net / 100).toFixed(2)}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
