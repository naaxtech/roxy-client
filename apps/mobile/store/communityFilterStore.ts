import { create } from 'zustand';

interface CommunityFilterState {
  selectedCommunityId: string | null;
  setSelectedCommunity: (id: string | null) => void;
}

export const useCommunityFilterStore = create<CommunityFilterState>((set) => ({
  selectedCommunityId: null,
  setSelectedCommunity: (id) => set({ selectedCommunityId: id }),
}));
