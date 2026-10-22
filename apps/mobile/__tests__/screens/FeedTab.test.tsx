import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

// Inline mock factories only — see CLAUDE.md §12.2 (jest.mock hoisting).

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

// The Mini Wins gate reads AsyncStorage for "already shown today" — resolve
// with today's key so the sheet-open effect is a no-op and this suite stays
// about the header, not about that gate. Every other key (the question of the
// day's "answered") starts empty; a test may answer it via mockStorage.
const mockStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(
    key === 'roxy_mini_wins_last_shown' ? new Date().toISOString().slice(0, 10) : (mockStorage[key] ?? null),
  )),
  setItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

let mockKind = 'member';
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({
    kind: mockKind,
    tier: 'beta',
    isBeta: true,
    can: () => true,
    canCommunity: () => true,
  }),
}));

// FirstStepsCard owns its own reads and its dismiss/persist rules (tested in
// WelcomeIn.test.tsx); here it is only a marker for "mounted or not".
jest.mock('../../components/account/FirstStepsCard', () => {
  const { View } = require('react-native');
  return { FirstStepsCard: ({ testID }: { testID?: string }) => <View testID={testID ?? 'first-steps-card'} /> };
});

// StreakChip and NowRail each own a real Supabase query of their own; this
// suite is about the header's composition and the ids ReelsFeed receives,
// neither of which either component affects.
jest.mock('../../components/feed/StreakChip', () => ({ StreakChip: () => null }));
jest.mock('../../components/feed/NowRail', () => ({ NowRail: () => null }));
jest.mock('../../components/feed/MiniWinsSheet', () => ({ MiniWinsSheet: () => null }));

/** Records every prop set the screen hands ReelsFeed — the thing under test. */
jest.mock('../../components/feed/ReelsFeed', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const calls: Record<string, unknown>[] = [];
  const ReelsFeed = (props: Record<string, unknown>): React.ReactElement => {
    calls.push(props);
    return ReactLocal.createElement(View, { testID: 'reels-feed-mock' });
  };
  return { ReelsFeed, __calls: calls };
});

jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'feed-tab-tester' } };
  const useAuthStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  return { useAuthStore };
});

jest.mock('../../store/followStore', () => {
  const state = {
    followingIds: new Set<string>(),
    hydrate: jest.fn(() => Promise.resolve()),
  };
  const useFollowStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  return { useFollowStore };
});

// Two joined communities, no more — enough to prove "all of them" is really
// all of them, and not a fixture that happens to have one entry.
jest.mock('../../store/communityStore', () => {
  const state = {
    joinedCommunities: [
      {
        id: 'c1', name: 'Queer Book Club', slug: 'qbc', description: null,
        cover_image_url: null, category: 'interest', is_private: false,
        member_count: 20, created_by: 'u0', created_at: '2026-01-01',
      },
      {
        id: 'c2', name: 'WLW Hikers', slug: 'wlw-hikers', description: null,
        cover_image_url: null, category: 'interest', is_private: false,
        member_count: 15, created_by: 'u0', created_at: '2026-01-01',
      },
    ],
    joinedIds: new Set(['c1', 'c2']),
    hydrate: jest.fn(() => Promise.resolve()),
  };
  const useCommunityStore = (selector: (s: typeof state) => unknown): unknown => selector(state);
  return { useCommunityStore };
});

import FeedScreen from '../../app/(tabs)/feed/index';
import { useCommunityFilterStore } from '../../store/communityFilterStore';
import { dailyPromptFor, markDailyPromptAnswered } from '../../lib/dailyPrompt';

const { __calls: reelsFeedCalls } = jest.requireMock('../../components/feed/ReelsFeed') as {
  __calls: Record<string, unknown>[];
};

/** ReelsFeed re-renders on every screen state change; only the latest call matters. */
function lastReelsFeedProps(): Record<string, unknown> {
  return reelsFeedCalls[reelsFeedCalls.length - 1];
}

beforeEach(() => {
  reelsFeedCalls.length = 0;
  mockKind = 'member';
  useCommunityFilterStore.setState({ selectedCommunityId: null, filterable: false });
});

/**
 * v2 (direction › What changes: "Three first-run checklists → one nudge at a
 * time, in place"; Feed note: the post is the screen). The first-steps card no
 * longer sits over For You; it stays on "You're in" (welcome-in), where it is
 * the next step after the card. Was: an approved member saw it over For You.
 */
describe('First steps on the Feed (G-11, after "You\'re in")', () => {
  it('an approved member gets the post, not a checklist card over it', () => {
    const { queryByTestId, getByTestId } = render(<FeedScreen />);
    expect(getByTestId('feed-segment-following')).toBeTruthy();
    expect(queryByTestId('feed-first-steps')).toBeNull();
  });

  it('only on For You, not over Following or Communities', () => {
    const { getByTestId, queryByTestId } = render(<FeedScreen />);
    fireEvent.press(getByTestId('feed-segment-following'));
    expect(queryByTestId('feed-first-steps')).toBeNull();
    fireEvent.press(getByTestId('feed-segment-communities'));
    expect(queryByTestId('feed-first-steps')).toBeNull();
  });

  it('an applicant still waiting never gets it', () => {
    mockKind = 'pending';
    const { queryByTestId } = render(<FeedScreen />);
    expect(queryByTestId('feed-first-steps')).toBeNull();
  });
});

describe('FeedScreen — community context switcher', () => {
  it('is absent on For You and Following, present only on Communities', () => {
    const { queryByTestId, getByTestId } = render(<FeedScreen />);
    expect(queryByTestId('community-switcher-btn')).toBeNull();

    fireEvent.press(getByTestId('feed-segment-following'));
    expect(queryByTestId('community-switcher-btn')).toBeNull();

    fireEvent.press(getByTestId('feed-segment-communities'));
    expect(getByTestId('community-switcher-btn')).toBeTruthy();
  });
});

