/**
 * The tabs shell (app/(tabs)/_layout.tsx) as the navigator sees it.
 *
 * Jank audit #3: a warm tab switch froze the old screen for 0.3-1 s. Part of
 * that was the shell: `usePathname()` and a whole-store `useAuthStore()` in
 * `TabLayout` re-rendered the navigator on every route change, and each render
 * handed it a new `screenOptions` object and a new inline `tabBar`, so the bar
 * rebuilt all five slots. Opening Create re-rendered the navigator too, because
 * `createOpen` lived in `TabLayout`.
 *
 * `Tabs` is a recorder here: every render of the navigator is one entry, so
 * "the navigator did not re-render" is a count that did not move.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

// ── expo-router: a pathname store only its subscribers hear ─────────────────
const mockPath = {
  value: '/feed',
  listeners: new Set<() => void>(),
  set(next: string) {
    this.value = next;
    this.listeners.forEach((l) => l());
  },
};
const mockTabsRenders: Record<string, unknown>[] = [];
const mockBarNavigation = {
  emit: jest.fn(() => ({ defaultPrevented: false })),
  navigate: jest.fn(),
};
const mockBarRoutes = [
  { key: 'feed-1', name: 'feed' },
  { key: 'discover-1', name: 'discover' },
  { key: 'messages-1', name: 'messages' },
  { key: 'you-1', name: 'you' },
];
jest.mock('expo-router', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const Tabs = (props: Record<string, Function>) => { // eslint-disable-line @typescript-eslint/ban-types
    mockTabsRenders.push(props);
    const tabBar = props.tabBar as Function; // eslint-disable-line @typescript-eslint/ban-types
    return ReactLocal.createElement(
      View,
      { testID: 'tabs-navigator' },
      tabBar({
        state: { index: 0, routes: mockBarRoutes },
        descriptors: Object.fromEntries(mockBarRoutes.map((r) => [r.key, { options: {} }])),
        navigation: mockBarNavigation,
      }),
    );
  };
  Tabs.Screen = function TabsScreen() { return null; };
  return {
    Tabs,
    usePathname: () =>
      ReactLocal.useSyncExternalStore(
        (l: () => void) => { mockPath.listeners.add(l); return () => mockPath.listeners.delete(l); },
        () => mockPath.value,
      ),
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path' }));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return { ...actual, __esModule: true, default: actual.default, interpolateColor: () => undefined };
});
jest.mock('../../lib/haptics', () => ({ haptic: jest.fn(), tapLight: jest.fn() }));

// ── leaves under test only by their props ───────────────────────────────────
const mockFabProps: { visible?: boolean; onStage?: boolean }[] = [];
jest.mock('../../components/ui/RoxyCompanionButton', () => ({
  RoxyCompanionButton: (p: { visible?: boolean; onStage?: boolean }) => { mockFabProps.push(p); return null; },
}));
const mockSheetProps: { visible: boolean; onClose: () => void }[] = [];
jest.mock('../../components/nav/CreateSheet', () => ({
  CreateSheet: (p: { visible: boolean; onClose: () => void }) => { mockSheetProps.push(p); return null; },
}));
jest.mock('../../components/settings/ViewAsBanner', () => ({ ViewAsBanner: () => null }));
jest.mock('../../components/account/PendingStatusHost', () => ({ PendingStatusHost: () => null }));

// ── side-effect modules ─────────────────────────────────────────────────────
jest.mock('../../lib/supabase', () => ({ supabase: { removeChannel: jest.fn() } }));
jest.mock('../../lib/realtimeChannel', () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { freshChannel: () => channel };
});
jest.mock('../../lib/push', () => ({ registerPushToken: jest.fn(), pushResponsePath: () => null }));
jest.mock('../../hooks/useLastPushResponse', () => ({ useLastPushResponse: () => null }));

// ── stores: selector hooks over plain state ─────────────────────────────────
function mockSelectorStore<T extends object>(state: T) {
  const hook = (sel?: (s: T) => unknown) => (typeof sel === 'function' ? sel(state) : state);
  hook.getState = () => state;
  return hook;
}
jest.mock('../../store/authStore', () => ({
  useAuthStore: mockSelectorStore({ user: { id: 'tab-tester' }, loading: false }),
}));
jest.mock('../../store/profileStore', () => ({
  useProfileStore: mockSelectorStore({ profile: { id: 'tab-tester', onboarding_completed: true } }),
}));
jest.mock('../../store/friendStore', () => ({ useFriendStore: mockSelectorStore({ pendingCount: 0 }) }));
jest.mock('../../store/connectStore', () => ({
  useConnectStore: mockSelectorStore({ badgeTotal: 0, refresh: jest.fn(() => Promise.resolve()) }),
}));
jest.mock('../../store/chatSettingsStore', () => ({
  useChatSettingsStore: mockSelectorStore({ load: jest.fn(() => Promise.resolve()) }),
}));
jest.mock('../../store/safetyStore', () => ({
  useSafetyStore: mockSelectorStore({
    loadBlockedUsers: jest.fn(() => Promise.resolve()),
    loadMutedUsers: jest.fn(() => Promise.resolve()),
  }),
}));
jest.mock('../../store/feedStore', () => ({
  useFeedStore: mockSelectorStore({
    loadHiddenPosts: jest.fn(() => Promise.resolve()),
    init: jest.fn(() => Promise.resolve()),
  }),
}));

let mockAccessLoading = false;
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({
    loading: mockAccessLoading,
    tier: mockAccessLoading ? 'public' : 'beta',
    kind: mockAccessLoading ? 'pending' : 'member',
    can: () => !mockAccessLoading,
  }),
}));

import TabLayout from '../../app/(tabs)/_layout';
import { tabSelection } from '../../components/motion/tabSelection';
import { useRoxyFab } from '../../lib/roxyFab';

beforeEach(() => {
  mockTabsRenders.length = 0;
  mockFabProps.length = 0;
  mockSheetProps.length = 0;
  mockAccessLoading = false;
  mockPath.value = '/feed';
  mockBarNavigation.emit.mockClear();
  mockBarNavigation.navigate.mockClear();
  // Roxy AI on, loaded for this member, so the FAB's visibility follows the route.
  useRoxyFab.setState({ enabled: true, loadedFor: 'tab-tester', tucked: false });
  // `load` reads AsyncStorage; the state above is what it would settle on.
  useRoxyFab.setState({ load: jest.fn(() => Promise.resolve()) } as never);
});

const lastFab = () => mockFabProps[mockFabProps.length - 1];
const lastSheet = () => mockSheetProps[mockSheetProps.length - 1];

describe('TabLayout — a route change re-renders the leaves, not the navigator', () => {
  it('moves the Roxy button with the route while the navigator stays put', () => {
    render(<TabLayout />);
    const navigatorRenders = mockTabsRenders.length;
    expect(lastFab()).toEqual(expect.objectContaining({ visible: true, onStage: true }));

    act(() => mockPath.set('/discover'));
    expect(lastFab()).toEqual(expect.objectContaining({ visible: true, onStage: false }));

    // Suppressed in a conversation (Wave 2 rule), still without the navigator.
    act(() => mockPath.set('/chat/abc'));
    expect(lastFab()).toEqual(expect.objectContaining({ visible: false }));

    expect(mockTabsRenders.length).toBe(navigatorRenders);
  });

  it('still brings her back out on every new screen (untuck on route)', () => {
    render(<TabLayout />);
    act(() => useRoxyFab.setState({ tucked: true }));
    act(() => mockPath.set('/you'));
    expect(useRoxyFab.getState().tucked).toBe(false);
  });

  it('hands the navigator the same screenOptions and tabBar on every render', () => {
    const { rerender } = render(<TabLayout />);
    rerender(<TabLayout />);
    const [first, second] = mockTabsRenders.slice(-2);
    expect(second.screenOptions).toBe(first.screenOptions);
    expect(second.tabBar).toBe(first.tabBar);
  });

  // TabFade starts each tab's fade from this, in the navigator's own commit
  // (the 'state' event came only after the new tab's effects).
  it('publishes the committed tab for TabFade, and clears it when the tabs go', () => {
    const { unmount } = render(<TabLayout />);
    expect(tabSelection.get()).toBe('feed-1');
    unmount();
    expect(tabSelection.get()).toBeNull();
  });
});

describe('TabLayout — Create is an action that never re-renders the navigator', () => {
  it('opens and closes the sheet, turning the key, with no navigator render', () => {
    const { getByTestId } = render(<TabLayout />);
    const navigatorRenders = mockTabsRenders.length;
    expect(lastSheet().visible).toBe(false);

    fireEvent.press(getByTestId('nav-slot-create'));
    expect(lastSheet().visible).toBe(true);
    expect(getByTestId('nav-slot-create').props.accessibilityLabel).toBe('Close create menu');

    act(() => lastSheet().onClose());
    expect(lastSheet().visible).toBe(false);
    expect(getByTestId('nav-slot-create').props.accessibilityLabel).toBe('Create');

    expect(mockTabsRenders.length).toBe(navigatorRenders);
    expect(mockBarNavigation.navigate).not.toHaveBeenCalled();
  });
});

describe('TabLayout — cold start (jank audit #6)', () => {
  it('draws the bar ground with no slots while her access is loading', () => {
    mockAccessLoading = true;
    const { getByTestId, queryAllByTestId } = render(<TabLayout />);
    expect(getByTestId('nav-bar')).toBeTruthy();
    expect(queryAllByTestId(/^nav-slot-/)).toHaveLength(0);
  });

  it('draws her full bar once access is known', () => {
    const { queryAllByTestId } = render(<TabLayout />);
    expect(queryAllByTestId(/^nav-slot-/).map((n) => n.props.testID)).toEqual([
      'nav-slot-feed', 'nav-slot-discover', 'nav-slot-create', 'nav-slot-messages', 'nav-slot-you',
    ]);
  });
});
