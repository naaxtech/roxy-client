'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction, assertUuid } from '@/lib/staff-guard';

export async function resolveAlert(alertId: string): Promise<void> {
  await assertStaffAction();
  const id = assertUuid(alertId, 'alert id');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reconciliation_alerts')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('That alert could not be resolved.');
  revalidatePath('/staff/reconciliation');
}
