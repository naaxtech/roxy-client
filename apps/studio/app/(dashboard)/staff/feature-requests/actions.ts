'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction, assertUuid } from '@/lib/staff-guard';

type FeatureStatus = 'open' | 'in_progress' | 'done' | 'rejected';
const STATUSES: readonly FeatureStatus[] = ['open', 'in_progress', 'done', 'rejected'];

export async function updateFeatureStatus(featureId: string, status: FeatureStatus): Promise<void> {
  await assertStaffAction();
  const id = assertUuid(featureId, 'feature id');
  if (!STATUSES.includes(status)) throw new Error('Invalid status.');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('feature_requests')
    .update({ status })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  // Previously the result was ignored entirely, so an update RLS refused looked
  // like a success on screen.
  if (!data || data.length === 0) throw new Error('That status could not be saved.');
  revalidatePath('/staff/feature-requests');
}
