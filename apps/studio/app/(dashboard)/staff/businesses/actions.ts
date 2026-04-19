'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function approveBusiness(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('staff-approve-business', {
    body: { business_id: businessId, action: 'approve' },
  });
  if (error) throw new Error(error.message ?? 'Failed to approve');
  revalidatePath('/staff/businesses');
}

export async function rejectBusiness(businessId: string, rejectionReason: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('staff-approve-business', {
    body: { business_id: businessId, action: 'reject', rejection_reason: rejectionReason },
  });
  if (error) throw new Error(error.message ?? 'Failed to reject');
  revalidatePath('/staff/businesses');
}
