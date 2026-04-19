'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveBusiness, rejectBusiness } from './actions';

interface Props {
  businessId: string;
  businessName: string;
}

export function ApproveBusinessButton({ businessId }: { businessId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="default"
      disabled={pending}
      onClick={() => startTransition(() => approveBusiness(businessId))}
    >
      {pending ? 'Approving…' : 'Approve'}
    </Button>
  );
}

export function RejectBusinessButton({ businessId, businessName }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Reject
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-[240px]">
      <p className="text-xs text-muted-foreground">Reason for rejecting <strong>{businessName}</strong>:</p>
      <textarea
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        rows={3}
        placeholder="e.g. Insufficient information, not WLW-owned, etc."
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={pending || !reason.trim()}
          onClick={() =>
            startTransition(() => rejectBusiness(businessId, reason.trim()))
          }
        >
          {pending ? 'Rejecting…' : 'Confirm Reject'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setReason(''); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
