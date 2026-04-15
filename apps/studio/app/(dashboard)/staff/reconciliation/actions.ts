'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function resolveAlert(alertId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('reconciliation_alerts')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', alertId);
  if (error) throw new Error(error.message);
  revalidatePath('/staff/reconciliation');
}
