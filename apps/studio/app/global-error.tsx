'use client';

import { useEffect } from 'react';
import { logError } from '@/lib/errorLogger';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, 'global-error.tsx');
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: 18, marginBottom: 12 }}>Something went wrong</h1>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
