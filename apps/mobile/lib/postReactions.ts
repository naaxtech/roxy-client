import { supabase } from './supabase';

/**
 * Emoji reactions on a post.
 *
 * The same six the chat bar offers (`components/chat/ReactionBar.tsx`). One
 * vocabulary across the app: a woman who has learned what 💜 means in a DM
 * should not meet a different set on a post, and two lists drift the first time
 * somebody adds a seventh.
 */
export const POST_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '💜'] as const;
export type PostReaction = (typeof POST_REACTIONS)[number];

export function isPostReaction(emoji: string): emoji is PostReaction {
  return (POST_REACTIONS as readonly string[]).includes(emoji);
}

/** The tally for one emoji, defaulting to zero rather than to undefined. */
export function reactionCount(
  counts: Record<string, number> | null | undefined,
  emoji: string,
): number {
  const n = counts?.[emoji];
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Every reaction actually present on a post, in the app's own order. */
export function reactionsOn(
  counts: Record<string, number> | null | undefined,
): { emoji: PostReaction; count: number }[] {
  return POST_REACTIONS
    .map((emoji) => ({ emoji, count: reactionCount(counts, emoji) }))
    .filter((r) => r.count > 0);
}

/**
 * Add one reaction.
 *
 * `increment_reaction` is SECURITY DEFINER and atomic, so two women reacting at
 * once cannot lose one another's tap — the read-modify-write this would
 * otherwise need is exactly how a counter loses a race.
 *
 * It stores a TALLY, not a ballot: there is no per-viewer row, so nothing
 * server-side stops a determined viewer reacting twice. That is the same
 * bargain `components/feed/poll.ts` documents, and it is why the local UI
 * remembers her tap for the life of the screen rather than claiming to be a
 * record of who reacted.
 */
export async function reactToPost(postId: string, emoji: string): Promise<void> {
  if (!isPostReaction(emoji)) throw new Error('That is not a reaction.');
  const { error } = await supabase.rpc('increment_reaction', {
    p_post_id: postId,
    p_emoji: emoji,
  });
  if (error) throw error;
}

/** The counts with one local tap applied, for an optimistic render. */
export function withLocalReaction(
  counts: Record<string, number> | null | undefined,
  emoji: string,
): Record<string, number> {
  return { ...(counts ?? {}), [emoji]: reactionCount(counts, emoji) + 1 };
}
