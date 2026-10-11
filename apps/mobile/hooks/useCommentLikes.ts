import { useCallback, useRef, useState } from 'react';
import { toggleCommentLike } from '../lib/comments';
import { logError } from '../lib/errorLogger';
import { tapLight } from '../lib/haptics';

/**
 * Which comments she has liked, with an optimistic toggle that rolls back.
 *
 * Every host of a comment thread used to flip the heart and then ignore the
 * `{ error }` from `toggleCommentLike`, so a refused write (offline, a block
 * that landed in between, RLS) left a lit heart over a like that did not
 * exist. This flips first for feel, then puts it back when the write failed.
 * A second tap on the same comment while the first write is in flight is
 * ignored, so two quick taps cannot race each other into the wrong state.
 */
export function useCommentLikes(userId: string | null | undefined) {
  const [likedIds, setLikedIdsState] = useState<Set<string>>(() => new Set());
  const likedRef = useRef(likedIds);
  const inflight = useRef(new Set<string>());

  const setLikedIds = useCallback((next: Set<string>) => {
    likedRef.current = next;
    setLikedIdsState(next);
  }, []);

  /** Adds ids read from a further page without dropping what is already known. */
  const mergeLikedIds = useCallback((more: Set<string>) => {
    const next = new Set(likedRef.current);
    more.forEach((id) => next.add(id));
    setLikedIds(next);
  }, [setLikedIds]);

  const flip = useCallback((commentId: string, on: boolean) => {
    const next = new Set(likedRef.current);
    if (on) next.add(commentId); else next.delete(commentId);
    setLikedIds(next);
  }, [setLikedIds]);

  /** Resolves true when the like (or unlike) landed. */
  const toggle = useCallback(async (commentId: string): Promise<boolean> => {
    if (!userId || inflight.current.has(commentId)) return false;
    const wasLiked = likedRef.current.has(commentId);
    flip(commentId, !wasLiked);
    if (!wasLiked) tapLight();
    inflight.current.add(commentId);
    try {
      const { error } = await toggleCommentLike({ commentId, userId, liked: wasLiked });
      if (error) {
        logError(new Error(error), 'useCommentLikes.toggle');
        flip(commentId, wasLiked);
        return false;
      }
      return true;
    } catch (e) {
      logError(e, 'useCommentLikes.toggle');
      flip(commentId, wasLiked);
      return false;
    } finally {
      inflight.current.delete(commentId);
    }
  }, [userId, flip]);

  return { likedIds, setLikedIds, mergeLikedIds, toggle };
}
