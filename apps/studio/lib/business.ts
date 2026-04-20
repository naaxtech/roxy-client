import { createClient } from '@/lib/supabase/server';

export interface OwnedBusiness {
  id: string;
  name: string;
  stripe_account_id: string | null;
  stripe_onboarded_at: string | null;
  can_sell: boolean;
  is_verified: boolean;
}

export interface OwnedBusinessFull extends OwnedBusiness {
  description: string | null;
  category: string | null;
  location_city: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  facebook_url: string | null;
  contact_email: string | null;
  phone: string | null;
  logo_url: string | null;
  is_wlw_owned: boolean;
  business_rejection_reason: string | null;
  payout_schedule_set: boolean;
}

export async function getOwnedBusiness(): Promise<OwnedBusiness | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from('businesses')
    .select('id, name, stripe_account_id, stripe_onboarded_at, can_sell, is_verified')
    .eq('owner_id', userId)
    .maybeSingle();

  return data ?? null;
}

export async function getOwnedBusinessFull(): Promise<OwnedBusinessFull | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from('businesses')
    .select(`
      id, name, description, category, location_city,
      website_url, instagram_handle, tiktok_handle, facebook_url,
      contact_email, phone, logo_url, is_verified, is_wlw_owned,
      business_rejection_reason, stripe_account_id, stripe_onboarded_at,
      can_sell, payout_schedule_set
    `)
    .eq('owner_id', userId)
    .maybeSingle();

  return data ?? null;
}
