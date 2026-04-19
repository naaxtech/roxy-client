'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function approveProduct(productId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('staff-approve-product', {
    body: { product_id: productId, action: 'approve' },
  });
  if (error) throw new Error(error.message ?? 'Failed to approve');
  revalidatePath('/staff/products');
}

export async function rejectProduct(productId: string, rejectionReason: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('staff-approve-product', {
    body: { product_id: productId, action: 'reject', rejection_reason: rejectionReason },
  });
  if (error) throw new Error(error.message ?? 'Failed to reject');
  revalidatePath('/staff/products');
}
