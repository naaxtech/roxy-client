'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PAYOUT_REASON_MAX, validatePayoutReason } from '@/lib/payouts';
import { setPayoutBlock } from './payout-actions';

/**
 * Block (or, for an already blocked payout, unblock) an event payout.
 *
 * Calls the setPayoutBlock server action → staff_set_payout_block (131):
 * core only, reason required, audited. It used to POST to
 * /api/staff/block-payout, which reported success even when a non-core
 * update matched 0 rows; now the message is whatever the server really did.
 */
export function BlockPayoutButton({
  eventId,
  canManage,
  blocked = false,
}: {
  eventId: string;
  canManage: boolean;
  blocked?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!canManage) {
    return <span className="text-xs text-muted-foreground">Core staff only</span>;
  }

  const verb = blocked ? 'unblock' : 'block';
  const inputId = `payout-reason-${eventId}`;

  const submit = async () => {
    setError(null);
    setStatus(null);
    const check = validatePayoutReason(reason);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setLoading(true);
    try {
      const result = await setPayoutBlock(eventId, !blocked, reason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(result.message);
      setOpen(false);
      setReason('');
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5 min-w-48">
      {open ? (
        <>
          <label htmlFor={inputId} className="sr-only">
            Reason to {verb}
          </label>
          <Input
            id={inputId}
            placeholder={`Reason to ${verb} (required)`}
            value={reason}
            maxLength={PAYOUT_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            className="h-7 text-xs"
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={blocked ? 'default' : 'destructive'}
              onClick={() => void submit()}
              disabled={loading}
            >
              {loading ? '…' : `Confirm ${verb}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {blocked ? 'Unblock payout' : 'Block payout'}
        </Button>
      )}
      <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {status}
      </span>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
