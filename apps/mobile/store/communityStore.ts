import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { officialCommunityIdsFromProfiles } from '../lib/officialGrant';
import { requestToJoinCommunity, type JoinOutcome } from '../lib/communityMembership';

export type Community = {
  id: string; name: string; slug: string; description: string | null;
  cover_image_url: string | null; category: string; is_private: boolean;
  member_count: number; created_by: string; created_at: string;
};

type CommunityStore = {
  joinedCommunities: Community[];
  allCommunities: Community[];
  joinedIds: Set<string>;
  /** Private communities she has asked to join this session (pending a moderator). */
  requestedIds: Set<string>;
  officialCommunityIds: Set<string>;
  hydrated: boolean;
  fetchJoined: (userId: string) => Promise<void>;
  fetchAll: () => Promise<void>;
  fetchOfficialIds: () => Promise<void>;
  hydrate: (userId?: string) => Promise<void>;
  /**
   * 'joined' for a public community (or a private one she was invited to),
   * 'requested' for a private one — a moderator decides. Throws her words.
   * `_userId` is kept for the callers' signature; the server uses auth.uid().
   */
  joinCommunity: (communityId: string, _userId: string) => Promise<JoinOutcome>;
  leaveCommunity: (communityId: string, userId: string) => Promise<void>;
};

export const useCommunityStore = create<CommunityStore>((set, get) => ({
  joinedCommunities: [], allCommunities: [], joinedIds: new Set(), requestedIds: new Set(),
  officialCommunityIds: new Set(), hydrated: false,

  hydrate: async (userId) => {
    await Promise.all([
      get().fetchAll(),
      get().fetchOfficialIds(),
      userId ? get().fetchJoined(userId) : Promise.resolve(),
    ]);
    set({ hydrated: true });
  },

  fetchOfficialIds: async () => {
    const { data } = await supabase
      .from('profiles')
      .select('official_community_id')
      .not('official_community_id', 'is', null);
    set({ officialCommunityIds: new Set(officialCommunityIdsFromProfiles(data ?? [])) });
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

  joinCommunity: async (communityId) => {
    // Optimistic only where the answer is known: a public community opens at
    // once. A private one waits for the server — it files a request, and the
    // button must not say "Joined" over a door that is still closed.
    const { joinedIds, joinedCommunities, allCommunities } = get();
    const community = allCommunities.find((c) => c.id === communityId);
    const optimistic = !!community && !community.is_private;
    if (optimistic) {
      const optimisticIds = new Set(joinedIds);
      optimisticIds.add(communityId);
      set({ joinedIds: optimisticIds, joinedCommunities: [...joinedCommunities, community] });
    }

    let outcome: JoinOutcome;
    try {
      outcome = await requestToJoinCommunity(communityId);
    } catch (error) {
      if (optimistic) {
        const revertIds = new Set(get().joinedIds);
        revertIds.delete(communityId);
        set({
          joinedIds: revertIds,
          joinedCommunities: get().joinedCommunities.filter((c) => c.id !== communityId),
        });
      }
      throw error;
    }

    if (outcome === 'requested') {
      const requested = new Set(get().requestedIds);
      requested.add(communityId);
      const revertIds = new Set(get().joinedIds);
      revertIds.delete(communityId);
      set({
        requestedIds: requested,
        joinedIds: revertIds,
        joinedCommunities: get().joinedCommunities.filter((c) => c.id !== communityId),
      });
    } else if (!get().joinedIds.has(communityId)) {
      const ids = new Set(get().joinedIds);
      ids.add(communityId);
      set({ joinedIds: ids, joinedCommunities: community ? [...get().joinedCommunities, community] : get().joinedCommunities });
    }
    return outcome;
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
