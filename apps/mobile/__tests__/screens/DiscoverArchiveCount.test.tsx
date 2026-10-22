import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

/**
 * Jank audit #4, at the screen: Discover asked for 200 full Archive rows only to
 * say how many there are. The rail's own sample (12, top-ranked) is still
 * fetched; the total is a count.
 */
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../hooks/useThemeColors', () => ({
  useThemeColors: () => jest.requireActual('../../lib/theme').THEMES.light,
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ tier: 'beta', isBeta: true, can: () => true, canCommunity: () => true }),
}));
jest.mock('../../lib/notifications', () => ({
  fetchUnreadNotificationCount: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('../../store/authStore', () => {
  const state = { user: { id: 'u' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
jest.mock('../../store/communityStore', () => {
  const state = {
    allCommunities: [], joinedIds: new Set<string>(), requestedIds: new Set<string>(),
    hydrate: jest.fn(() => Promise.resolve()), joinCommunity: jest.fn(),
  };
  return { useCommunityStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
jest.mock('../../store/buildStore', () => {
  const state = {
    businesses: [], bookmarkedBusinessIds: new Set<string>(),
    loadBusinesses: jest.fn(() => Promise.resolve()), loadBookmarks: jest.fn(() => Promise.resolve()),
  };
  return { useBuildStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
jest.mock('../../components/discover/useDiscoverData', () => ({
  useLiveRooms: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useEvents: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useGames: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useImpact: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
  useSupport: () => ({ rows: [], status: 'ready', reload: jest.fn() }),
}));
jest.mock('../../components/grow/QuestionOfTheDayCard', () => ({ QuestionOfTheDayCard: () => null }));
jest.mock('../../lib/topMembers', () => ({
  ...jest.requireActual('../../lib/topMembers'),
  fetchTopMembers: jest.fn(() => Promise.resolve([])),
}));

const mockEntry = (i: number) => ({
  id: `e${i}`, slug: `entry-${i}`, title: `Entry ${i}`, media_type: 'film', release_year: 2019,
  creator: null, length_label: null, summary: null, cover_url: null, cover_gradient: null,
  vote_count: 10, up_count: 9, review_count: 0, has_score: true, published_at: '2026-08-01T00:00:00Z',
});
jest.mock('../../lib/archive', () => ({
  ...jest.requireActual('../../lib/archive'),
  fetchArchiveEntries: jest.fn((opts: { limit?: number }) =>
    Promise.resolve(Array.from({ length: Math.min(opts?.limit ?? 50, 12) }, (_, i) => mockEntry(i)))),
}));
jest.mock('../../components/archive/archiveCount', () => ({
  fetchArchiveTotal: jest.fn(() => Promise.resolve(214)),
}));

import DiscoverScreen from '../../app/(tabs)/discover/index';

describe('Discover — the Archive total', () => {
  it('counts the catalogue instead of downloading 200 rows to measure it', async () => {
    const { fetchArchiveEntries } = jest.requireMock('../../lib/archive') as { fetchArchiveEntries: jest.Mock };
    const { fetchArchiveTotal } = jest.requireMock('../../components/archive/archiveCount') as {
      fetchArchiveTotal: jest.Mock;
    };
    const view = render(<DiscoverScreen />);

    await waitFor(() => expect(view.getByTestId('archive-rail-link').props.accessibilityLabel)
      .toBe('See all 214 Archive entries'));
    expect(fetchArchiveTotal).toHaveBeenCalledTimes(1);
    for (const [opts] of fetchArchiveEntries.mock.calls) {
      expect((opts as { limit?: number }).limit ?? 50).toBeLessThanOrEqual(12);
    }
  });
});
