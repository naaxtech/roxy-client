'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

type FeedbackStatus = 'open' | 'in_review' | 'resolved' | 'wontfix';

export async function updateFeedbackStatus(feedbackId: string, status: FeedbackStatus): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('app_feedback')
    .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
    .eq('id', feedbackId);
  revalidatePath('/staff/feedback');
}

export async function updateFeedbackNotes(feedbackId: string, internalNotes: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('app_feedback')
    .update({ internal_notes: internalNotes })
    .eq('id', feedbackId);
  revalidatePath('/staff/feedback');
}
