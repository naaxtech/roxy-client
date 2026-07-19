import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/errorLogger';
import { normalizePosts } from '../lib/posts';
import { POST_WITH_AUTHOR } from '../lib/supabaseQueries';
import type { Post } from '../types';

interface FeedState {
  posts: Post[];
  newPosts: Post[];
  loading: boolean;
  loadingMore: boolean;
  cursor: number | null;
  hasMore: boolean;
  newPostCount: number;
  fetchError: string | null;

  likedPostIds: Set<string>;
  savedPostIds: Set<string>;
  seenPostIds: Set<string>;

  videoQueue: string[];
  discoverScrollOffset: number;
  connectScrollOffset: number;

  init: (userId: string) => Promise<void>;
  fetchFeed: (communityIds: string[]) => Promise<void>;
  fetchMoreFeed: (communityIds: string[]) => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
  toggleSave: (postId: string) => Promise<void>;
  markSeen: (postId: string) => void;
  acceptNewPosts: () => void;
  pushNewPost: (post: Post) => void;
  upsertPost: (post: Post) => void;
  setDiscoverScrollOffset: (y: number) => void;
  setConnectScrollOffset: (y: number) => void;
  bumpCommentCount: (postId: string) => void;
}

const PAGE_SIZE = 15;

let fetchFeedGeneration = 0;

function excludeSeen(posts: Post[], seenIds: Set<string>): Post[] {
  if (!seenIds.size) return posts;
  return posts.filter(p => !seenIds.has(p.id));
}

