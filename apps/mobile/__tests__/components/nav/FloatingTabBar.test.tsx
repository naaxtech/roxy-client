import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

const mockInsets = jest.fn(() => ({ top: 0, bottom: 34, left: 0, right: 0 }));
const mockReducedMotion = jest.fn(() => false);

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets(),
}));
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion(),
}));

import { FloatingTabBar } from '../../../components/nav/FloatingTabBar';
import {
  indicatorSnapsInstantly, TAB_MIN_TOUCH, NAV_HEIGHT, NAV_INDICATOR, CREATE_KEY,
} from '../../../components/nav/navTokens';
import { THEMES, contrastRatio, RADII } from '../../../lib/theme';
import { FONTS } from '../../../lib/typography';
import { useThemeStore } from '../../../store/themeStore';

type Route = { key: string; name: string };

/**
 * The navigator still registers the dissolving folders as screens — Expo Router
 * registers every directory under `(tabs)/` whether the bar draws it or not —
 * so they are present here on purpose. The bar must render four of these and
 * ignore the rest.
 */
const ROUTES: Route[] = [
  { key: 'feed-1', name: 'feed' },
  { key: 'discover-1', name: 'discover' },
  { key: 'messages-1', name: 'messages' },
  { key: 'you-1', name: 'you' },
  { key: 'grow-1', name: 'grow' },
  { key: 'connect-1', name: 'connect' },
  { key: 'build-1', name: 'build' },
];

function renderBar(overrides: {
  index?: number;
  descriptors?: Record<string, { options: { tabBarBadge?: number | string } }>;
  onTabPress?: jest.Mock;
  onCreatePress?: jest.Mock;
  createOpen?: boolean;
} = {}) {
  const onTabPress = overrides.onTabPress ?? jest.fn();
  const onCreatePress = overrides.onCreatePress ?? jest.fn();
  const descriptors =
    overrides.descriptors ??
    Object.fromEntries(ROUTES.map((r) => [r.key, { options: {} }]));
  const utils = render(
    <FloatingTabBar
      state={{ index: overrides.index ?? 1, routes: ROUTES }}
      descriptors={descriptors}
      onTabPress={onTabPress}
      onCreatePress={onCreatePress}
      createOpen={overrides.createOpen}
    />
  );
  return { ...utils, onTabPress, onCreatePress };
}

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

type HostNode = { props: Record<string, unknown>; findAll: (p: (n: HostNode) => boolean) => HostNode[] };

/** The icon's colour: the stroke of its first stroked shape. */
const iconColor = (node: unknown) =>
  (node as HostNode).findAll((n) => typeof n.props.stroke === 'string')[0]?.props.stroke;

beforeEach(() => {
  mockInsets.mockReturnValue({ top: 0, bottom: 34, left: 0, right: 0 });
  mockReducedMotion.mockReturnValue(true);
  useThemeStore.setState({ theme: 'light' });
});

