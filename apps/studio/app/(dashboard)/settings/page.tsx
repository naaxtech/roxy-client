import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { StripeBannerClient } from './StripeBannerClient';
import { CreateBusinessForm } from './CreateBusinessForm';

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

  const [
    { data: stripeAccount },
    { data: business },
  ] = await Promise.all([
    supabase
      .from('host_stripe_accounts')
      .select('stripe_account_id, onboarding_complete')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('businesses')
      .select('id, name, category, location_city, is_verified, business_rejection_reason, created_at')
      .eq('owner_id', userId)
      .maybeSingle(),
  ]);

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

      {/* Business profile */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Business Profile</h2>

        {business ? (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{business.name}</p>
                {business.category && (
                  <p className="text-sm text-muted-foreground">{business.category}</p>
                )}
                {business.location_city && (
                  <p className="text-xs text-muted-foreground">{business.location_city}</p>
                )}
              </div>
              {business.is_verified ? (
                <Badge className="bg-green-100 text-green-800 border-green-200 shrink-0">
                  Approved
                </Badge>
              ) : business.business_rejection_reason ? (
                <Badge variant="destructive" className="shrink-0">Rejected</Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">Pending review</Badge>
              )}
            </div>

            {business.business_rejection_reason && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className="font-medium">Application rejected</p>
                <p className="mt-0.5 text-xs">{business.business_rejection_reason}</p>
              </div>
            )}

            {!business.is_verified && !business.business_rejection_reason && (
              <p className="text-xs text-muted-foreground">
                Under review by the Roxy team. You&apos;ll receive an email once approved.
              </p>
            )}

            {business.is_verified && (
              <p className="text-xs text-muted-foreground">
                Your business is approved.{' '}
                <Link href="/stripe-onboarding" className="text-primary underline-offset-2 hover:underline">
                  Connect Stripe to start selling →
                </Link>
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border p-6 space-y-4">
            <div>
              <p className="text-sm font-medium">Register your business</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Submit your business for review. Once approved by the Roxy team, you can list products and connect Stripe for payments.
              </p>
            </div>
            <CreateBusinessForm />
          </div>
        )}
      </section>

      {/* Event payments (host_stripe_accounts) */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Event Payments</h2>
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
