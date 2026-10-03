'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction, assertUuid } from '@/lib/staff-guard';

type FeedbackStatus = 'open' | 'in_review' | 'resolved' | 'wontfix';
const STATUSES: readonly FeedbackStatus[] = ['open', 'in_review', 'resolved', 'wontfix'];
const MAX_NOTES = 5000;

export async function updateFeedbackStatus(feedbackId: string, status: FeedbackStatus): Promise<void> {
  await assertStaffAction();
  const id = assertUuid(feedbackId, 'feedback id');
  if (!STATUSES.includes(status)) throw new Error('Invalid status.');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_feedback')
    .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('That status could not be saved.');
  revalidatePath('/staff/feedback');
}

export async function updateFeedbackNotes(feedbackId: string, internalNotes: string): Promise<void> {
  await assertStaffAction();
  const id = assertUuid(feedbackId, 'feedback id');
  if (typeof internalNotes !== 'string') throw new Error('Invalid notes.');
  if (internalNotes.length > MAX_NOTES) throw new Error(`Keep notes under ${MAX_NOTES} characters.`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_feedback')
    .update({ internal_notes: internalNotes })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Those notes could not be saved.');
  revalidatePath('/staff/feedback');
}
