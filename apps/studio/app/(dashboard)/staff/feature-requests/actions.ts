'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

type FeatureStatus = 'open' | 'in_progress' | 'done' | 'rejected';

export async function updateFeatureStatus(featureId: string, status: FeatureStatus): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('feature_requests')
    .update({ status })
    .eq('id', featureId);
  revalidatePath('/staff/feature-requests');
}
