'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface CancelEventButtonProps {
  eventId: string;
  isStaff: boolean;
}

export function CancelEventButton({ eventId, isStaff }: CancelEventButtonProps) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    if (!confirm('Cancel this event? Refunds will be issued to all ticket holders.')) return;
    setError(null);
    setCancelling(true);

    const endpoint = isStaff
      ? '/api/staff/cancel-event'
      : `/api/events/${eventId}/cancel`;

    const body = isStaff ? { event_id: eventId } : {};

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setCancelling(false);

    if (!res.ok) {
      setError(json.error ?? 'Failed to cancel event');
      return;
    }

    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="destructive"
        size="sm"
        disabled={cancelling}
        onClick={handleCancel}
      >
        {cancelling ? 'Cancelling…' : 'Cancel Event'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
