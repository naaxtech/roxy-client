import { create } from 'zustand';
import { fetchFollowingIds, followUser, unfollowUser } from '../lib/follows';

type FollowStore = {
  followingIds: Set<string>;
  hydrated: boolean;
  hydrate: (userId: string) => Promise<void>;
  follow: (userId: string, targetId: string) => Promise<void>;
  unfollow: (userId: string, targetId: string) => Promise<void>;
};

export const useFollowStore = create<FollowStore>((set, get) => ({
  followingIds: new Set(),
  hydrated: false,

  hydrate: async (userId) => {
    const ids = await fetchFollowingIds(userId);
    set({ followingIds: new Set(ids), hydrated: true });
  },

  follow: async (userId, targetId) => {
    const next = new Set(get().followingIds);
    next.add(targetId);
    set({ followingIds: next });
    const ok = await followUser(userId, targetId);
    if (!ok) {
      const revert = new Set(get().followingIds);
      revert.delete(targetId);
      set({ followingIds: revert });
    }
  },

  unfollow: async (userId, targetId) => {
    const next = new Set(get().followingIds);
    next.delete(targetId);
    set({ followingIds: next });
    const ok = await unfollowUser(userId, targetId);
    if (!ok) {
      const revert = new Set(get().followingIds);
      revert.add(targetId);
      set({ followingIds: revert });
    }
  },
}));
