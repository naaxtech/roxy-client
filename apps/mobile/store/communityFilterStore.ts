import { create } from 'zustand';

interface CommunityFilterState {
  selectedCommunityId: string | null;
  /**
   * Whether the surface on screen right now can actually act on a selection.
   *
   * The Roxy FAB offers "Filter this view" from anywhere, and it has no way to
   * see what is being drawn. It used to guess from the pathname — `/feed` meant
   * filterable — but the Feed honours the filter on ONE of its three segments.
   * On For You the scope is `announcements`, where `ReelsFeed` does not consult
   * `communityIds` at all, so the action rendered enabled, wrote a selection,
   * and changed nothing with no explanation.
   *
   * The surface drawing the feed is the only thing that knows, so it says so.
   */
  filterable: boolean;
  setSelectedCommunity: (id: string | null) => void;
  setFilterable: (filterable: boolean) => void;
}

export const useCommunityFilterStore = create<CommunityFilterState>((set) => ({
  selectedCommunityId: null,
  filterable: false,
  setSelectedCommunity: (id) => set({ selectedCommunityId: id }),
  // Leaving a filterable view drops the selection with it. A filter that
  // survives out of sight is one she cannot see to undo, and it would narrow
  // her feed again on her next visit from a decision she made minutes ago
  // somewhere else.
  setFilterable: (filterable) =>
    set(filterable ? { filterable } : { filterable, selectedCommunityId: null }),
}));
