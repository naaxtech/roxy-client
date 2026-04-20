'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { deleteAccount } from './account-actions';

export function DangerZoneClient() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      try {
        await deleteAccount();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete account. Please contact support.');
        setShowConfirm(false);
      }
    });
  };

  return (
    <div className="rounded-lg border border-destructive/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-destructive">Delete account</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Permanently deletes your account, business profile, products, and all associated data. This cannot be undone.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {showConfirm ? (
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? 'Deleting…' : 'Yes, delete my account'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => setShowConfirm(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/50 text-destructive hover:bg-destructive/10"
          onClick={() => setShowConfirm(true)}
        >
          Delete account
        </Button>
      )}
    </div>
  );
}
