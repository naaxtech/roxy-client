'use client';

import { useTransition, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { connectBusinessStripe, getBusinessStripeDashboardLink } from './business-actions';

type Props = {
  canSell: boolean;
  stripeAccountId: string | null;
  stripeOnboardedAt: string | null;
  returnParam: string | null;
};

export function ProductStripeSection({ canSell, stripeAccountId, stripeOnboardedAt, returnParam }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isComplete = canSell && Boolean(stripeOnboardedAt);
  const hasAccount = Boolean(stripeAccountId);

  const handleConnect = () => {
    setError(null);
    startTransition(async () => {
      try {
        await connectBusinessStripe();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start Stripe setup. Please try again.');
      }
    });
  };

  const handleDashboard = () => {
    setError(null);
    startTransition(async () => {
      try {
        const url = await getBusinessStripeDashboardLink();
        window.location.href = url;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open Stripe dashboard.');
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">Product payments</p>
        {isComplete ? (
          <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>
        ) : hasAccount ? (
          <Badge variant="secondary">Setup incomplete</Badge>
        ) : (
          <Badge variant="outline">Not connected</Badge>
        )}
      </div>

      {returnParam === 'success' && !isComplete && (
        <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
          Stripe setup submitted. Your account will activate once Stripe verifies your details (usually a few minutes).
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {isComplete ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Your Stripe account is connected. You can list products and receive payouts.</p>
          <Button size="sm" variant="outline" disabled={isPending} onClick={handleDashboard}>
            {isPending ? 'Opening…' : 'Open Stripe Dashboard'}
          </Button>
        </div>
      ) : hasAccount ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">You started but didn&apos;t finish Stripe setup. Complete it to start selling.</p>
          <Button size="sm" disabled={isPending} onClick={handleConnect}>
            {isPending ? 'Redirecting…' : 'Continue Stripe Setup'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Connect a Stripe account to accept payments for your products and receive weekly payouts.</p>
          <Button size="sm" disabled={isPending} onClick={handleConnect}>
            {isPending ? 'Redirecting…' : 'Connect Stripe for Products'}
          </Button>
        </div>
      )}
    </div>
  );
}
