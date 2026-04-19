'use server';

import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { redirect } from 'next/navigation';

export async function connectStripe(): Promise<never> {
  const business = await getOwnedBusiness();
  if (!business) redirect('/settings');

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { business_id: business.id },
  });
  if (error || !data?.url) throw new Error('Failed to start Stripe onboarding');
  redirect(data.url as string);
}

export async function getStripeDashboardLink(): Promise<string> {
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { business_id: business.id, action: 'dashboard_link' },
  });
  if (error || !data?.url) throw new Error('Failed to get dashboard link');
  return data.url as string;
}
