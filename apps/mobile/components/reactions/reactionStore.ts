import { create } from 'zustand';
import {
  HEART, fetchMyReactions, reactToPost, reactionTotal, setMyReaction,
  type PostReaction,
} from '../../lib/postReactions';
import { useFeedStore } from '../../store/feedStore';
import { logError } from '../../lib/errorLogger';

/**
 * Her reaction per post, for the v2 rail (lane feed; reused by chat later).
 *
 * Optimistic: a tap changes the rail before the network answers and a failure
 * rolls it back (direction › Motion › Optimistic state). The server half is
 * migration 136 (`set_post_reaction`, `post_reaction_members`); before 136
 * reaches a database the store falls back once and stays there:
 *   - ❤️ is kept as a v0 like (`post_likes`), so it survives a reload;
 *   - any other emoji goes to the tally RPC (`increment_reaction`), which is
 *     all installed builds ever had (her choice lasts for the session).
 *
 * What the rail shows:
 *   - her reaction = what this store knows (`mine`), else her legacy like as
 *     ❤️ (a v0 like was a heart), else none;
 *   - the total = the post's six tallies + `like_count` (likes merge into ❤️)
 *     + this session's optimistic `deltas`. `like_count` is read as fetched,
 *     never feedStore's like deltas, so a fallback like is counted once.
 */
export interface ReactionDeps {
  /** Whether feedStore says she has a v0 like on this post. */
  legacyLiked: boolean;
}

interface ReactionStore {
  /** null until the first call answers; false = the database has no 136. */
  supported: boolean | null;
  /** Whose reactions these are; a new member signing in starts clean. */
  userId: string | null;
  /** What she has given, where known. Absent = unknown (see `myReactionOf`). */
  mine: Record<string, PostReaction | null>;
  /** Signed, per post, per emoji: what this session changed. */
  deltas: Record<string, Record<string, number>>;
  /** Posts already asked about this session (no row = no reaction yet). */
  asked: Record<string, true>;
  hydrate: (userId: string, postIds: string[]) => Promise<void>;
  react: (postId: string, next: PostReaction | null, deps: ReactionDeps) => Promise<void>;
  reset: () => void;
}

type Snapshot = Pick<ReactionStore, 'mine' | 'deltas'>;

/** Her reaction on a post, as the rail should draw it. */
export function myReactionOf(
  state: Snapshot,
  postId: string,
  legacyLiked: boolean,
): PostReaction | null {
  if (Object.prototype.hasOwnProperty.call(state.mine, postId)) return state.mine[postId] ?? null;
  return legacyLiked ? HEART : null;
}

/** The rail's total for a post, with this session's taps applied. */
export function reactionTotalOf(
  state: Snapshot,
  post: { id: string; reaction_counts: Record<string, number> | null | undefined; like_count: number },
): number {
  const delta = Object.values(state.deltas[post.id] ?? {}).reduce((a, b) => a + b, 0);
  return Math.max(0, reactionTotal(post.reaction_counts, post.like_count) + delta);
}

function moved(
  deltas: Record<string, number> | undefined,
  from: PostReaction | null,
  to: PostReaction | null,
): Record<string, number> {
  const next = { ...(deltas ?? {}) };
  if (from) next[from] = (next[from] ?? 0) - 1;
  if (to) next[to] = (next[to] ?? 0) + 1;
  return next;
}

/** One write at a time per post, in tap order. */
const queues = new Map<string, Promise<void>>();

/** Before 136: ❤️ is a like, the rest go to the tally. */
async function legacyReact(
  postId: string,
  prev: PostReaction | null,
  next: PostReaction | null,
): Promise<void> {
  const feed = useFeedStore.getState();
  if (prev === HEART && feed.likedPostIds.has(postId)) await feed.toggleLike(postId);
  if (next === HEART) await feed.likePost(postId);
  else if (next) await reactToPost(postId, next);
}

const EMPTY = { supported: null, userId: null, mine: {}, deltas: {}, asked: {} } as const;

export const useReactionStore = create<ReactionStore>((set, get) => ({
  ...EMPTY,

  hydrate: async (userId, postIds) => {
    if (get().userId !== userId) set({ ...EMPTY, userId });
    if (get().supported === false) return;
    const asked = get().asked;
    const fresh = postIds.filter((id) => !asked[id]);
    if (fresh.length === 0) return;
    set((s) => ({ asked: { ...s.asked, ...Object.fromEntries(fresh.map((id) => [id, true as const])) } }));
    const result = await fetchMyReactions(userId, fresh);
    if (get().userId !== userId) return;
    if (result.status === 'unsupported') {
      set({ supported: false });
      return;
    }
    if (result.status === 'error') {
      // Ask again next time: nothing was learned.
      set((s) => {
        const next = { ...s.asked };
        for (const id of fresh) delete next[id];
        return { asked: next };
      });
      return;
    }
    set((s) => ({ supported: true, mine: { ...result.mine, ...s.mine } }));
  },

  react: (postId, next, { legacyLiked }) => {
    const before = get();
    const prev = myReactionOf(before, postId, legacyLiked);
    if (prev === next) return Promise.resolve();

    const hadKnown = Object.prototype.hasOwnProperty.call(before.mine, postId);
    set((s) => ({
      mine: { ...s.mine, [postId]: next },
      deltas: { ...s.deltas, [postId]: moved(s.deltas[postId], prev, next) },
    }));

    const rollback = (): void => set((s) => {
      const mine = { ...s.mine };
      if (hadKnown) mine[postId] = prev;
      else delete mine[postId];
      return { mine, deltas: { ...s.deltas, [postId]: moved(s.deltas[postId], next, prev) } };
    });

    const run = async (): Promise<void> => {
      try {
        if (get().supported !== false) {
          const result = await setMyReaction(postId, next);
          if (result.status === 'ok') {
            set({ supported: true });
            return;
          }
          set({ supported: false });
        }
        await legacyReact(postId, prev, next);
      } catch (e) {
        logError(e, 'reactionStore.react');
        rollback();
      }
    };

    const queued = (queues.get(postId) ?? Promise.resolve()).then(run);
    queues.set(postId, queued);
    return queued;
  },

  reset: () => {
    queues.clear();
    set({ ...EMPTY });
  },
}));
