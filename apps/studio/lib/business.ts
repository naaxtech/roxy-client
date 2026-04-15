import { createClient } from '@/lib/supabase/server';

export interface OwnedBusiness {
  id: string;
  name: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  can_sell: boolean;
}

export async function getOwnedBusiness(): Promise<OwnedBusiness | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from('businesses')
    .select('id, name, stripe_account_id, stripe_onboarding_complete, can_sell')
    .eq('owner_id', userId)
    .single();

  return data ?? null;
}
