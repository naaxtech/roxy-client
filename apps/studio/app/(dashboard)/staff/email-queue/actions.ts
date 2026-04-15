'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function retryEmail(emailId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('email_queue')
    .update({ status: 'pending', last_error: null })
    .eq('id', emailId);
  if (error) throw new Error(error.message);
  revalidatePath('/staff/email-queue');
}
