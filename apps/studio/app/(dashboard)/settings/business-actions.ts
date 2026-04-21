'use server';

import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { revalidatePath } from 'next/cache';

export async function createBusiness(formData: FormData): Promise<{ error?: string }> {
  const name = (formData.get('name') as string)?.trim();
  if (!name) return { error: 'Business name is required' };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { error: 'Not authenticated' };

  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  if (existing) return { error: 'You already have a business registered' };

  const logoUrl = (formData.get('logo_url') as string)?.trim() || null;

  const { error } = await supabase.from('businesses').insert({
    owner_id: userId,
    name,
    description: (formData.get('description') as string)?.trim() || null,
    category: (formData.get('category') as string)?.trim() || null,
    location_city: (formData.get('location_city') as string)?.trim() || null,
    is_wlw_owned: formData.get('is_wlw_owned') === 'on',
    website_url: (formData.get('website_url') as string)?.trim() || null,
    instagram_handle: (formData.get('instagram_handle') as string)?.trim() || null,
    tiktok_handle: (formData.get('tiktok_handle') as string)?.trim() || null,
    facebook_url: (formData.get('facebook_url') as string)?.trim() || null,
    contact_email: (formData.get('contact_email') as string)?.trim() || null,
    phone: (formData.get('phone') as string)?.trim() || null,
    logo_url: logoUrl,
  });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return {};
}

export async function updateBusiness(businessId: string, formData: FormData): Promise<{ error?: string }> {
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const name = (formData.get('name') as string)?.trim();
  if (!name) return { error: 'Business name is required' };

  const logoUrl = (formData.get('logo_url') as string)?.trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from('businesses')
    .update({
      name,
      description: (formData.get('description') as string)?.trim() || null,
      category: (formData.get('category') as string)?.trim() || null,
      location_city: (formData.get('location_city') as string)?.trim() || null,
      is_wlw_owned: formData.get('is_wlw_owned') === 'on',
      website_url: (formData.get('website_url') as string)?.trim() || null,
      instagram_handle: (formData.get('instagram_handle') as string)?.trim() || null,
      tiktok_handle: (formData.get('tiktok_handle') as string)?.trim() || null,
      facebook_url: (formData.get('facebook_url') as string)?.trim() || null,
      contact_email: (formData.get('contact_email') as string)?.trim() || null,
      phone: (formData.get('phone') as string)?.trim() || null,
      logo_url: logoUrl,
      business_rejection_reason: null,
    })
    .eq('id', businessId);

  if (error) return { error: error.message };
  revalidatePath('/settings');
  return {};
}

export async function resubmitBusiness(businessId: string): Promise<void> {
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const supabase = await createClient();
  await supabase
    .from('businesses')
    .update({ business_rejection_reason: null })
    .eq('id', businessId);

  revalidatePath('/settings');
}

export async function connectBusinessStripe(): Promise<{ url?: string; error?: string }> {
  const business = await getOwnedBusiness();
  if (!business) return { error: 'No business found' };

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { business_id: business.id },
  });
  if (error || !data?.url) {
    const detail = data?.error ?? error?.message ?? 'unknown';
    return { error: `Stripe error: ${detail}` };
  }
  return { url: data.url as string };
}

export async function getBusinessStripeDashboardLink(): Promise<{ url?: string; error?: string }> {
  const business = await getOwnedBusiness();
  if (!business) return { error: 'No business found' };

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { business_id: business.id, action: 'dashboard_link' },
  });
  if (error || !data?.url) return { error: 'Failed to get dashboard link. Please try again.' };
  return { url: data.url as string };
}
