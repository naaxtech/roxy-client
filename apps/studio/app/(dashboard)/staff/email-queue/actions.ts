'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction, assertUuid } from '@/lib/staff-guard';

export async function retryEmail(emailId: string): Promise<void> {
  await assertStaffAction();
  const id = assertUuid(emailId, 'email id');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('email_queue')
    .update({ status: 'pending', last_error: null })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  // PostgREST answers 200 for an update RLS filtered to zero rows. Surface it
  // instead of reporting a retry that never happened.
  if (!data || data.length === 0) throw new Error('That email could not be re-queued.');
  revalidatePath('/staff/email-queue');
}
