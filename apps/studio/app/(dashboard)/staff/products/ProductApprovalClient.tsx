'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { approveProduct, rejectProduct } from './actions';

type Product = {
  id: string;
  name: string;
  category: string;
  base_price_cents: number;
  description: string | null;
  created_at: string;
  businesses: { name: string; owner_id: string } | null;
};

function RejectDialog({
  productId,
  onClose,
}: {
  productId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await rejectProduct(productId, reason);
        onClose();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg p-6 w-full max-w-sm space-y-4">
        <h3 className="font-semibold">Reject Product</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rejection_reason">Rejection Reason</Label>
            <Textarea
              id="rejection_reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain why this product is rejected…"
              rows={3}
              required
              maxLength={1000}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending} variant="destructive" className="flex-1">
              {isPending ? 'Rejecting…' : 'Reject Product'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProductApprovalClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleApprove = (id: string) => {
    startTransition(async () => {
      await approveProduct(id);
      router.refresh();
    });
  };

  if (products.length === 0) {
    return <p className="text-sm text-muted-foreground">No products pending approval.</p>;
  }

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b">
              <th className="text-left px-4 py-2.5 font-medium">Product</th>
              <th className="text-left px-4 py-2.5 font-medium">Business</th>
              <th className="text-left px-4 py-2.5 font-medium">Category</th>
              <th className="text-right px-4 py-2.5 font-medium">Price</th>
              <th className="text-left px-4 py-2.5 font-medium">Description</th>
              <th className="text-right px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-muted/30 align-top">
                <td className="px-4 py-3 font-medium max-w-[160px]">
                  <p className="truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(p.created_at).toLocaleDateString('en-US', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </td>
                <td className="px-4 py-3 text-muted-foreground max-w-[140px]">
                  <p className="truncate">{p.businesses?.name ?? '—'}</p>
                </td>
                <td className="px-4 py-3 capitalize text-muted-foreground">{p.category}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  ${(p.base_price_cents / 100).toFixed(2)}
                </td>
                <td className="px-4 py-3 max-w-[200px]">
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {p.description ?? '—'}
                  </p>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => handleApprove(p.id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => setRejectId(p.id)}
                      className="text-destructive border-destructive/50 hover:bg-destructive/10"
                    >
                      Reject
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rejectId && (
        <RejectDialog productId={rejectId} onClose={() => setRejectId(null)} />
      )}
    </>
  );
}
