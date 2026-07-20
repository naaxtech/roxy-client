import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user1' } } })) },
    channel: jest.fn(() => ({
      on: jest.fn(() => ({ subscribe: jest.fn(() => ({})) })),
    })),
    removeChannel: jest.fn(),
  },
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
const { supabase } = jest.requireMock('../../lib/supabase');

import { useFeedStore } from '../../store/feedStore';
import type { Post } from '../../types';

const makePost = (id: string, overrides: Partial<Post> = {}): Post => ({
  id,
  author_id: 'user-1',
  community_id: 'comm-1',
  content: 'Hello world',
  media_urls: [],
  post_type: 'standard',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 0,
  like_count: 0,
  save_count: 0,
  feed_score: 0,
  blurhash: null,
  deleted_at: null,
  video_url: null,
  video_thumbnail_url: null,
  video_duration_secs: null,
  video_aspect_ratio: null,
  link_type: null,
  link_entity_id: null,
  link_community_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

function makeQueryChain(data: unknown, error: null | { message: string } = null) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['select', 'eq', 'in', 'is', 'not', 'order', 'limit', 'gte'];
  methods.forEach(m => { chain[m] = jest.fn(() => chain); });
  (chain as any)[Symbol.iterator] = undefined;
  // Make the chain awaitable
  (chain as any).then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
    resolve({ data, error });
    return Promise.resolve({ data, error });
  };
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  useFeedStore.setState({
    posts: [],
    newPosts: [],
    loading: false,
    loadingMore: false,
    cursor: null,
    hasMore: true,
    newPostCount: 0,
    fetchError: null,
    likedPostIds: new Set(),
    savedPostIds: new Set(),
    seenPostIds: new Set(),
    videoQueue: [],
  });
});

describe('feedStore.fetchFeed', () => {
  it('populates posts from Supabase', async () => {
    const postsChain = makeQueryChain([makePost('p1'), makePost('p2')]);
    supabase.from.mockReturnValue(postsChain);

    const { result } = renderHook(() => useFeedStore());
    await act(async () => { await result.current.fetchFeed(['comm-1']); });

    expect(result.current.posts).toHaveLength(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.fetchError).toBeNull();
  });

  it('clears posts when communityIds is empty', async () => {
    useFeedStore.setState({ posts: [makePost('p1')] } as any);
    const { result } = renderHook(() => useFeedStore());
    await act(async () => { await result.current.fetchFeed([]); });
    expect(result.current.posts).toHaveLength(0);
  });

  it('sets fetchError on query failure', async () => {
    const failChain = makeQueryChain(null, { message: 'relation error' });
    supabase.from.mockReturnValue(failChain);

    const { result } = renderHook(() => useFeedStore());
    await act(async () => { await result.current.fetchFeed(['comm-1']); });

    expect(result.current.fetchError).toBe('relation error');
    expect(result.current.loading).toBe(false);
  });
});

describe('feedStore.init', () => {
  it('populates likedPostIds and savedPostIds', async () => {
    const likesChain = makeQueryChain([{ post_id: 'p1' }, { post_id: 'p2' }]);
    const savesChain = makeQueryChain([{ post_id: 'p3' }]);
    supabase.from.mockImplementation((table: string) =>
      table === 'post_likes' ? likesChain : savesChain
    );

    const { result } = renderHook(() => useFeedStore());
    await act(async () => { await result.current.init('user1'); });

    expect(result.current.likedPostIds.has('p1')).toBe(true);
    expect(result.current.likedPostIds.has('p2')).toBe(true);
    expect(result.current.savedPostIds.has('p3')).toBe(true);
  });
});

describe('feedStore.toggleLike', () => {
  it('optimistically adds likedPostId and increments like_count', async () => {
    const upsertChain = makeQueryChain(null);
    supabase.from.mockReturnValue({ upsert: jest.fn(() => upsertChain) });

    useFeedStore.setState({
      posts: [makePost('p1', { like_count: 5 })],
      likedPostIds: new Set(),
    } as any);

    const { result } = renderHook(() => useFeedStore());
    act(() => { void result.current.toggleLike('p1'); });

    expect(result.current.likedPostIds.has('p1')).toBe(true);
    expect(result.current.posts[0].like_count).toBe(6);
  });

  it('rolls back on DB error', async () => {
    const failChain = makeQueryChain(null, { message: 'db error' });
    supabase.from.mockReturnValue({
      upsert: jest.fn(() => failChain),
      delete: jest.fn(() => failChain),
    });

    useFeedStore.setState({
      posts: [makePost('p1', { like_count: 5 })],
      likedPostIds: new Set(),
    } as any);

    const { result } = renderHook(() => useFeedStore());
    await act(async () => { await result.current.toggleLike('p1'); });

    expect(result.current.likedPostIds.has('p1')).toBe(false);
    expect(result.current.posts[0].like_count).toBe(5);
  });
});

describe('feedStore.toggleSave', () => {
  it('optimistically adds savedPostId and increments save_count', async () => {
    const upsertChain = makeQueryChain(null);
    supabase.from.mockReturnValue({ upsert: jest.fn(() => upsertChain) });

    useFeedStore.setState({
      posts: [makePost('p1', { save_count: 2 })],
      savedPostIds: new Set(),
    } as any);

    const { result } = renderHook(() => useFeedStore());
    act(() => { void result.current.toggleSave('p1'); });

    expect(result.current.savedPostIds.has('p1')).toBe(true);
    expect(result.current.posts[0].save_count).toBe(3);
  });

  it('rolls back toggleSave on DB error', async () => {
    const failChain = makeQueryChain(null, { message: 'db error' });
    supabase.from.mockReturnValue({
      upsert: jest.fn(() => failChain),
      delete: jest.fn(() => failChain),
    });

    useFeedStore.setState({
      posts: [makePost('p1', { save_count: 2 })],
      savedPostIds: new Set(),
    } as any);

    const { result } = renderHook(() => useFeedStore());
    await act(async () => { await result.current.toggleSave('p1'); });

    expect(result.current.savedPostIds.has('p1')).toBe(false);
    expect(result.current.posts[0].save_count).toBe(2);
  });
});

describe('feedStore.acceptNewPosts', () => {
  it('moves newPosts to front and resets newPostCount', () => {
    const newPost = makePost('new1', { feed_score: 99 });
    useFeedStore.setState({
      posts: [makePost('old1')],
      newPosts: [newPost],
      newPostCount: 1,
      videoQueue: [],
    } as any);

    const { result } = renderHook(() => useFeedStore());
    act(() => { result.current.acceptNewPosts(); });

    expect(result.current.posts[0].id).toBe('new1');
    expect(result.current.posts[1].id).toBe('old1');
    expect(result.current.newPostCount).toBe(0);
  });
});

describe('feedStore.upsertPost', () => {
  it('inserts new post at front', () => {
    useFeedStore.setState({ posts: [makePost('p1')] } as any);
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.upsertPost(makePost('p2')));
    expect(result.current.posts[0].id).toBe('p2');
  });

  it('updates existing post in place', () => {
    useFeedStore.setState({ posts: [makePost('p1', { content: 'old' })] } as any);
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.upsertPost(makePost('p1', { content: 'updated' })));
    expect(result.current.posts).toHaveLength(1);
    expect(result.current.posts[0].content).toBe('updated');
  });
});
