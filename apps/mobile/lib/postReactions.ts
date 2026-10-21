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

/**
 * What a screen reader says for each reaction ("React with laughing"). Words,
 * not the emoji's Unicode name: VoiceOver and TalkBack read "face with tears
 * of joy", which is a mouthful on a 48 dp button. Keyed by meaning for the
 * string catalogue (M174).
 */
export const REACTION_NAMES: Record<PostReaction, string> = {
  '❤️': 'heart',
  '😂': 'laughing',
  '😮': 'wow',
  '😢': 'sad',
  '😡': 'angry',
  '💜': 'purple heart',
};

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

// ─── v2: her own reaction (migration 136) ─────────────────────────────────

/** The set's first emoji: what a double tap and a plain tap on the rail give. */
export const HEART: PostReaction = POST_REACTIONS[0];

/** Below this a count is written in full ("1,205"); from it, compact ("12.5K"). */
export const COMPACT_FROM = 10_000;

function wholeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The device's own locale, for counts. */
function deviceLocale(): string | undefined {
  try {
    return new Intl.NumberFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

/**
 * A count the way her language writes it: grouped in full below
 * `COMPACT_FROM` ("1,205", "1.205"), compact above it ("12.5K", "1,2 k",
 * "1.2万"). Tabular figures are the caller's job (`TYPE.meta` carries them).
 * Falls back to a plain K/M when the engine has no compact notation.
 */
export function formatReactionCount(n: number, locale: string | undefined = deviceLocale()): string {
  const whole = wholeCount(n);
  try {
    if (whole < COMPACT_FROM) return new Intl.NumberFormat(locale).format(whole);
    return new Intl.NumberFormat(locale, {
      notation: 'compact', maximumFractionDigits: 1,
    } as Intl.NumberFormatOptions).format(whole);
  } catch {
    if (whole < COMPACT_FROM) return String(whole);
    if (whole < 1_000_000) return `${Math.floor(whole / 100) / 10}K`;
    return `${Math.floor(whole / 100_000) / 10}M`;
  }
}

/**
 * The rail's number: every reaction on the post. A v0 like was a heart, so
 * `like_count` is part of it (Nicole 2026-10-21: likes merge into ❤️; nothing
 * a member gave disappears). Poll keys (`poll:<n>`) live in the same jsonb and
 * are not reactions.
 */
export function reactionTotal(
  counts: Record<string, number> | null | undefined,
  likeCount: number,
): number {
  return POST_REACTIONS.reduce((sum, emoji) => sum + reactionCount(counts, emoji), 0)
    + wholeCount(likeCount);
}

/** The breakdown (post detail chips): the tallies with legacy likes on ❤️. */
export function talliesWithLikes(
  counts: Record<string, number> | null | undefined,
  likeCount: number,
): Record<string, number> {
  return { ...(counts ?? {}), [HEART]: reactionCount(counts, HEART) + wholeCount(likeCount) };
}

/** Her one count moved from `from` to `to` (either may be none). */
export function shiftReaction(
  counts: Record<string, number> | null | undefined,
  from: PostReaction | null,
  to: PostReaction | null,
): Record<string, number> {
  const next = { ...(counts ?? {}) };
  if (from === to) return next;
  if (from) next[from] = Math.max(0, reactionCount(next, from) - 1);
  if (to) next[to] = reactionCount(next, to) + 1;
  return next;
}

/**
 * True when the error means "this database does not have 136 yet": a
 * missing table (42P01, PostgREST PGRST205) or a missing function (42883,
 * PGRST202). The client must work before and after the orchestrator applies
 * 136 to production, so these are a mode, not a crash.
 */
export function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '42P01' || code === 'PGRST205' || code === '42883' || code === 'PGRST202';
}

export type MyReactions = Record<string, PostReaction>;

/**
 * Her reactions on the posts on screen. RLS (136) returns only her own rows;
 * the `user_id` filter is for the index. `unsupported` before 136; `error`
 * keeps whatever the rail already shows.
 */
export async function fetchMyReactions(
  userId: string,
  postIds: string[],
): Promise<{ status: 'ok' | 'unsupported' | 'error'; mine: MyReactions }> {
  if (!userId || postIds.length === 0) return { status: 'ok', mine: {} };
  const { data, error } = await supabase
    .from('post_reaction_members')
    .select('post_id, emoji')
    .eq('user_id', userId)
    .in('post_id', postIds);
  if (error) return { status: isMissingSchema(error) ? 'unsupported' : 'error', mine: {} };
  const mine: MyReactions = {};
  for (const row of (data ?? []) as { post_id: string; emoji: string }[]) {
    if (isPostReaction(row.emoji)) mine[row.post_id] = row.emoji;
  }
  return { status: 'ok', mine };
}

/**
 * Set, switch or clear (`null`) her reaction through `set_post_reaction`
 * (136), which keeps the tally exact and folds her legacy like in. Resolves
 * `unsupported` before 136 (the caller falls back to the tally RPC); throws
 * any other failure so the rail can roll back.
 */
export async function setMyReaction(
  postId: string,
  emoji: PostReaction | null,
): Promise<
  | { status: 'ok'; counts: Record<string, number>; likeCount: number }
  | { status: 'unsupported' }
> {
  if (emoji !== null && !isPostReaction(emoji)) throw new Error('That is not a reaction.');
  const { data, error } = await supabase.rpc('set_post_reaction', {
    p_post_id: postId,
    p_emoji: emoji,
  });
  if (error) {
    if (isMissingSchema(error)) return { status: 'unsupported' };
    throw error;
  }
  const out = (data ?? {}) as { counts?: Record<string, number>; like_count?: number };
  return { status: 'ok', counts: out.counts ?? {}, likeCount: wholeCount(out.like_count ?? 0) };
}
