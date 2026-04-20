'use client';

import { useState } from 'react';
import { StripeBanner } from '@/components/StripeBanner';

type StripeStatus = 'not_started' | 'incomplete' | 'complete' | 'restricted';

export function StripeBannerClient({ initialStatus }: { initialStatus: StripeStatus }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/onboard', { method: 'POST' });
      const data = await res.json();
      if (data.onboarding_url) {
        window.location.href = data.onboarding_url;
      } else {
        setError(data.error ?? 'Stripe setup failed. Please try again.');
        setLoading(false);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <StripeBanner status={initialStatus} onConnect={handleConnect} loading={loading} />
      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}
    </div>
  );
}
