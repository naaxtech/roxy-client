import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

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
          <a href="/settings" className="underline">
            Settings
          </a>{' '}
          to see your payout information.
        </p>
      </div>
    );
  }

  const stripeDashboardUrl = `https://dashboard.stripe.com/express/${stripeAccount.stripe_account_id}`;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-muted-foreground mt-1">Your earnings and payout schedule.</p>
      </div>

      <div className="border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-medium">Stripe Account</p>
          <Badge>Connected</Badge>
        </div>
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">Fee tier</p>
          <p className="font-medium capitalize">{stripeAccount.fee_tier}</p>
        </div>
        <a
          href={stripeDashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm underline text-primary"
        >
          Open Stripe Express Dashboard →
        </a>
      </div>

      <p className="text-sm text-muted-foreground">
        Detailed payout history and balance are available in your Stripe Express Dashboard above.
      </p>
    </div>
  );
}
