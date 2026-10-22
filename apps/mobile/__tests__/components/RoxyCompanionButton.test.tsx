import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { render, fireEvent, act, configure } from '@testing-library/react-native';

configure({ defaultIncludeHiddenElements: true });

const mockPush = jest.fn();
const mockPathname = jest.fn(() => '/(tabs)/discover');
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-svg', () => ({
  __esModule: true, default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', Path: 'Path', G: 'G',
}));
const mockImpact = jest.fn((_style?: unknown) => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (style: unknown) => mockImpact(style),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../lib/supabase', () => ({ callEdgeFunction: jest.fn() }));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: { id: 'amara' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../store/profileStore', () => ({
  useProfileStore: (sel?: (s: unknown) => unknown) => {
    const state = { profile: { display_name: 'Amara Okafor' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));

import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';
import { useCommunityFilterStore } from '../../store/communityFilterStore';
import { useCommunityStore } from '../../store/communityStore';
import { useRoxyFab } from '../../lib/roxyFab';
import {
  FAB_LANE, FAB_MARGIN, FAB_SIZE, FAB_TUCKED, FAB_TUCKED_HIT, NAV_HEIGHT, NAV_MIN_BOTTOM,
} from '../../components/nav/navTokens';
import { THEMES } from '../../lib/theme';
import { useThemeStore } from '../../store/themeStore';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockClear();
  mockImpact.mockClear();
  mockPathname.mockReturnValue('/(tabs)/discover');
  useCommunityFilterStore.setState({ selectedCommunityId: null, filterable: false });
  useCommunityStore.setState({ joinedCommunities: [] });
  useRoxyFab.setState({ enabled: true, loadedFor: 'amara', tucked: false, anchor: 0 });
  useThemeStore.setState({ theme: 'light', choice: 'light' });
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * The Roxy AI button, v2 (design direction › The Roxy AI button; Nicole
 * 2026-10-21: the floating button STAYS and opens Roxy AI).
 *
 * v0 opened a three-pill menu (Chat with Roxy · Search Roxy · Filter this
 * view). M3 rules a FAB menu out for one job, so the button now does one thing
 * — open Roxy AI — and the other two moved, neither disappeared: search is the
 * search button on Feed and Discover, and the community filter is the
 * switcher chip on Feed › Communities. Each test that asserted the menu now
 * asserts where that job went (its v0 name is in the comment above it).
 */
describe('RoxyCompanionButton', () => {
  it('renders when visible is true (default)', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    expect(getByTestId('fab-button')).toBeTruthy();
  });

  it('renders nothing when visible is false', () => {
    const { queryByTestId } = render(<RoxyCompanionButton visible={false} />);
    expect(queryByTestId('fab-button')).toBeNull();
    expect(queryByTestId('fab-lane')).toBeNull();
  });

  it('does not call router.push when visible is false (not rendered)', () => {
    const { queryByTestId } = render(<RoxyCompanionButton visible={false} />);
    expect(queryByTestId('fab-button')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('is the Roxy O, named "Roxy AI", with a hint that says what it opens', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    const fab = getByTestId('fab-button');
    expect(fab.props.accessibilityLabel).toBe('Roxy AI');
    expect(fab.props.accessibilityHint).toBe('Opens your chat with Roxy AI');
    expect(getByTestId('fab-o-open')).toBeTruthy();
    expect(getByTestId('fab-o-ring').props.fill).toBe(THEMES.light.pink);
  });

  it('wears the brand pink ring on the dark Feed stage', () => {
    const { getByTestId } = render(<RoxyCompanionButton onStage />);
    expect(getByTestId('fab-o-ring').props.fill).toBe(THEMES.light.brandPink);
  });

  it('sits in its 88 dp lane, 16 dp from the edge and 16 dp above the bar', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    const lane = flat(getByTestId('fab-lane'));
    expect(lane.width).toBe(FAB_LANE);
    expect(lane.height).toBe(FAB_LANE);
    expect(lane.end).toBe(0);
    expect(lane.bottom).toBe(NAV_HEIGHT + NAV_MIN_BOTTOM);
    const seat = flat(getByTestId('fab-seat'));
    expect(seat.width).toBe(FAB_SIZE);
    expect(seat.end).toBe(FAB_MARGIN);
    expect(seat.bottom).toBe(FAB_MARGIN);
  });

  // v0: 'long-press navigates straight to roxy-chat, bypassing the action
  // stack'. v2 has no stack: long-press does exactly what a tap does.
  it('long-press does what a tap does: opens Hello, Roxy (no FAB menu)', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    fireEvent(getByTestId('fab-button'), 'longPress');
    expect(getByTestId('hello-roxy-sheet')).toBeTruthy();
  });

  // v0: 'tap opens the pop-out action stack instead of navigating immediately'.
  it('tap opens the Hello, Roxy sheet with a light haptic, not a menu', () => {
    const { getByTestId, queryByLabelText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(getByTestId('hello-roxy-sheet')).toBeTruthy();
    expect(queryByLabelText('Search Roxy')).toBeNull();
    expect(queryByLabelText('Filter this view')).toBeNull();
    expect(mockImpact).toHaveBeenCalledWith('light');
  });

  it('greets her by her first name', () => {
    const { getByTestId, getByText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    expect(getByText(/Amara/)).toBeTruthy();
  });

  // v0: '"Chat with Roxy" pill navigates to roxy-chat'.
  it('the sheet opens the full chat at /roxy-chat and closes behind it', () => {
    const { getByTestId, queryByTestId } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    fireEvent.press(getByTestId('hello-roxy-expand'));
    expect(mockPush).toHaveBeenCalledWith('/roxy-chat');
    expect(queryByTestId('hello-roxy-sheet')).toBeNull();
  });

  // v0: '"Search Roxy" pill pushes /search'. Search moved to the headers it
  // belongs to (design direction v2 › The Roxy AI button › Tap).
  it('search moved, it did not disappear: Feed and Discover headers push /search', () => {
    const root = path.join(__dirname, '../../app/(tabs)');
    for (const screen of ['feed/index.tsx', 'discover/index.tsx']) {
      const src = fs.readFileSync(path.join(root, screen), 'utf8');
      expect(src).toMatch(/router\.push\('\/search'/);
    }
  });

  // v0: '"Filter this view" is disabled while no surface claims the filter,
  // on any route'. Now: no route turns the button into anything but Roxy AI.
  it('has one job on every route', () => {
    for (const route of ['/(tabs)/discover', '/(tabs)/feed', '/(tabs)/you']) {
      mockPathname.mockReturnValue(route);
      const { getByTestId, queryByText, unmount } = render(<RoxyCompanionButton />);
      fireEvent.press(getByTestId('fab-button'));
      expect(getByTestId('hello-roxy-sheet')).toBeTruthy();
      expect(queryByText('Filter this view')).toBeNull();
      expect(queryByText('Works on Feed › Communities')).toBeNull();
      unmount();
    }
  });

  // v0: 'being on the Feed route is not on its own enough to make a selection'.
  it('opening Roxy AI never touches the community filter', () => {
    mockPathname.mockReturnValue('/(tabs)/feed');
    useCommunityFilterStore.setState({ filterable: true });
    const { getByTestId } = render(<RoxyCompanionButton onStage />);
    fireEvent.press(getByTestId('fab-button'));
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBeNull();
  });

  it('names no tab that has been retired', () => {
    const { getByTestId, queryByText } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    for (const dead of [/Connect/, /Build/, /Grow/, /Play/]) {
      expect(queryByText(dead)).toBeNull();
    }
  });

  // v0: '"Filter this view" expands the joined-community list on a filterable
  // view and applies a selection' and '... clear back to All Communities'.
  // That job is the Feed › Communities switcher chip now; it writes the same
  // store (CommunityContextSwitcher.test.tsx covers the list itself).
  it('the community filter moved to the Feed › Communities chip', () => {
    const feed = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/feed/index.tsx'), 'utf8');
    expect(feed).toMatch(/<CommunityContextSwitcher\b/);
    const chip = fs.readFileSync(path.join(__dirname, '../../components/CommunityContextSwitcher.tsx'), 'utf8');
    expect(chip).toMatch(/useCommunityFilterStore/);
  });

  // v0: 'scrim tap closes the sheet' (then the menu's scrim).
  it('the scrim closes the sheet', () => {
    const { getByTestId, queryByTestId } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    expect(getByTestId('hello-roxy-sheet')).toBeTruthy();
    fireEvent.press(getByTestId('hello-roxy-scrim'));
    expect(queryByTestId('hello-roxy-sheet')).toBeNull();
  });
});

describe('RoxyCompanionButton — tuck on scroll', () => {
  it('tucked: eyes closed, 40 dp, centred on the end edge', () => {
    useRoxyFab.setState({ tucked: true });
    const { getByTestId } = render(<RoxyCompanionButton />);
    expect(getByTestId('fab-o-rest')).toBeTruthy();
    const transform = flat(getByTestId('fab-tuck')).transform as Record<string, number>[];
    // Reduce Motion is on in this suite: the tuck lands at its end state.
    expect(transform).toEqual([
      { translateX: FAB_MARGIN + FAB_SIZE / 2 },
      { scale: FAB_TUCKED / FAB_SIZE },
    ]);
  });

  it('a tap on the tucked button brings her back instead of opening the sheet', () => {
    useRoxyFab.setState({ tucked: true });
    const { getByTestId, queryByTestId } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-tucked'));
    expect(useRoxyFab.getState().tucked).toBe(false);
    expect(queryByTestId('hello-roxy-sheet')).toBeNull();
  });

  it('the tucked target is 28 × 48 dp at the screen edge', () => {
    useRoxyFab.setState({ tucked: true });
    const { getByTestId } = render(<RoxyCompanionButton />);
    const hit = flat(getByTestId('fab-tucked'));
    expect(hit.width).toBe(FAB_TUCKED_HIT.width);
    expect(hit.height).toBe(FAB_TUCKED_HIT.height);
    expect(hit.end).toBe(0);
  });

  it('comes back when the store says so', () => {
    useRoxyFab.setState({ tucked: true });
    const { getByTestId, queryByTestId } = render(<RoxyCompanionButton />);
    act(() => { useRoxyFab.getState().untuck(); });
    expect(getByTestId('fab-o-open')).toBeTruthy();
    expect(queryByTestId('fab-tucked')).toBeNull();
  });
});
