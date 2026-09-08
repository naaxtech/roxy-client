import { useCommunityFilterStore } from '../../store/communityFilterStore';

/**
 * `filterable` exists because the Roxy FAB cannot see what the Feed is showing.
 *
 * The FAB offers "Filter this view" and used to decide whether that was
 * possible by sniffing the pathname for `/feed`. But the filter is honoured on
 * ONE of the Feed's three segments — Communities. On For You the scope is
 * `announcements` and `ReelsFeed` says in its own words that `communityIds` is
 * not consulted. So the action rendered enabled, opened a radio list, wrote a
 * selection, closed, and changed nothing on screen with no explanation.
 *
 * A pathname cannot answer "is a filter meaningful right now". The surface that
 * knows is the one drawing the feed, so it publishes the answer here.
 */
beforeEach(() => {
  useCommunityFilterStore.setState({ selectedCommunityId: null, filterable: false });
});

describe('communityFilterStore.filterable', () => {
  it('starts false — nothing is filterable until a surface claims it', () => {
    expect(useCommunityFilterStore.getState().filterable).toBe(false);
  });

  it('is set and cleared by the surface that owns the filter', () => {
    useCommunityFilterStore.getState().setFilterable(true);
    expect(useCommunityFilterStore.getState().filterable).toBe(true);

    useCommunityFilterStore.getState().setFilterable(false);
    expect(useCommunityFilterStore.getState().filterable).toBe(false);
  });

  it('drops any selection when the view stops being filterable', () => {
    // Otherwise a selection made on Communities keeps narrowing the feed the
    // next time she returns to it, from a decision she made minutes earlier on
    // a different segment — a filter she cannot see is a filter she cannot
    // undo.
    useCommunityFilterStore.getState().setFilterable(true);
    useCommunityFilterStore.getState().setSelectedCommunity('c1');
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBe('c1');

    useCommunityFilterStore.getState().setFilterable(false);
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBeNull();
  });

  it('keeps the selection while the view stays filterable', () => {
    useCommunityFilterStore.getState().setFilterable(true);
    useCommunityFilterStore.getState().setSelectedCommunity('c1');

    useCommunityFilterStore.getState().setFilterable(true);
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBe('c1');
  });
});
