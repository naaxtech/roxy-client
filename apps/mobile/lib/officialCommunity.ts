import { supabase } from './supabase';
import { logError } from './errorLogger';
import { OFFICIAL_COMMUNITY_SLUG } from './features';

export type OfficialCommunity = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

export async function fetchOfficialCommunity(): Promise<OfficialCommunity | null> {
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, slug, description')
    .eq('slug', OFFICIAL_COMMUNITY_SLUG)
    .maybeSingle();

  if (error) {
    logError(error, 'officialCommunity.fetch');
    return null;
  }
  return (data as OfficialCommunity | null) ?? null;
}

export async function ensureOfficialMembership(
  userId: string,
  communityId: string,
): Promise<void> {
  const { error } = await supabase
    .from('community_members')
    .upsert(
      { community_id: communityId, user_id: userId, role: 'member' },
      { onConflict: 'community_id,user_id', ignoreDuplicates: true },
    );

  if (error) logError(error, 'officialCommunity.ensureMembership');
}
