'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { markShipped, refundOrder } from './actions';

type OrderItem = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  product_name?: string | null;
};

type Order = {
  id: string;
  buyer_id: string;
  status: string;
  total_cents: number;
  created_at: string;
  order_items?: OrderItem[];
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  paid:       { label: 'Paid',       className: 'bg-blue-100 text-blue-800 border-blue-200' },
  shipped:    { label: 'Shipped',    className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  delivered:  { label: 'Delivered',  className: 'bg-green-100 text-green-800 border-green-200' },
  refunded:   { label: 'Refunded',   className: 'bg-red-100 text-red-800 border-red-200' },
  cancelled:  { label: 'Cancelled',  className: 'bg-gray-100 text-gray-600 border-gray-200' },
  disputed:   { label: 'Disputed',   className: 'bg-orange-100 text-orange-800 border-orange-200' },
};

function ShipDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const router = useRouter();
  const [tracking, setTracking] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await markShipped(orderId, tracking);
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
        <h3 className="font-semibold">Mark as Shipped</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tracking">Tracking Number</Label>
            <Input
              id="tracking"
              value={tracking}
              onChange={e => setTracking(e.target.value)}
              placeholder="e.g. 1Z999AA10123456784"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? 'Saving…' : 'Confirm Shipped'}
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

function RefundDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await refundOrder(orderId, reason);
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
        <h3 className="font-semibold">Refund Order</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Reason for refund…"
              rows={3}
              maxLength={500}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending} variant="destructive" className="flex-1">
              {isPending ? 'Processing…' : 'Issue Refund'}
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

export function OrdersClient({ orders }: { orders: Order[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shipOrder, setShipOrder] = useState<string | null>(null);
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null);

  const toggleExpand = (id: string) => setExpanded(prev => (prev === id ? null : id));

  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">No orders yet.</p>;
  }

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b">
              <th className="text-left px-4 py-2.5 font-medium">Order ID</th>
              <th className="text-left px-4 py-2.5 font-medium">Buyer</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-right px-4 py-2.5 font-medium">Total</th>
              <th className="text-left px-4 py-2.5 font-medium">Date</th>
              <th className="text-right px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.map(order => {
              const badge = STATUS_BADGE[order.status] ?? STATUS_BADGE.cancelled;
              const shortId = order.id.slice(-8).toUpperCase();
              const shortBuyer = order.buyer_id.slice(-8).toUpperCase();
              const isExpanded = expanded === order.id;

              return (
                <>
                  <tr
                    key={order.id}
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => toggleExpand(order.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{shortId}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      …{shortBuyer}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ${(order.total_cents / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {new Date(order.created_at).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        {order.status === 'paid' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShipOrder(order.id)}
                          >
                            Mark Shipped
                          </Button>
                        )}
                        {(order.status === 'paid' || order.status === 'shipped') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setRefundOrderId(order.id)}
                          >
                            Refund
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && order.order_items && order.order_items.length > 0 && (
                    <tr key={`${order.id}-items`} className="bg-muted/20">
                      <td colSpan={6} className="px-6 py-3">
                        <p className="text-xs font-semibold text-muted-foreground mb-2">
                          Order Items
                        </p>
                        <ul className="space-y-1">
                          {order.order_items.map(item => (
                            <li key={item.id} className="text-xs flex justify-between max-w-sm">
                              <span>
                                {item.product_name ?? item.product_id.slice(-8)} × {item.quantity}
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                ${((item.unit_price_cents * item.quantity) / 100).toFixed(2)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {shipOrder && (
        <ShipDialog orderId={shipOrder} onClose={() => setShipOrder(null)} />
      )}
      {refundOrderId && (
        <RefundDialog orderId={refundOrderId} onClose={() => setRefundOrderId(null)} />
      )}
    </>
  );
}
