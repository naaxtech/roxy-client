'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type StripeStatus = 'not_started' | 'incomplete' | 'complete' | 'restricted';

interface StripeBannerProps {
  status: StripeStatus;
  onConnect: () => Promise<void>;
  loading?: boolean;
}

export function StripeBanner({ status, onConnect, loading: externalLoading }: StripeBannerProps) {
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = externalLoading ?? internalLoading;

  const handleConnect = async () => {
    if (externalLoading === undefined) {
      setInternalLoading(true);
    }
    await onConnect();
    if (externalLoading === undefined) {
      setInternalLoading(false);
    }
  };

  if (status === 'complete') {
    return (
      <div className="rounded-xl border border-border bg-muted/50 px-4 py-3.5 flex items-center gap-3">
        <span className="text-foreground font-medium">Stripe connected</span>
        <span className="text-muted-foreground text-sm">You can create paid events.</span>
      </div>
    );
  }

  if (status === 'restricted') {
    return (
      <div className="rounded-xl border border-border bg-muted/50 px-4 py-3.5 border-l-[3px] border-l-red-700">
        <p className="text-foreground font-medium">Action required</p>
        <p className="text-muted-foreground text-sm mt-1">
          Your Stripe account requires attention. Visit your{' '}
          <a
            href="https://dashboard.stripe.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-foreground"
          >
            Stripe Express dashboard
          </a>{' '}
          to resolve the issue.
        </p>
      </div>
    );
  }

  if (status === 'incomplete') {
    return (
      <div className="rounded-xl border border-border bg-muted/50 p-4 flex items-center justify-between gap-4 border-l-[3px] border-l-amber-700">
        <div>
          <p className="text-foreground font-medium">Stripe setup incomplete</p>
          <p className="text-muted-foreground text-sm mt-0.5">Complete setup to enable paid events.</p>
        </div>
        <Button variant="outline" onClick={handleConnect} disabled={loading}>
          {loading ? 'Redirecting…' : 'Resume Stripe Setup'}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
      <div>
        <p className="font-medium">Connect a Stripe account</p>
        <p className="text-muted-foreground text-sm mt-0.5">
          Required to create paid events and receive payouts.
        </p>
      </div>
      <Button onClick={handleConnect} disabled={loading}>
        {loading ? 'Redirecting…' : 'Connect Stripe Account'}
      </Button>
    </div>
  );
}