describe('FloatingTabBar', () => {
  it('renders exactly five slots, in the order Feed · Discover · Create · Messages · You', () => {
    const { getAllByTestId } = renderBar();
    expect(getAllByTestId(/^nav-slot-/).map((n) => n.props.testID)).toEqual([
      'nav-slot-feed',
      'nav-slot-discover',
      'nav-slot-create',
      'nav-slot-messages',
      'nav-slot-you',
    ]);
  });

  // v2 (direction › Navigation): labels are always shown on the four routes;
  // Create is the pink key and "its 'Create' label is for screen readers".
  it('labels every route slot, and names the Create key for screen readers', () => {
    const { getByText, getByTestId } = renderBar();
    for (const label of ['Feed', 'Discover', 'Messages', 'You']) {
      expect(getByText(label)).toBeTruthy();
    }
    expect(getByTestId('nav-slot-create').props.accessibilityLabel).toBe('Create');
  });

  it('draws no slot for a route the redesign dissolved, even though it is still registered', () => {
    const { queryByText, queryByTestId } = renderBar();
    for (const gone of ['Grow', 'Home', 'Connect', 'Rooms', 'Play', 'Build', 'Inbox']) {
      expect(queryByText(gone)).toBeNull();
    }
    for (const gone of ['grow', 'connect', 'build']) {
      expect(queryByTestId(`nav-slot-${gone}`)).toBeNull();
    }
  });

  it('gives every slot a real 48 dp touch target rather than hitSlop', () => {
    const { getAllByTestId } = renderBar();
    const slots = getAllByTestId(/^nav-slot-/);
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      const style = flat(slot);
      expect(Number(style.minHeight)).toBeGreaterThanOrEqual(TAB_MIN_TOUCH);
      expect(Number(style.minWidth)).toBeGreaterThanOrEqual(TAB_MIN_TOUCH);
      expect(slot.props.hitSlop).toBeUndefined();
    }
  });

  it('routes Discover at the discover folder, whatever the folder used to mean', () => {
    const { getByTestId, onTabPress } = renderBar({ index: 0 });
    fireEvent.press(getByTestId('nav-slot-discover'));
    expect(onTabPress).toHaveBeenCalledWith({ key: 'discover-1', name: 'discover' }, false);
  });

  it('routes You at the renamed you folder', () => {
    const { getByTestId, onTabPress } = renderBar();
    fireEvent.press(getByTestId('nav-slot-you'));
    expect(onTabPress).toHaveBeenCalledWith({ key: 'you-1', name: 'you' }, false);
  });

  it('reports the focused slot so a tab press can be a no-op', () => {
    const { getByTestId, onTabPress } = renderBar({ index: 0 });
    fireEvent.press(getByTestId('nav-slot-feed'));
    expect(onTabPress).toHaveBeenCalledWith({ key: 'feed-1', name: 'feed' }, true);
  });

  it('the create slot is an action, never a navigation', () => {
    const { getByTestId, onTabPress, onCreatePress } = renderBar();
    fireEvent.press(getByTestId('nav-slot-create'));
    expect(onCreatePress).toHaveBeenCalledTimes(1);
    expect(onTabPress).not.toHaveBeenCalled();
  });

  it('announces the focused slot to a screen reader', () => {
    const { getByTestId } = renderBar({ index: 1 });
    expect(getByTestId('nav-slot-discover').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('nav-slot-feed').props.accessibilityState).toEqual({ selected: false });
  });

  it('keeps the bar fill fully opaque so it stays legible over an arbitrary photo', () => {
    const { getByTestId } = renderBar();
    const bg = String(flat(getByTestId('nav-pill')).backgroundColor);
    expect(bg).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('clears the home indicator using the live safe-area inset, not a constant', () => {
    mockInsets.mockReturnValue({ top: 0, bottom: 34, left: 0, right: 0 });
    const tall = renderBar();
    expect(flat(tall.getByTestId('nav-bar')).paddingBottom).toBe(34);
    tall.unmount();

    mockInsets.mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
    const flush = renderBar();
    const padding = Number(flat(flush.getByTestId('nav-bar')).paddingBottom);
    expect(padding).toBeGreaterThanOrEqual(12);
  });

  // v2: "unread is an 8 dp pink dot". The count is not lost: it is the dot's
  // accessibility label, so a screen reader still hears how many.
  it('renders the unread badge as an 8 dp pink dot that still announces the count', () => {
    const descriptors = Object.fromEntries(ROUTES.map((r) => [r.key, { options: {} }]));
    descriptors['messages-1'] = { options: { tabBarBadge: 7 } };
    const { getByTestId, queryByTestId } = renderBar({ descriptors });
    const dot = getByTestId('nav-badge-messages');
    expect(flat(dot).width).toBe(8);
    expect(flat(dot).height).toBe(8);
    expect(flat(dot).backgroundColor).toBe(THEMES.light.pink);
    expect(dot.props.accessibilityLabel).toBe('7 unread');
    expect(queryByTestId('nav-badge-feed')).toBeNull();
  });

  it('snaps the indicator instantly when Reduce Motion is on', () => {
    expect(indicatorSnapsInstantly(false)).toBe(false);
    expect(indicatorSnapsInstantly(true)).toBe(true);
  });
});

/** Design direction v2 › Navigation: the M3 Expressive flexible navigation bar. */
describe('FloatingTabBar — M3 flexible navigation bar (v2)', () => {
  it('is docked full width on ground with no shadow, 64 dp tall plus the inset', () => {
    const { getByTestId } = renderBar();
    const bar = flat(getByTestId('nav-bar'));
    expect(bar.backgroundColor).toBe(THEMES.light.ground);
    expect(bar.paddingHorizontal ?? 0).toBe(0);
    expect(bar.shadowOpacity ?? 0).toBe(0);
    expect(bar.elevation ?? 0).toBe(0);
    const row = flat(getByTestId('nav-pill'));
    expect(row.height).toBe(NAV_HEIGHT);
    expect(NAV_HEIGHT).toBe(64);
    expect(row.borderRadius ?? 0).toBe(0);
    expect(row.shadowOpacity ?? 0).toBe(0);
  });

  it('marks the active slot with a 56 × 32 pinkContainer pill and an onPinkContainer icon', () => {
    const { getByTestId, queryByTestId } = renderBar({ index: 1 });
    const pill = flat(getByTestId('nav-indicator-discover'));
    expect(pill.backgroundColor).toBe(THEMES.light.pinkContainer);
    expect(pill.width).toBe(NAV_INDICATOR.width);
    expect(pill.height).toBe(NAV_INDICATOR.height);
    expect(NAV_INDICATOR).toEqual({ width: 56, height: 32, from: 32 });
    expect(pill.borderRadius).toBe(RADII.pill);
    expect(iconColor(getByTestId('nav-icon-discover'))).toBe(THEMES.light.onPinkContainer);
    expect(queryByTestId('nav-indicator-you')).toBeNull();
  });

  // Regression (web export): an absolutely positioned pill paints over a
  // non-positioned sibling in CSS whatever the DOM order, which hid the active
  // icon. The icon sits in its own layer above the pill.
  it('stacks the active icon above its pill', () => {
    const { getByTestId } = renderBar({ index: 1 });
    const pillZ = Number(flat(getByTestId('nav-indicator-discover')).zIndex ?? 0);
    const iconZ = Number(flat(getByTestId('nav-icon-layer-discover')).zIndex ?? 0);
    expect(iconZ).toBeGreaterThan(pillZ);
  });

  it('labels at 12/16: active emphasized (600) in ink, inactive 500 in ink2', () => {
    const { getByText } = renderBar({ index: 1 });
    const active = flat(getByText('Discover'));
    const idle = flat(getByText('You'));
    expect(active.fontSize).toBe(12);
    expect(active.lineHeight).toBe(16);
    expect(active.color).toBe(THEMES.light.ink);
    expect(active.fontFamily).toBe(FONTS.text.semibold);
    expect(idle.color).toBe(THEMES.light.ink2);
    expect(idle.fontFamily).toBe(FONTS.text.medium);
  });

  it('takes the stage colours on the Feed: stage ground, stageRaised pill, white active, dark ink2 idle', () => {
    const { getByTestId, getByText } = renderBar({ index: 0 });
    expect(flat(getByTestId('nav-bar')).backgroundColor).toBe(THEMES.light.stage);
    expect(flat(getByTestId('nav-pill')).backgroundColor).toBe(THEMES.light.stage);
    expect(flat(getByTestId('nav-indicator-feed')).backgroundColor).toBe(THEMES.light.stageRaised);
    expect(iconColor(getByTestId('nav-icon-feed'))).toBe('#FFFFFF');
    expect(flat(getByText('Feed')).color).toBe('#FFFFFF');
    expect(flat(getByText('You')).color).toBe(THEMES.dark.ink2);
  });

  it('draws Create as a 52 × 40 pink key, radius 12, with an onPink plus', () => {
    const { getByTestId } = renderBar();
    const key = flat(getByTestId('nav-create-key'));
    expect(key.width).toBe(CREATE_KEY.width);
    expect(key.height).toBe(CREATE_KEY.height);
    expect(CREATE_KEY).toEqual({ width: 52, height: 40, radius: 12 });
    expect(key.borderRadius).toBe(RADII.press);
    expect(key.backgroundColor).toBe(THEMES.light.pink);
    expect(flat(getByTestId('nav-create-icon')).color).toBe(THEMES.light.onPink);
  });

  it('uses the dark roles in dark: pink key with the dark onPink plus, dark pinkContainer pill', () => {
    useThemeStore.setState({ theme: 'dark' });
    const { getByTestId } = renderBar({ index: 1 });
    expect(flat(getByTestId('nav-bar')).backgroundColor).toBe(THEMES.dark.ground);
    expect(flat(getByTestId('nav-create-key')).backgroundColor).toBe(THEMES.dark.pink);
    expect(flat(getByTestId('nav-create-icon')).color).toBe(THEMES.dark.onPink);
    expect(flat(getByTestId('nav-indicator-discover')).backgroundColor).toBe(THEMES.dark.pinkContainer);
  });

  it('turns the plus 45° into a close × while the Create sheet is open', () => {
    const closed = renderBar({ createOpen: false });
    const rotateOf = (node: { props: { style?: unknown } }) =>
      ((flat(node).transform ?? []) as Record<string, unknown>[]).map((t) => t.rotate).filter(Boolean);
    expect(rotateOf(closed.getByTestId('nav-create-glyph'))).toEqual(['0deg']);
    closed.unmount();
    const open = renderBar({ createOpen: true });
    expect(rotateOf(open.getByTestId('nav-create-glyph'))).toEqual(['45deg']);
    expect(open.getByTestId('nav-slot-create').props.accessibilityLabel).toBe('Close create menu');
  });

  // The direction's measured pairs for the bar, held here so the bar cannot
  // drift from them.
  it.each(['light', 'dark'] as const)('keeps its labels and marks legible (%s)', (theme) => {
    const c = THEMES[theme];
    expect(contrastRatio(c.ink, c.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.ink2, c.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onPinkContainer, c.pinkContainer)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onPink, c.pink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.pink, c.ground)).toBeGreaterThanOrEqual(3);
  });

  it('keeps its stage labels legible on the Feed', () => {
    expect(contrastRatio('#FFFFFF', THEMES.light.stageRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(THEMES.dark.ink2, THEMES.light.stage)).toBeGreaterThanOrEqual(4.5);
  });
});