describe('FeedScreen — community filter reaching ReelsFeed', () => {
  it('passes every joined community id when nothing is selected', () => {
    const { getByTestId } = render(<FeedScreen />);
    fireEvent.press(getByTestId('feed-segment-communities'));
    expect(lastReelsFeedProps().communityIds).toEqual(['c1', 'c2']);
  });

  // The selection is made AFTER the segment, because that is the only order the
  // app allows: the filter control exists on Communities and nowhere else, and
  // leaving a filterable view drops the selection with it. Seeding a selection
  // before mount would be testing a state a woman cannot reach.
  it('narrows to exactly the selected community once one is chosen', () => {
    const { getByTestId } = render(<FeedScreen />);
    fireEvent.press(getByTestId('feed-segment-communities'));
    act(() => useCommunityFilterStore.setState({ selectedCommunityId: 'c2' }));
    expect(lastReelsFeedProps().communityIds).toEqual(['c2']);
  });

  // A community she has since left cannot be the whole feed's filter — that
  // would show an empty pager with no way for her to know why.
  it('falls back to every joined id when the selection names a community she has left', () => {
    const { getByTestId } = render(<FeedScreen />);
    fireEvent.press(getByTestId('feed-segment-communities'));
    act(() => useCommunityFilterStore.setState({ selectedCommunityId: 'community-she-left' }));
    expect(lastReelsFeedProps().communityIds).toEqual(['c1', 'c2']);
  });

  it('a selection cannot survive a move off Communities', () => {
    const { getByTestId } = render(<FeedScreen />);
    fireEvent.press(getByTestId('feed-segment-communities'));
    act(() => useCommunityFilterStore.setState({ selectedCommunityId: 'c2' }));
    expect(lastReelsFeedProps().communityIds).toEqual(['c2']);

    // For You's scope never reads communityIds anyway — but a filter she can no
    // longer see is one she cannot undo, so it does not merely go unread, it
    // goes away. Coming back to Communities must start from all of them.
    fireEvent.press(getByTestId('feed-segment-foryou'));
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBeNull();

    fireEvent.press(getByTestId('feed-segment-communities'));
    expect(lastReelsFeedProps().communityIds).toEqual(['c1', 'c2']);
  });
});

describe('Feed publishes whether a community filter can do anything', () => {
  // The Roxy FAB offers "Filter this view" from every screen and cannot see
  // which segment is showing. Before this, it guessed from the pathname: being
  // on `/feed` was enough, so on For You the action rendered enabled, wrote a
  // selection, and changed nothing — `ReelsFeed`'s `announcements` scope does
  // not consult `communityIds` at all.
  it('claims the filter only on the Communities segment', () => {
    const { getByTestId } = render(<FeedScreen />);
    expect(useCommunityFilterStore.getState().filterable).toBe(false);

    fireEvent.press(getByTestId('feed-segment-communities'));
    expect(useCommunityFilterStore.getState().filterable).toBe(true);

    fireEvent.press(getByTestId('feed-segment-following'));
    expect(useCommunityFilterStore.getState().filterable).toBe(false);
  });

  it('releases the claim when the screen goes away', () => {
    // The FAB outlives this screen. Leaving `filterable` true behind would
    // re-enable the action on Discover, where it means nothing at all.
    const { getByTestId, unmount } = render(<FeedScreen />);
    fireEvent.press(getByTestId('feed-segment-communities'));
    expect(useCommunityFilterStore.getState().filterable).toBe(true);

    unmount();
    expect(useCommunityFilterStore.getState().filterable).toBe(false);
  });

  it('drops the selection with the claim, so it cannot narrow a later visit', () => {
    const { getByTestId, unmount } = render(<FeedScreen />);
    fireEvent.press(getByTestId('feed-segment-communities'));
    useCommunityFilterStore.setState({ selectedCommunityId: 'c2' });

    unmount();
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBeNull();
  });
});

describe('Question of the day reaching For You (audit #4)', () => {
  const today = dailyPromptFor();
  const answeredKey = `roxy.dailyPromptAnswered.feed-tab-tester.${today.dateKey}`;

  beforeEach(() => {
    for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  });

  it("hands For You today's question once it knows she has not answered", async () => {
    render(<FeedScreen />);
    await waitFor(() => expect(lastReelsFeedProps().dailyPrompt).toEqual(today));
  });

  it('never hands it to Following or Communities', async () => {
    const { getByTestId } = render(<FeedScreen />);
    await waitFor(() => expect(lastReelsFeedProps().dailyPrompt).toEqual(today));

    fireEvent.press(getByTestId('feed-segment-following'));
    expect(lastReelsFeedProps().dailyPrompt).toBeNull();
    fireEvent.press(getByTestId('feed-segment-communities'));
    expect(lastReelsFeedProps().dailyPrompt).toBeNull();
  });

  it('stays out once she answered today', async () => {
    mockStorage[answeredKey] = '1';
    render(<FeedScreen />);
    await act(async () => { await Promise.resolve(); });
    expect(lastReelsFeedProps().dailyPrompt).toBeNull();
  });

  it('drops the page the moment she answers from the composer', async () => {
    render(<FeedScreen />);
    await waitFor(() => expect(lastReelsFeedProps().dailyPrompt).toEqual(today));

    await act(async () => { await markDailyPromptAnswered('feed-tab-tester', today.dateKey); });
    expect(lastReelsFeedProps().dailyPrompt).toBeNull();
  });
});
