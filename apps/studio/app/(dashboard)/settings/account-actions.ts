'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export interface StudioNotificationPrefs {
  studio_orders: boolean;
  studio_community: boolean;
  studio_news: boolean;
}

export async function updateNotificationPrefs(prefs: StudioNotificationPrefs): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('profiles')
    .update({ notification_preferences: prefs })
    .eq('id', userId);
  if (error) throw new Error(`Failed to update preferences: ${error.message}`);

  revalidatePath('/settings');
}

export async function deleteAccount(): Promise<never> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect('/auth/login');

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!serviceRoleKey) throw new Error('Service role key not configured');

  const adminClient = createAdminClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Failed to delete account: ${error.message}`);

  // Sign out the session so the browser cookie is cleared
  await supabase.auth.signOut();

  redirect('/auth/login');
}
