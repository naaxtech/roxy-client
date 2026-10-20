import { supabase } from './supabase';
import { logError } from './errorLogger';
import type { BlockedProfile } from '../store/safetyStore';

/**
 * Names for the women she has muted, for the "Blocked & muted" screen.
 * `muted_user_ids()` (127) returns ids only; muting does not hide a profile,
 * so the ordinary profiles read can name them.
 */
export async function fetchMutedProfiles(ids: string[]): Promise<BlockedProfile[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, username, avatar_url')
    .in('id', ids);
  if (error) {
    logError(error, 'mutedProfiles.fetch');
    throw error;
  }
  const byId = new Map(((data ?? []) as BlockedProfile[]).map((p) => [p.id, p]));
  // Keep every muted id, even one whose profile is gone, so it can be undone.
  return ids.map((id) => byId.get(id) ?? { id, display_name: null, username: null, avatar_url: null });
}
