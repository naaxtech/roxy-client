'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function markShipped(orderId: string, trackingNumber: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('update-order-shipped', {
    body: { order_id: orderId, tracking_number: trackingNumber },
  });
  if (error) throw new Error(error.message ?? 'Failed to mark as shipped');
  revalidatePath('/orders');
}

export async function refundOrder(orderId: string, reason: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('refund-order', {
    body: { order_id: orderId, reason },
  });
  if (error) throw new Error(error.message ?? 'Failed to refund order');
  revalidatePath('/orders');
}
