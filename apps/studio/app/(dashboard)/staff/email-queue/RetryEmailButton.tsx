'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { retryEmail } from './actions';

export function RetryEmailButton({ emailId }: { emailId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRetry = () => {
    startTransition(async () => {
      await retryEmail(emailId);
      router.refresh();
    });
  };

  return (
    <Button size="sm" variant="outline" disabled={isPending} onClick={handleRetry}>
      {isPending ? 'Queuing…' : 'Retry'}
    </Button>
  );
}
