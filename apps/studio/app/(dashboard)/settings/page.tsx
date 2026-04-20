import { createClient } from '@/lib/supabase/server';
import { getOwnedBusinessFull } from '@/lib/business';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BusinessForm } from './BusinessForm';
import { ProductStripeSection } from './ProductStripeSection';
import { StripeBannerClient } from './StripeBannerClient';
import { NotificationPrefsClient } from './NotificationPrefsClient';
import { DangerZoneClient } from './DangerZoneClient';
import { signOutAction } from '@/app/auth/signout-action';
import type { StudioNotificationPrefs } from './account-actions';

type StripeStatus = 'not_started' | 'incomplete' | 'complete';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string; product_stripe?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const userId = user.id;
  const userEmail = user.email ?? '';

  const [
    { data: stripeAccount },
    business,
    { data: profile },
  ] = await Promise.all([
    supabase
      .from('host_stripe_accounts')
      .select('stripe_account_id, onboarding_complete')
      .eq('user_id', userId)
      .maybeSingle(),
    getOwnedBusinessFull(),
    supabase
      .from('profiles')
      .select('display_name, notification_preferences')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  let stripeStatus: StripeStatus = 'not_started';
  if (stripeAccount?.onboarding_complete) stripeStatus = 'complete';
  else if (stripeAccount?.stripe_account_id) stripeStatus = 'incomplete';

  const notifPrefs: StudioNotificationPrefs = {
    studio_orders: (profile?.notification_preferences as any)?.studio_orders ?? true,
    studio_community: (profile?.notification_preferences as any)?.studio_community ?? true,
    studio_news: (profile?.notification_preferences as any)?.studio_news ?? true,
  };

  const businessIsRejected = Boolean(business) && !business!.is_verified && Boolean(business!.business_rejection_reason);
  const businessIsPending = Boolean(business) && !business!.is_verified && !business!.business_rejection_reason;
  const businessIsApproved = Boolean(business?.is_verified);

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account, business, and payment settings.</p>
      </div>

      {/* ── Account ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Account</h2>
        <div className="rounded-lg border p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Email</p>
              <p className="text-sm font-medium">{userEmail}</p>
            </div>
            {profile?.display_name && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Display name</p>
                <p className="text-sm font-medium">{profile.display_name}</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t">
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">Sign out</Button>
            </form>
            <a
              href={`mailto:support@roxy.app?subject=Password reset request`}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Reset password
            </a>
          </div>
        </div>
      </section>

      {/* ── Business Profile ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Business Profile</h2>

        {!business ? (
          <div className="rounded-lg border p-6 space-y-4">
            <div>
              <p className="text-sm font-medium">Register your business</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Submit your business for review. Once approved by the Roxy team, you can list products and connect Stripe for payments.
              </p>
            </div>
            <BusinessForm userId={userId} />
          </div>
        ) : (
          <div className="rounded-lg border p-6 space-y-6">
            {/* Status header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {business.logo_url && (
                  <img src={business.logo_url} alt="Business logo" className="h-12 w-12 rounded-lg object-cover border" />
                )}
                <div>
                  <p className="font-semibold">{business.name}</p>
                  {business.category && <p className="text-sm text-muted-foreground">{business.category}</p>}
                  {business.location_city && <p className="text-xs text-muted-foreground">{business.location_city}</p>}
                </div>
              </div>
              {businessIsApproved ? (
                <Badge className="bg-green-100 text-green-800 border-green-200 shrink-0">Approved</Badge>
              ) : businessIsRejected ? (
                <Badge variant="destructive" className="shrink-0">Rejected</Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">Pending review</Badge>
              )}
            </div>

            {/* Rejection reason */}
            {businessIsRejected && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm">
                <p className="font-medium text-destructive">Application rejected</p>
                <p className="text-xs text-muted-foreground mt-0.5">{business.business_rejection_reason}</p>
                <p className="text-xs text-muted-foreground mt-1">Update your details below and save to resubmit for review.</p>
              </div>
            )}

            {/* Pending note */}
            {businessIsPending && (
              <p className="text-xs text-muted-foreground">
                Under review by the Roxy team. You&apos;ll receive an email once approved.
              </p>
            )}

            {/* Product Stripe — only when approved */}
            {businessIsApproved && (
              <div className="border-t pt-4">
                <ProductStripeSection
                  canSell={business.can_sell}
                  stripeAccountId={business.stripe_account_id}
                  stripeOnboardedAt={business.stripe_onboarded_at}
                  returnParam={params.product_stripe ?? null}
                />
              </div>
            )}

            {/* Edit form */}
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-4">Edit business details</p>
              <BusinessForm userId={userId} business={business} />
            </div>
          </div>
        )}
      </section>

      {/* ── Event Payments ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Event Payments</h2>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground mb-3">
            Connect Stripe to receive payouts from paid event tickets hosted in your communities.
          </p>
          {params.stripe === 'success' && stripeStatus !== 'complete' && (
            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 mb-3">
              Stripe setup submitted. Your account will activate once Stripe verifies your details.
            </p>
          )}
          <StripeBannerClient initialStatus={stripeStatus} />
        </div>
      </section>

      {/* ── Notifications ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Email Notifications</h2>
        <div className="rounded-lg border p-4">
          <NotificationPrefsClient initialPrefs={notifPrefs} />
        </div>
      </section>

      {/* ── Danger Zone ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
        <DangerZoneClient />
      </section>
    </div>
  );
}
