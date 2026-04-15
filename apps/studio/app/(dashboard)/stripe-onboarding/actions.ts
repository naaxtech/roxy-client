'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function connectStripe(): Promise<never> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect('/login');

  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: {},
  });
  if (error || !data?.url) throw new Error('Failed to start Stripe onboarding');
  redirect(data.url as string);
}

export async function getStripeDashboardLink(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { action: 'dashboard_link' },
  });
  if (error || !data?.url) throw new Error('Failed to get dashboard link');
  return data.url as string;
}
