'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction, assertUuid } from '@/lib/staff-guard';

const MAX_REASON = 1000;

export async function approveProduct(productId: string): Promise<void> {
  await assertStaffAction();
  const id = assertUuid(productId, 'product id');
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('staff-approve-product', {
    body: { product_id: id, action: 'approve' },
  });
  if (error) throw new Error(error.message ?? 'Failed to approve');
  revalidatePath('/staff/products');
}

export async function rejectProduct(productId: string, rejectionReason: string): Promise<void> {
  await assertStaffAction();
  const id = assertUuid(productId, 'product id');
  const reason = typeof rejectionReason === 'string' ? rejectionReason.trim() : '';
  if (!reason) throw new Error('A rejection needs a reason.');
  if (reason.length > MAX_REASON) throw new Error(`Keep the reason under ${MAX_REASON} characters.`);
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('staff-approve-product', {
    body: { product_id: id, action: 'reject', rejection_reason: reason },
  });
  if (error) throw new Error(error.message ?? 'Failed to reject');
  revalidatePath('/staff/products');
}
