import { supabase } from './supabase';
import { logError } from './errorLogger';

/**
 * The follow graph.
 *
 * Follow is a feed subscription: her posts show up in Following. It never
 * opens chat and it is not a friend request. Join stays `community_members`
 * on an official community.
 */

export function followPair(
  followerId: string,
  followedId: string,
): { follower_id: string; followed_id: string } | null {
  if (!followerId || !followedId || followerId === followedId) return null;
  return { follower_id: followerId, followed_id: followedId };
}

export async function fetchFollowingIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', userId);

  if (error) {
    logError(error, 'follows.fetchFollowingIds');
    return [];
  }
  return (data ?? []).map((row) => row.followed_id).filter(Boolean);
}

export async function followUser(followerId: string, followedId: string): Promise<boolean> {
  const pair = followPair(followerId, followedId);
  if (!pair) return false;

  const { error } = await supabase
    .from('follows')
    .upsert(pair, { onConflict: 'follower_id,followed_id', ignoreDuplicates: true });

  if (error) {
    logError(error, 'follows.followUser');
    return false;
  }
  return true;
}

export async function unfollowUser(followerId: string, followedId: string): Promise<boolean> {
  const pair = followPair(followerId, followedId);
  if (!pair) return false;

  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', pair.follower_id)
    .eq('followed_id', pair.followed_id);

  if (error) {
    logError(error, 'follows.unfollowUser');
    return false;
  }
  return true;
}
