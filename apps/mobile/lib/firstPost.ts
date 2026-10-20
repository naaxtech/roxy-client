import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { logError } from './errorLogger';

/**
 * "Your first post is live" — once per member, and only when it is true.
 *
 * The device remembers that the question was settled, keyed by her user id:
 * a second account on the same phone gets her own moment, and signing out and
 * back in does not replay it.
 *
 * The server is the truth about "first". A woman who posted before this
 * shipped is never told her tenth post is her first: a count above one settles
 * the question for good (and we stop asking), while a failed count leaves it
 * open so the next post can ask again. Nothing here may throw into the publish
 * flow — the post is already live, the celebration is a courtesy.
 */

const KEY_PREFIX = 'roxy.firstPostCelebrated.';

export function firstPostKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * Resolve to true exactly once: when the post she just published is her only
 * live post. Call it only after a successful publish.
 */
export async function claimFirstPostCelebration(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const key = firstPostKey(userId);
    if ((await AsyncStorage.getItem(key)) !== null) return false;

    const { count, error } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', userId)
      .is('deleted_at', null);

    if (error) {
      logError(error, 'firstPost.count');
      return false;
    }
    // Zero means the row is not visible yet (or the publish was undone):
    // leave the question open rather than guess.
    if (typeof count !== 'number' || count < 1) return false;

    await AsyncStorage.setItem(key, new Date().toISOString());
    return count === 1;
  } catch (e) {
    logError(e, 'firstPost.claim');
    return false;
  }
}
