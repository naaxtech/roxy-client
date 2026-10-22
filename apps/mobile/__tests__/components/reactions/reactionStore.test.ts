/**
 * Her reaction per post, as the rail sees it (Wave 2 feed).
 *
 * The store is the optimistic half of migration 136: a tap changes the rail
 * before the network answers, a failure rolls back, and the same code works
 * on a database that does not have 136 yet (likes for ❤️, the tally RPC for
 * the rest).
 */
import { act } from '@testing-library/react-native';

const mockSet = jest.fn();
const mockFetch = jest.fn();
const mockTally = jest.fn();
jest.mock('../../../lib/postReactions', () => ({
  ...jest.requireActual('../../../lib/postReactions'),
  setMyReaction: (...a: unknown[]) => mockSet(...a),
  fetchMyReactions: (...a: unknown[]) => mockFetch(...a),
  reactToPost: (...a: unknown[]) => mockTally(...a),
}));

const mockLikePost = jest.fn();
const mockToggleLike = jest.fn();
let mockLiked = new Set<string>();
jest.mock('../../../store/feedStore', () => ({
  useFeedStore: {
    getState: () => ({
      likedPostIds: mockLiked,
      likePost: (...a: unknown[]) => mockLikePost(...a),
      toggleLike: (...a: unknown[]) => mockToggleLike(...a),
    }),
  },
}));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));

import {
  myReactionOf, reactionTotalOf, useReactionStore,
} from '../../../components/reactions/reactionStore';

const POST = { id: 'p1', reaction_counts: { '❤️': 2, '😂': 1 }, like_count: 10 };

function state() {
  return useReactionStore.getState();
}

beforeEach(() => {
  mockSet.mockReset();
  mockFetch.mockReset();
  mockTally.mockReset();
  mockLikePost.mockReset();
  mockToggleLike.mockReset();
  mockLiked = new Set();
  useReactionStore.getState().reset();
});

describe('what the rail shows before she touches anything', () => {
  it('reads her legacy like as her heart until the server says otherwise', () => {
    expect(myReactionOf(state(), 'p1', true)).toBe('❤️');
    expect(myReactionOf(state(), 'p1', false)).toBeNull();
  });

  it('totals the tallies plus legacy likes', () => {
    expect(reactionTotalOf(state(), POST)).toBe(13);
  });
});

describe('react with 136 applied', () => {
  it('shows her emoji and the new total at once, then asks the server', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    mockSet.mockReturnValue(new Promise((r) => { resolve = r; }));

    let done: Promise<void> = Promise.resolve();
    act(() => { done = state().react('p1', '😮', { legacyLiked: false }); });

    expect(myReactionOf(state(), 'p1', false)).toBe('😮');
    expect(reactionTotalOf(state(), POST)).toBe(14);
    resolve({ status: 'ok', counts: {}, likeCount: 10 });
    await act(async () => { await done; });
    expect(mockSet).toHaveBeenCalledWith('p1', '😮');
    expect(state().supported).toBe(true);
  });

  it('moves her legacy heart instead of adding a second reaction', async () => {
    mockSet.mockResolvedValue({ status: 'ok', counts: {}, likeCount: 9 });

    await act(async () => { await state().react('p1', '😂', { legacyLiked: true }); });

    expect(myReactionOf(state(), 'p1', true)).toBe('😂');
    expect(reactionTotalOf(state(), POST)).toBe(13);
  });

  it('clears to the outline glyph and takes her count away', async () => {
    mockSet.mockResolvedValue({ status: 'ok', counts: {}, likeCount: 10 });
    await act(async () => { await state().react('p1', '💜', { legacyLiked: false }); });
    await act(async () => { await state().react('p1', null, { legacyLiked: false }); });

    expect(myReactionOf(state(), 'p1', true)).toBeNull();
    expect(reactionTotalOf(state(), POST)).toBe(13);
    expect(mockSet).toHaveBeenLastCalledWith('p1', null);
  });

  it('does nothing when she picks the reaction she already has', async () => {
    await act(async () => { await state().react('p1', '❤️', { legacyLiked: true }); });

    expect(mockSet).not.toHaveBeenCalled();
    expect(reactionTotalOf(state(), POST)).toBe(13);
  });

  it('rolls the rail back when the server refuses', async () => {
    mockSet.mockRejectedValue({ code: '42501', message: 'Post not found' });

    await act(async () => { await state().react('p1', '😢', { legacyLiked: false }); });

    expect(myReactionOf(state(), 'p1', false)).toBeNull();
    expect(reactionTotalOf(state(), POST)).toBe(13);
  });
});

describe('react before 136 reaches the database', () => {
  it('keeps a heart as a like, so it survives a reload', async () => {
    mockSet.mockResolvedValue({ status: 'unsupported' });

    await act(async () => { await state().react('p1', '❤️', { legacyLiked: false }); });

    expect(mockLikePost).toHaveBeenCalledWith('p1');
    expect(mockTally).not.toHaveBeenCalled();
    expect(state().supported).toBe(false);
  });

  it('sends any other emoji to the tally, and remembers not to ask again', async () => {
    mockSet.mockResolvedValue({ status: 'unsupported' });
    await act(async () => { await state().react('p1', '😂', { legacyLiked: false }); });
    await act(async () => { await state().react('p2', '😮', { legacyLiked: false }); });

    expect(mockTally).toHaveBeenCalledWith('p1', '😂');
    expect(mockTally).toHaveBeenCalledWith('p2', '😮');
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('takes her like back when she moves off the heart', async () => {
    mockSet.mockResolvedValue({ status: 'unsupported' });
    mockLiked = new Set(['p1']);

    await act(async () => { await state().react('p1', '😡', { legacyLiked: true }); });

    expect(mockToggleLike).toHaveBeenCalledWith('p1');
    expect(mockTally).toHaveBeenCalledWith('p1', '😡');
  });
});

describe('hydrate', () => {
  it('learns her reactions for the posts on screen', async () => {
    mockFetch.mockResolvedValue({ status: 'ok', mine: { p2: '💜' } });

    await act(async () => { await state().hydrate('me', ['p1', 'p2']); });

    expect(mockFetch).toHaveBeenCalledWith('me', ['p1', 'p2']);
    expect(myReactionOf(state(), 'p2', false)).toBe('💜');
    // No row is not "no reaction": a legacy like still reads as her heart.
    expect(myReactionOf(state(), 'p1', true)).toBe('❤️');
  });

  it('switches to the fallback quietly when 136 is missing', async () => {
    mockFetch.mockResolvedValue({ status: 'unsupported', mine: {} });

    await act(async () => { await state().hydrate('me', ['p1']); });
    await act(async () => { await state().hydrate('me', ['p2']); });

    expect(state().supported).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('asks about each post once, however often the feed re-renders', async () => {
    mockFetch.mockResolvedValue({ status: 'ok', mine: {} });

    await act(async () => { await state().hydrate('me', ['p1', 'p2']); });
    await act(async () => { await state().hydrate('me', ['p1', 'p2', 'p3']); });
    await act(async () => { await state().hydrate('me', ['p1']); });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenLastCalledWith('me', ['p3']);
  });

  it('forgets one member\'s reactions when another signs in', async () => {
    mockFetch.mockResolvedValueOnce({ status: 'ok', mine: { p1: '😂' } });
    await act(async () => { await state().hydrate('me', ['p1']); });
    mockFetch.mockResolvedValueOnce({ status: 'ok', mine: {} });
    await act(async () => { await state().hydrate('someone-else', ['p1']); });

    expect(myReactionOf(state(), 'p1', false)).toBeNull();
  });
});
