import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Post } from '../types';

interface FeedState {
  posts: Post[];
  newPosts: Post[];
  loading: boolean;
  loadingMore: boolean;
  cursor: string | null;
  hasMore: boolean;
  newPostCount: number;

  likedPostIds: Set<string>;
  savedPostIds: Set<string>;
  seenPostIds: Set<string>;

  videoQueue: string[];

  init: (userId: string) => Promise<void>;
  fetchFeed: (communityIds: string[]) => Promise<void>;
  fetchMoreFeed: (communityIds: string[]) => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
  toggleSave: (postId: string) => Promise<void>;
  markSeen: (postId: string) => void;
  acceptNewPosts: () => void;
  pushNewPost: (post: Post) => void;
  upsertPost: (post: Post) => void;
}

export const useFeedStore = create<FeedState>((set, get) => ({
  posts: [],
  newPosts: [],
  loading: false,
  loadingMore: false,
  cursor: null,
  hasMore: true,
  newPostCount: 0,
  likedPostIds: new Set(),
  savedPostIds: new Set(),
  seenPostIds: new Set(),
  videoQueue: [],

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
    if (!communityIds.length) return;
    set({ loading: true });
    const seenIds = Array.from(get().seenPostIds);
    let query = supabase
      .from('posts')
      .select('*, profiles(display_name, avatar_url)')
      .in('community_id', communityIds)
      .is('deleted_at', null)
      .order('feed_score', { ascending: false })
      .limit(15);
    if (seenIds.length) {
      query = (query as any).not('id', 'in', `(${seenIds.join(',')})`);
    }
    const { data } = await query;
    const posts = (data ?? []) as Post[];
    const videoQueue = posts.filter(p => p.post_type === 'video').map(p => p.id);
    set({
      posts,
      videoQueue,
      cursor: posts.length ? posts[posts.length - 1].created_at : null,
      hasMore: posts.length === 15,
      loading: false,
    });
  },

  fetchMoreFeed: async (communityIds) => {
    const { cursor, loadingMore, hasMore } = get();
    if (loadingMore || !hasMore || !cursor || !communityIds.length) return;
    set({ loadingMore: true });
    const seenIds = Array.from(get().seenPostIds);
    let query = supabase
      .from('posts')
      .select('*, profiles(display_name, avatar_url)')
      .in('community_id', communityIds)
      .is('deleted_at', null)
      .order('feed_score', { ascending: false })
      .limit(15);
    if (seenIds.length) {
      query = (query as any).not('id', 'in', `(${seenIds.join(',')})`);
    }
    const { data } = await query;
    const more = (data ?? []) as Post[];
    const newVideos = more.filter(p => p.post_type === 'video').map(p => p.id);
    set(s => ({
      posts: [...s.posts, ...more],
      videoQueue: [...s.videoQueue, ...newVideos],
      cursor: more.length ? more[more.length - 1].created_at : s.cursor,
      hasMore: more.length === 15,
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
    const { error } = wasLiked
      ? await supabase.from('post_likes').delete().eq('post_id', postId)
      : await supabase.from('post_likes').insert({ post_id: postId });
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
      : await supabase.from('post_saves').insert({ post_id: postId });
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
    void supabase.from('seen_posts').insert({ post_id: postId }).then(() => {});
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

  pushNewPost: (post) => {
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
}));
