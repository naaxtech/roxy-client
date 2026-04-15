import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

const RISK_BADGE: Record<string, { label: string; className: string }> = {
  low:      { label: 'Low',      className: 'bg-green-100 text-green-800 border-green-200' },
  medium:   { label: 'Medium',   className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  high:     { label: 'High',     className: 'bg-orange-100 text-orange-800 border-orange-200' },
  critical: { label: 'Critical', className: 'bg-red-100 text-red-800 border-red-200' },
};

export default async function StaffDisputesPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) notFound();

  const { data: disputes } = await supabase
    .from('orders')
    .select('id, status, total_cents, created_at, stripe_payment_intent_id, risk_level, buyer_id')
    .eq('status', 'disputed')
    .order('created_at', { ascending: false });

  const disputeList = disputes ?? [];

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Disputes</h1>
        {disputeList.length > 0 && (
          <Badge variant="destructive">{disputeList.length}</Badge>
        )}
      </div>
      <p className="text-muted-foreground -mt-4">Orders currently in dispute. Review via Stripe.</p>

      {disputeList.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active disputes.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="text-left px-4 py-2.5 font-medium">Order ID</th>
                <th className="text-left px-4 py-2.5 font-medium">Buyer</th>
                <th className="text-right px-4 py-2.5 font-medium">Total</th>
                <th className="text-left px-4 py-2.5 font-medium">Risk</th>
                <th className="text-left px-4 py-2.5 font-medium">Payment Intent</th>
                <th className="text-left px-4 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {disputeList.map(order => {
                const risk = order.risk_level
                  ? RISK_BADGE[String(order.risk_level)] ?? RISK_BADGE.medium
                  : null;
                return (
                  <tr key={order.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">
                      …{order.id.slice(-8).toUpperCase()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      …{order.buyer_id?.slice(-8).toUpperCase() ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ${((order.total_cents ?? 0) / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      {risk ? (
                        <Badge className={risk.className}>{risk.label}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {order.stripe_payment_intent_id ? (
                        <a
                          href={`https://dashboard.stripe.com/payments/${order.stripe_payment_intent_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline underline-offset-2"
                        >
                          {String(order.stripe_payment_intent_id).slice(0, 22)}…
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(order.created_at).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
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
