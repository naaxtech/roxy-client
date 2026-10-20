'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { releasePayout } from './payout-actions';

/**
 * Release one event payout now. Core staff only (the server action re-checks).
 * The release-payout function answers { released, skipped, failed }; a skip
 * (not completed, waiting period, blocked, already paid, host not onboarded)
 * is shown as "not released", never as success.
 */
export function ReleasePayoutButton({ eventId, canManage }: { eventId: string; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!canManage) return null;

  const handleRelease = async () => {
    if (!window.confirm('Release the payout for this event to the host now? This cannot be undone.')) return;
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      const result = await releasePayout(eventId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.message);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={() => void handleRelease()} disabled={loading}>
        {loading ? 'Releasing…' : 'Release payout'}
      </Button>
      <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {status}
      </span>
      {error && (
        <p role="alert" className="text-xs text-destructive max-w-64 text-right">
          {error}
        </p>
      )}
    </div>
  );
}
