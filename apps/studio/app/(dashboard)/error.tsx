'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { logError } from '@/lib/errorLogger';

/**
 * Error boundary for every Studio page under (dashboard). Without it a thrown
 * query or action fell through to the root boundary, which drops the sidebar
 * and leaves staff on a blank "Something went wrong". The raw message is
 * never shown (it can carry SQL or ids); the digest lets us find the log line.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, '(dashboard)/error.tsx');
  }, [error]);

  return (
    <div className="max-w-xl space-y-4 py-8">
      <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 space-y-1">
        <p className="font-medium text-destructive">We could not load this page.</p>
        <p className="text-sm text-muted-foreground">
          Nothing you saved was lost. It may be a dropped connection or an expired session. Try again; if it keeps
          happening, sign out and back in.
        </p>
        {error.digest && <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
