import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type Community = {
  id: string; name: string; slug: string; description: string | null;
  cover_image_url: string | null; category: string; is_private: boolean;
  member_count: number; created_by: string; created_at: string;
};

type CommunityStore = {
  joinedCommunities: Community[];
  allCommunities: Community[];
  joinedIds: Set<string>;
  hydrated: boolean;
  fetchJoined: (userId: string) => Promise<void>;
  fetchAll: () => Promise<void>;
  hydrate: (userId?: string) => Promise<void>;
  joinCommunity: (communityId: string, userId: string) => Promise<void>;
  leaveCommunity: (communityId: string, userId: string) => Promise<void>;
};

export const useCommunityStore = create<CommunityStore>((set, get) => ({
  joinedCommunities: [], allCommunities: [], joinedIds: new Set(), hydrated: false,

  hydrate: async (userId) => {
    await Promise.all([
      get().fetchAll(),
      userId ? get().fetchJoined(userId) : Promise.resolve(),
    ]);
    set({ hydrated: true });
  },

  fetchJoined: async (userId) => {
    const { data } = await supabase.from('community_members').select('communities(*)').eq('user_id', userId);
    const communities = (data ?? []).map((r: any) => r.communities).filter(Boolean) as Community[];
    set({ joinedCommunities: communities, joinedIds: new Set(communities.map((c) => c.id)) });
  },

  fetchAll: async () => {
    const { data } = await supabase.from('communities').select('*').order('member_count', { ascending: false });
    set({ allCommunities: (data ?? []) as Community[] });
  },

  joinCommunity: async (communityId, userId) => {
    // Optimistic update — button reflects instantly, no wait for network
    const { joinedIds, joinedCommunities, allCommunities } = get();
    const community = allCommunities.find((c) => c.id === communityId);
    const optimisticIds = new Set(joinedIds);
    optimisticIds.add(communityId);
    set({
      joinedIds: optimisticIds,
      joinedCommunities: community ? [...joinedCommunities, community] : joinedCommunities,
    });

    const { error } = await supabase
      .from('community_members')
      .upsert({ community_id: communityId, user_id: userId, role: 'member' }, { onConflict: 'community_id,user_id', ignoreDuplicates: true });

    if (error) {
      // Revert on failure
      const revertIds = new Set(get().joinedIds);
      revertIds.delete(communityId);
      set({
        joinedIds: revertIds,
        joinedCommunities: get().joinedCommunities.filter((c) => c.id !== communityId),
      });
      throw error;
    }
  },

  leaveCommunity: async (communityId, userId) => {
    // Optimistic update — button reflects instantly
    const { joinedIds, joinedCommunities } = get();
    const optimisticIds = new Set(joinedIds);
    optimisticIds.delete(communityId);
    set({
      joinedIds: optimisticIds,
      joinedCommunities: joinedCommunities.filter((c) => c.id !== communityId),
    });

    const { error } = await supabase
      .from('community_members')
      .delete()
      .eq('community_id', communityId)
      .eq('user_id', userId);

    if (error) {
      // Revert on failure
      const revertIds = new Set(get().joinedIds);
      revertIds.add(communityId);
      const community = get().allCommunities.find((c) => c.id === communityId);
      set({
        joinedIds: revertIds,
        joinedCommunities: community ? [...get().joinedCommunities, community] : get().joinedCommunities,
      });
      throw error;
    }
  },
}));
