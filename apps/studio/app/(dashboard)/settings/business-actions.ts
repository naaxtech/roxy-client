'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createBusiness(formData: FormData): Promise<{ error?: string }> {
  const name = (formData.get('name') as string)?.trim();
  if (!name) return { error: 'Business name is required' };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { error: 'Not authenticated' };

  // Prevent duplicates
  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  if (existing) return { error: 'You already have a business registered' };

  const { error } = await supabase.from('businesses').insert({
    owner_id: userId,
    name,
    description: (formData.get('description') as string)?.trim() || null,
    category: (formData.get('category') as string)?.trim() || null,
    location_city: (formData.get('location_city') as string)?.trim() || null,
    is_wlw_owned: formData.get('is_wlw_owned') === 'on',
    website_url: (formData.get('website_url') as string)?.trim() || null,
    instagram_handle: (formData.get('instagram_handle') as string)?.trim() || null,
  });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  revalidatePath('/stripe-onboarding');
  return {};
}
