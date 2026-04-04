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
  fetchJoined: (userId: string) => Promise<void>;
  fetchAll: () => Promise<void>;
  joinCommunity: (communityId: string, userId: string) => Promise<void>;
  leaveCommunity: (communityId: string, userId: string) => Promise<void>;
};

export const useCommunityStore = create<CommunityStore>((set, get) => ({
  joinedCommunities: [], allCommunities: [], joinedIds: new Set(),

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
    const { error } = await supabase
      .from('community_members')
      .upsert({ community_id: communityId, user_id: userId, role: 'member' }, { onConflict: 'community_id,user_id', ignoreDuplicates: true });
    if (error) throw error;
    const { joinedIds, joinedCommunities, allCommunities } = get();
    const community = allCommunities.find((c) => c.id === communityId);
    const newIds = new Set(joinedIds); newIds.add(communityId);
    set({ joinedIds: newIds, joinedCommunities: community ? [...joinedCommunities, community] : joinedCommunities });
  },

  leaveCommunity: async (communityId, userId) => {
    const { error } = await supabase
      .from('community_members')
      .delete()
      .eq('community_id', communityId)
      .eq('user_id', userId);
    if (error) throw error;
    const { joinedIds, joinedCommunities } = get();
    const newIds = new Set(joinedIds); newIds.delete(communityId);
    set({ joinedIds: newIds, joinedCommunities: joinedCommunities.filter((c) => c.id !== communityId) });
  },
}));
