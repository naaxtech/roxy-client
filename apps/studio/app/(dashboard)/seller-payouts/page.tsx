import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { Badge } from '@/components/ui/badge';

const PAYOUT_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending:   { label: 'Pending',   className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  paid:      { label: 'Paid',      className: 'bg-green-100 text-green-800 border-green-200' },
  failed:    { label: 'Failed',    className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

async function getStripeBalance(stripeAccountId: string) {
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const balance = await stripe.balance.retrieve(
      {},
      { stripeAccount: stripeAccountId }
    );
    return balance;
  } catch {
    return null;
  }
}

export default async function SellerPayoutsPage() {
  const business = await getOwnedBusiness();

  if (!business) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Seller Payouts</h1>
        <p className="text-muted-foreground">
          You need a business to view payouts.{' '}
          <a href="/settings" className="text-primary underline-offset-4 hover:underline">
            Create one in Settings.
          </a>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: payouts } = await supabase
    .from('seller_payouts')
    .select('id, order_id, amount_cents, currency, status, stripe_transfer_id, created_at')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const payoutList = payouts ?? [];

  const totalEarnedCents = payoutList
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + (p.amount_cents ?? 0), 0);

  const stripeBalance = business.stripe_account_id
    ? await getStripeBalance(business.stripe_account_id)
    : null;

  const availableBalance = stripeBalance?.available
    ?.find(b => b.currency === 'usd')?.amount ?? null;

  const pendingBalance = stripeBalance?.pending
    ?.find(b => b.currency === 'usd')?.amount ?? null;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Seller Payouts</h1>
        <p className="text-muted-foreground mt-1">
          Payout history for{' '}
          <span className="font-medium text-foreground">{business.name}</span>.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 space-y-1">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Total Earned
          </p>
          <p className="text-2xl font-bold">${(totalEarnedCents / 100).toFixed(2)}</p>
        </div>

        {business.stripe_account_id ? (
          <>
            <div className="border rounded-lg p-4 space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Stripe Available
              </p>
              <p className="text-2xl font-bold">
                {availableBalance !== null
                  ? `$${(availableBalance / 100).toFixed(2)}`
                  : '—'}
              </p>
            </div>
            <div className="border rounded-lg p-4 space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Stripe Pending
              </p>
              <p className="text-2xl font-bold">
                {pendingBalance !== null
                  ? `$${(pendingBalance / 100).toFixed(2)}`
                  : '—'}
              </p>
            </div>
          </>
        ) : (
          <div className="border rounded-lg p-4 col-span-2 flex items-center">
            <p className="text-sm text-muted-foreground">
              <a href="/stripe-onboarding" className="text-primary underline-offset-4 hover:underline">
                Connect Stripe
              </a>{' '}
              to see your live balance.
            </p>
          </div>
        )}
      </div>

      {/* Payout history */}
      {payoutList.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payouts yet.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="text-left px-4 py-2.5 font-medium">Date</th>
                <th className="text-left px-4 py-2.5 font-medium">Order</th>
                <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium">Transfer</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payoutList.map(payout => {
                const badge = PAYOUT_STATUS_BADGE[payout.status] ?? PAYOUT_STATUS_BADGE.pending;
                return (
                  <tr key={payout.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(payout.created_at).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {payout.order_id ? `…${payout.order_id.slice(-8).toUpperCase()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ${((payout.amount_cents ?? 0) / 100).toFixed(2)}{' '}
                      <span className="text-muted-foreground text-xs uppercase">
                        {payout.currency ?? 'usd'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {payout.stripe_transfer_id ? (
                        <a
                          href={`https://dashboard.stripe.com/transfers/${payout.stripe_transfer_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline underline-offset-2"
                        >
                          {payout.stripe_transfer_id.slice(0, 20)}…
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
