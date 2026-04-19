import { createClient } from '@/lib/supabase/server';

export interface OwnedBusiness {
  id: string;
  name: string;
  stripe_account_id: string | null;
  stripe_onboarded_at: string | null;
  can_sell: boolean;
  is_verified: boolean;
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
