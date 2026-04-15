'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { connectStripe, getStripeDashboardLink } from './actions';

type Props = {
  state: 'no_stripe' | 'incomplete' | 'complete';
};

export function StripeOnboardingClient({ state }: Props) {
  const [isPending, startTransition] = useTransition();

  if (state === 'complete') {
    return (
      <Button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const url = await getStripeDashboardLink();
            window.location.href = url;
          })
        }
      >
        {isPending ? 'Opening…' : 'Open Stripe Dashboard'}
      </Button>
    );
  }

  if (state === 'incomplete') {
    return (
      <Button
        disabled={isPending}
        onClick={() => startTransition(() => connectStripe())}
      >
        {isPending ? 'Redirecting…' : 'Continue Stripe Setup'}
      </Button>
    );
  }

  // no_stripe
  return (
    <Button
      disabled={isPending}
      onClick={() => startTransition(() => connectStripe())}
    >
      {isPending ? 'Redirecting…' : 'Connect Stripe to Start Selling'}
    </Button>
  );
}
