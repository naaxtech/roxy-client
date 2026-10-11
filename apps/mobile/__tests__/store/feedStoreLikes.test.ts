/**
 * Likes have one source of truth: feedStore (FEED-07/09, slice 2).
 *
 * - `likePost` is the double tap: it only ever makes a post liked. Four fast
 *   taps used to be two toggles, and the second one unliked.
 * - A second toggle while the first write is in flight is ignored, so a
 *   double tap followed by a rail tap cannot race two writes and leave the
 *   heart and the count disagreeing with the server.
 * - A failed write rolls back the set, the cached post and the delta that the
 *   pager lists read through `displayedLikeCount`.
 */
import { act } from '@testing-library/react-native';

const mockCalls: { op: string; postId?: string }[] = [];
const mockResult: { error: { message: string } | null; hold: Promise<void> | null } = {
  error: null, hold: null,
};

jest.mock('../../lib/supabase', () => {
  const answer = async (): Promise<{ data: null; error: { message: string } | null }> => {
    if (mockResult.hold) await mockResult.hold;
    return { data: null, error: mockResult.error };
  };
  return {
    supabase: {
      from: jest.fn(() => ({
        upsert: jest.fn((row: { post_id: string }) => {
          mockCalls.push({ op: 'upsert', postId: row.post_id });
          return answer();
        }),
        delete: jest.fn(() => ({
          eq: jest.fn((_col: string, postId: string) => {
            mockCalls.push({ op: 'delete', postId });
            return answer();
          }),
        })),
      })),
    },
  };
});
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { useFeedStore } from '../../store/feedStore';

function reset(liked: string[] = []): void {
  useFeedStore.setState({
    likedPostIds: new Set(liked),
    likeCountDeltas: {},
    posts: [],
  } as never);
}

beforeEach(() => {
  mockCalls.length = 0;
  mockResult.error = null;
  mockResult.hold = null;
  reset();
});

describe('feedStore.likePost (the double tap)', () => {
  it('likes a post that is not liked yet, once', async () => {
    await act(async () => { await useFeedStore.getState().likePost('p1'); });

    expect(useFeedStore.getState().likedPostIds.has('p1')).toBe(true);
    expect(useFeedStore.getState().likeCountDeltas.p1).toBe(1);
    expect(mockCalls).toEqual([{ op: 'upsert', postId: 'p1' }]);
  });

  it('never unlikes: a double tap on a liked post writes nothing', async () => {
    reset(['p1']);
    await act(async () => { await useFeedStore.getState().likePost('p1'); });

    expect(useFeedStore.getState().likedPostIds.has('p1')).toBe(true);
    expect(useFeedStore.getState().likeCountDeltas.p1 ?? 0).toBe(0);
    expect(mockCalls).toEqual([]);
  });

  it('four fast double taps are one like, not two toggles', async () => {
    let release: () => void = () => undefined;
    mockResult.hold = new Promise<void>((r) => { release = r; });

    const pending = [1, 2, 3, 4].map(() => useFeedStore.getState().likePost('p1'));
    release();
    await act(async () => { await Promise.all(pending); });

    expect(useFeedStore.getState().likedPostIds.has('p1')).toBe(true);
    expect(useFeedStore.getState().likeCountDeltas.p1).toBe(1);
    expect(mockCalls).toHaveLength(1);
  });

  it('rolls back the heart and the count when the write fails', async () => {
    mockResult.error = { message: 'offline' };
    await act(async () => { await useFeedStore.getState().likePost('p1'); });

    expect(useFeedStore.getState().likedPostIds.has('p1')).toBe(false);
    expect(useFeedStore.getState().likeCountDeltas.p1).toBe(0);
  });
});

describe('feedStore.toggleLike (the rail)', () => {
  it('ignores a second toggle while the first write is in flight', async () => {
    let release: () => void = () => undefined;
    mockResult.hold = new Promise<void>((r) => { release = r; });

    const first = useFeedStore.getState().toggleLike('p1');
    const second = useFeedStore.getState().toggleLike('p1');
    release();
    await act(async () => { await Promise.all([first, second]); });

    expect(mockCalls).toEqual([{ op: 'upsert', postId: 'p1' }]);
    expect(useFeedStore.getState().likedPostIds.has('p1')).toBe(true);
    expect(useFeedStore.getState().likeCountDeltas.p1).toBe(1);
  });

  it('unlikes and rolls the unlike back when the delete fails', async () => {
    reset(['p1']);
    mockResult.error = { message: 'offline' };
    await act(async () => { await useFeedStore.getState().toggleLike('p1'); });

    expect(useFeedStore.getState().likedPostIds.has('p1')).toBe(true);
    expect(useFeedStore.getState().likeCountDeltas.p1).toBe(0);
    expect(mockCalls).toEqual([{ op: 'delete', postId: 'p1' }]);
  });

  it('is free again once the write settles', async () => {
    await act(async () => { await useFeedStore.getState().toggleLike('p1'); });
    await act(async () => { await useFeedStore.getState().toggleLike('p1'); });

    expect(mockCalls.map((c) => c.op)).toEqual(['upsert', 'delete']);
    expect(useFeedStore.getState().likedPostIds.has('p1')).toBe(false);
    expect(useFeedStore.getState().likeCountDeltas.p1).toBe(0);
  });
});
