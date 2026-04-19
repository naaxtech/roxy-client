import Link from 'next/link';
import { getOwnedBusiness } from '@/lib/business';
import { Badge } from '@/components/ui/badge';
import { StripeOnboardingClient } from './StripeOnboardingClient';

export default async function StripeOnboardingPage() {
  const business = await getOwnedBusiness();

  if (!business) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Sell on Roxy</h1>
        <p className="text-muted-foreground">
          You need to create a business first before you can start selling.
        </p>
        <Link
          href="/settings"
          className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Go to Settings to create your business →
        </Link>
      </div>
    );
  }

  const isComplete = business.can_sell && Boolean(business.stripe_onboarded_at);
  const hasAccount = Boolean(business.stripe_account_id);
  const pendingApproval = !business.is_verified;

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sell on Roxy</h1>
        <p className="text-muted-foreground mt-1">
          Connect your Stripe account to accept payments for your products.
        </p>
      </div>

      {pendingApproval && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-amber-300">Business approval pending</p>
          <p className="text-amber-400/80 mt-0.5 text-xs">
            Your business is under review by the Roxy team. You&apos;ll receive an email once approved and can then connect Stripe and list products.
          </p>
        </div>
      )}

      <div className="border rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-3">
          <p className="font-semibold">{business.name}</p>
          {isComplete ? (
            <Badge className="bg-green-100 text-green-800 border-green-200">Active seller</Badge>
          ) : hasAccount ? (
            <Badge variant="secondary">Setup incomplete</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
        </div>

        {isComplete ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your Stripe account is connected and you&apos;re approved to sell on Roxy. Manage
              payouts, view balance, and update your Stripe settings from your dashboard.
            </p>
            <StripeOnboardingClient state="complete" />
          </div>
        ) : hasAccount ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You&apos;ve started connecting Stripe but haven&apos;t finished yet. Complete your
              setup to start selling.
            </p>
            <StripeOnboardingClient state="incomplete" />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect a Stripe account to receive payouts for your product sales. You&apos;ll be
              redirected to Stripe to complete the setup.
            </p>
            <StripeOnboardingClient state="no_stripe" />
          </div>
        )}
      </div>
    </div>
  );
}
