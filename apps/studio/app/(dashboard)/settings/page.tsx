import { createClient } from '@/lib/supabase/server';
import { StripeBannerClient } from './StripeBannerClient';

type StripeStatus = 'not_started' | 'incomplete' | 'complete' | 'restricted';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) return null;

  const { data: stripeAccount } = await supabase
    .from('host_stripe_accounts')
    .select('stripe_account_id, onboarding_complete')
    .eq('user_id', userId)
    .maybeSingle();

  let stripeStatus: StripeStatus = 'not_started';
  if (stripeAccount?.onboarding_complete) stripeStatus = 'complete';
  else if (stripeAccount?.stripe_account_id) stripeStatus = 'incomplete';

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and payment settings.</p>
      </div>

      {params.stripe === 'success' && stripeStatus !== 'complete' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-700 text-sm">
          Stripe setup submitted. Your account will be activated once Stripe verifies your details
          (usually a few minutes).
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Payments</h2>
        <StripeBannerClient initialStatus={stripeStatus} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Account</h2>
        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-sm text-muted-foreground">User ID</p>
          <p className="font-mono text-sm">{userId}</p>
        </div>
      </section>
    </div>
  );
}
