'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { resolveAlert } from './actions';

export function ResolveButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleResolve = () => {
    startTransition(async () => {
      await resolveAlert(alertId);
      router.refresh();
    });
  };

  return (
    <Button size="sm" variant="outline" disabled={isPending} onClick={handleResolve}>
      {isPending ? 'Resolving…' : 'Resolve'}
    </Button>
  );
}
