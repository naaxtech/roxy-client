import { supabase } from './supabase';

/**
 * Discover's Top 10 — the members, not the communities.
 *
 * Ranked by `gamification_points`, which members cannot write: it is absent
 * from the seventeen columns `authenticated` may update, so a leaderboard
 * position is earned rather than declared. That is the whole reason this can be
 * a chart at all.
 *
 * `staff_tag` rides along. It is editorial — assigned by the Roxy team from
 * Studio and guarded by `profiles_guard_staff_tag` (121) — so a tag says the
 * team vouched for her, not that she typed something about herself.
 */

export interface TopMember {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  gamification_points: number;
  staff_tag: string | null;
}

export const TOP_MEMBER_LIMIT = 10;

const FIELDS = 'id, display_name, username, avatar_url, gamification_points, staff_tag';

export async function fetchTopMembers(limit = TOP_MEMBER_LIMIT): Promise<TopMember[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(FIELDS)
    // Hidden members are hidden. Ghost mode exists so a woman can use Roxy
    // without being discoverable, and a chart is the most discoverable surface
    // there is — putting her on it would be the setting failing silently.
    .eq('is_ghost', false)
    // The same predicate `is_approved_member()` uses. 'unvetted' is the
    // grandfathered population and must be included, or every pre-gate member
    // vanishes from the chart at once.
    .in('vetting_status', ['approved', 'unvetted'])
    .order('gamification_points', { ascending: false })
    .order('display_name', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as TopMember[];
}

/** The name to show. Never an email, never a raw id. */
export function memberName(member: TopMember): string {
  return member.display_name?.trim() || member.username?.trim() || 'A member';
}

/**
 * The line under the name.
 *
 * The staff tag wins when there is one — it is the editorial reason she is on
 * the chart. Points are the fallback, and read as a plain count rather than as
 * a score out of anything.
 */
export function memberSubtitle(member: TopMember): string {
  const tag = member.staff_tag?.trim();
  if (tag) return tag;
  const points = Math.max(0, member.gamification_points ?? 0);
  return `${points} ${points === 1 ? 'point' : 'points'}`;
}
