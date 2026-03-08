import { create } from 'zustand';
import { Post, Event } from '../types';

interface FeedState {
  posts: Post[];
  events: Event[];
  loading: boolean;
  rsvpdEventIds: Set<string>;
  setPosts: (posts: Post[]) => void;
  setEvents: (events: Event[]) => void;
  setLoading: (loading: boolean) => void;
  upsertPost: (post: Post) => void;
  incrementReaction: (postId: string, emoji: string) => void;
  markRsvpd: (eventId: string) => void;
  unmarkRsvpd: (eventId: string) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  posts: [],
  events: [],
  loading: false,
  rsvpdEventIds: new Set(),

  setPosts: (posts) => set({ posts }),

  setEvents: (events) => set({ events }),

  setLoading: (loading) => set({ loading }),

  upsertPost: (post) =>
    set((s) => {
      const idx = s.posts.findIndex((p) => p.id === post.id);
      if (idx === -1) return { posts: [post, ...s.posts] };
      const updated = [...s.posts];
      updated[idx] = post;
      return { posts: updated };
    }),

  incrementReaction: (postId, emoji) =>
    set((s) => ({
      posts: s.posts.map((p) =>
        p.id === postId
          ? {
              ...p,
              reaction_counts: {
                ...p.reaction_counts,
                [emoji]: (p.reaction_counts[emoji] ?? 0) + 1,
              },
            }
          : p
      ),
    })),

  markRsvpd: (eventId) =>
    set((s) => ({
      rsvpdEventIds: new Set([...s.rsvpdEventIds, eventId]),
    })),

  unmarkRsvpd: (eventId) =>
    set((s) => ({
      rsvpdEventIds: new Set([...s.rsvpdEventIds].filter((id) => id !== eventId)),
    })),
}));
