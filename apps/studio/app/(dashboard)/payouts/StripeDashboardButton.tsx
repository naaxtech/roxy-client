'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function StripeDashboardButton() {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    const res = await fetch('/api/stripe/dashboard-link', { method: 'POST' });
    const json = await res.json();
    setLoading(false);
    if (json.url) {
      window.open(json.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={loading}>
      {loading ? 'Loading…' : 'Open Stripe Dashboard →'}
    </Button>
  );
}