export const useFeedStore = create<FeedState>((set, get) => ({
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
  discoverScrollOffset: 0,
  connectScrollOffset: 0,

  init: async (userId) => {
    const [likes, saves] = await Promise.all([
      supabase.from('post_likes').select('post_id').eq('user_id', userId),
      supabase.from('post_saves').select('post_id').eq('user_id', userId),
    ]);
    set({
      likedPostIds: new Set(likes.data?.map((r: { post_id: string }) => r.post_id) ?? []),
      savedPostIds: new Set(saves.data?.map((r: { post_id: string }) => r.post_id) ?? []),
    });
  },

  fetchFeed: async (communityIds) => {
    const generation = ++fetchFeedGeneration;

    if (!communityIds.length) {
      set({ posts: [], videoQueue: [], cursor: null, hasMore: false, loading: false, fetchError: null });
      return;
    }

    const isInitialLoad = get().posts.length === 0;
    if (isInitialLoad) {
      set({ loading: true, fetchError: null });
    }

    try {
      const seenIds = get().seenPostIds;
      const { data, error } = await supabase
        .from('posts')
        .select(POST_WITH_AUTHOR)
        .in('community_id', communityIds)
        .is('deleted_at', null)
        .order('feed_score', { ascending: false })
        .limit(PAGE_SIZE);

      if (generation !== fetchFeedGeneration) return;

      if (error) {
        logError(error, 'feedStore.fetchFeed');
        set({ loading: false, fetchError: error.message });
        return;
      }

      const posts = excludeSeen(normalizePosts(data), seenIds);
      const videoQueue = posts.filter(p => p.post_type === 'video').map(p => p.id);
      set({
        posts,
        videoQueue,
        cursor: posts.length ? posts[posts.length - 1].feed_score : null,
        hasMore: (data?.length ?? 0) === PAGE_SIZE,
        loading: false,
        fetchError: null,
      });
    } catch (e) {
      if (generation !== fetchFeedGeneration) return;
      logError(e, 'feedStore.fetchFeed');
      set({ loading: false, fetchError: 'Could not load the feed.' });
    }
  },

  fetchMoreFeed: async (communityIds) => {
    const { cursor, loadingMore, hasMore, posts: existing, seenPostIds } = get();
    if (loadingMore || !hasMore || cursor === null || !communityIds.length) return;
    set({ loadingMore: true });
    const existingIds = new Set(existing.map(p => p.id));
    let query = supabase
      .from('posts')
      .select(POST_WITH_AUTHOR)
      .in('community_id', communityIds)
      .is('deleted_at', null)
      .lt('feed_score', cursor)
      .order('feed_score', { ascending: false })
      .limit(PAGE_SIZE);

    const { data, error } = await query;
    if (error) {
      logError(error, 'feedStore.fetchMoreFeed');
      set({ loadingMore: false });
      return;
    }

    const more = excludeSeen(
      normalizePosts(data).filter(p => !existingIds.has(p.id)),
      seenPostIds,
    );
    const newVideos = more.filter(p => p.post_type === 'video').map(p => p.id);
    set(s => ({
      posts: [...s.posts, ...more],
      videoQueue: [...s.videoQueue, ...newVideos],
      cursor: more.length ? more[more.length - 1].feed_score : s.cursor,
      hasMore: (data?.length ?? 0) === PAGE_SIZE,
      loadingMore: false,
    }));
  },

  toggleLike: async (postId) => {
    const wasLiked = get().likedPostIds.has(postId);
    set(s => ({
      likedPostIds: wasLiked
        ? new Set([...s.likedPostIds].filter(id => id !== postId))
        : new Set([...s.likedPostIds, postId]),
      posts: s.posts.map(p =>
        p.id === postId ? { ...p, like_count: p.like_count + (wasLiked ? -1 : 1) } : p
      ),
    }));
    // Upsert, not insert: a row can already exist server-side (state drift,
    // double-tap, another device) and a bare insert 409s on the PK — the
    // optimistic UI then reverts and the tap looks dead.
    const { error } = wasLiked
      ? await supabase.from('post_likes').delete().eq('post_id', postId)
      : await supabase.from('post_likes').upsert(
          { post_id: postId },
          { onConflict: 'post_id,user_id', ignoreDuplicates: true },
        );
    if (error) {
      set(s => ({
        likedPostIds: wasLiked
          ? new Set([...s.likedPostIds, postId])
          : new Set([...s.likedPostIds].filter(id => id !== postId)),
        posts: s.posts.map(p =>
          p.id === postId ? { ...p, like_count: p.like_count + (wasLiked ? 1 : -1) } : p
        ),
      }));
    }
  },

  toggleSave: async (postId) => {
    const wasSaved = get().savedPostIds.has(postId);
    set(s => ({
      savedPostIds: wasSaved
        ? new Set([...s.savedPostIds].filter(id => id !== postId))
        : new Set([...s.savedPostIds, postId]),
      posts: s.posts.map(p =>
        p.id === postId ? { ...p, save_count: p.save_count + (wasSaved ? -1 : 1) } : p
      ),
    }));
    const { error } = wasSaved
      ? await supabase.from('post_saves').delete().eq('post_id', postId)
      : await supabase.from('post_saves').upsert(
          { post_id: postId },
          { onConflict: 'post_id,user_id', ignoreDuplicates: true },
        );
    if (error) {
      set(s => ({
        savedPostIds: wasSaved
          ? new Set([...s.savedPostIds, postId])
          : new Set([...s.savedPostIds].filter(id => id !== postId)),
        posts: s.posts.map(p =>
          p.id === postId ? { ...p, save_count: p.save_count + (wasSaved ? 1 : -1) } : p
        ),
      }));
    }
  },

  markSeen: (postId) => {
    set(s => ({ seenPostIds: new Set([...s.seenPostIds, postId]) }));
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      void supabase
        .from('seen_posts')
        .upsert({ post_id: postId, user_id: user.id }, { onConflict: 'user_id,post_id' })
        .then(() => {});
    });
  },

  acceptNewPosts: () => {
    const { newPosts } = get();
    const newVideos = newPosts.filter(p => p.post_type === 'video').map(p => p.id);
    set(s => ({
      posts: [...newPosts, ...s.posts],
      videoQueue: [...newVideos, ...s.videoQueue],
      newPosts: [],
      newPostCount: 0,
    }));
  },

  pushNewPost: (raw) => {
    const post = normalizePosts([raw])[0] ?? raw;
    set(s => ({
      newPosts: [post, ...s.newPosts],
      newPostCount: s.newPostCount + 1,
    }));
  },

  upsertPost: (post) => {
    set(s => {
      const idx = s.posts.findIndex(p => p.id === post.id);
      if (idx === -1) return { posts: [post, ...s.posts] };
      const updated = [...s.posts];
      updated[idx] = post;
      return { posts: updated };
    });
  },

  setDiscoverScrollOffset: (y) => set({ discoverScrollOffset: y }),
  setConnectScrollOffset: (y) => set({ connectScrollOffset: y }),

  bumpCommentCount: (postId) => set(s => ({
    posts: s.posts.map(p =>
      p.id === postId ? { ...p, comment_count: p.comment_count + 1 } : p
    ),
  })),
}));
