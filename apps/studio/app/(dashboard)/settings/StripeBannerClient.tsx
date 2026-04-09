'use client';

import { StripeBanner } from '@/components/StripeBanner';

type StripeStatus = 'not_started' | 'incomplete' | 'complete' | 'restricted';

export function StripeBannerClient({ initialStatus }: { initialStatus: StripeStatus }) {
  const handleConnect = async () => {
    const res = await fetch('/api/stripe/onboard', { method: 'POST' });
    const data = await res.json();
    if (data.onboarding_url) {
      window.location.href = data.onboarding_url;
    } else {
      alert('Failed to start Stripe setup. Please try again.');
    }
  };

  return <StripeBanner status={initialStatus} onConnect={handleConnect} />;
}
