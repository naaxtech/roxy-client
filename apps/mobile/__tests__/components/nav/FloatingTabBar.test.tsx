import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';

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

/**
 * reanimated, recording: every `withSpring`/`withTiming` lands in `__calls`
 * with its target and config, `useAnimatedStyle` evaluates its worklet at
 * render, and `interpolateColor` answers with the nearest end colour. Motion
 * is asserted as "which spring, to what, with which token" — the UI thread
 * runs it, so there is no frame to sample in jest.
 */
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  const ReactLocal = require('react');
  const calls: { kind: string; toValue: unknown; config: unknown }[] = [];
  const record = (kind: string) => (toValue: unknown, config?: unknown) => {
    calls.push({ kind, toValue, config });
    return toValue;
  };
  return {
    ...actual,
    __esModule: true,
    default: actual.default,
    useSharedValue: (init: unknown) => ReactLocal.useRef({ value: init }).current,
    useAnimatedStyle: (worklet: () => unknown) => worklet(),
    withSpring: record('spring'),
    withTiming: record('timing'),
    interpolateColor: (v: number, input: number[], output: string[]) =>
      (v >= input[input.length - 1] ? output[output.length - 1] : output[0]),
    __calls: calls,
  };
});

/** NavIcon render counter: which slots a navigation actually re-rendered. */
const mockWebSpring = jest.fn();
const mockCurrentWebStyle = jest.fn((): { opacity: string; transform: string } | null => null);
jest.mock('../../../components/motion/webSpring', () => ({
  startWebSpring: (...args: unknown[]) => mockWebSpring(...args),
  currentWebStyle: (...args: unknown[]) => mockCurrentWebStyle(...(args as [])),
}));

const mockIconRenders: string[] = [];
jest.mock('../../../components/nav/NavIcons', () => {
  const actual = jest.requireActual('../../../components/nav/NavIcons');
  return {
    ...actual,
    NavIcon: (p: { testID?: string }) => {
      mockIconRenders.push(String(p.testID));
      return actual.NavIcon(p);
    },
  };
});

const { __calls: springCalls } = jest.requireMock('react-native-reanimated') as {
  __calls: { kind: string; toValue: unknown; config: unknown }[];
};

import { FloatingTabBar } from '../../../components/nav/FloatingTabBar';
import {
  indicatorSnapsInstantly, TAB_MIN_TOUCH, NAV_HEIGHT, NAV_INDICATOR, CREATE_KEY,
} from '../../../components/nav/navTokens';
import { THEMES, contrastRatio, RADII } from '../../../lib/theme';
import { FONTS } from '../../../lib/typography';
import { SPRING, springAt } from '../../../lib/motion';
import { PRESS_HEAD_START, stateLayerFor } from '../../../components/ui/PressableScale';
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
  /** The navigator committed a new tab (or the sheet flipped): same handlers, new state. */
  const rerenderAt = (index: number, createOpen = overrides.createOpen) =>
    utils.rerender(
      <FloatingTabBar
        state={{ index, routes: ROUTES }}
        descriptors={descriptors}
        onTabPress={onTabPress}
        onCreatePress={onCreatePress}
        createOpen={createOpen}
      />
    );
  return { ...utils, onTabPress, onCreatePress, rerenderAt };
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
  springCalls.length = 0;
  mockIconRenders.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

/** Run the frame + task the bar waits for before it navigates. */
function flushPaint() {
  act(() => {
    jest.runOnlyPendingTimers();
    jest.runOnlyPendingTimers();
  });
}

const springsTo = (toValue: unknown) => springCalls.filter((c) => c.kind === 'spring' && c.toValue === toValue);

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
    jest.useFakeTimers();
    const { getByTestId, onTabPress } = renderBar({ index: 0 });
    fireEvent.press(getByTestId('nav-slot-discover'));
    flushPaint();
    expect(onTabPress).toHaveBeenCalledWith({ key: 'discover-1', name: 'discover' }, false);
  });

  it('routes You at the renamed you folder', () => {
    jest.useFakeTimers();
    const { getByTestId, onTabPress } = renderBar();
    fireEvent.press(getByTestId('nav-slot-you'));
    flushPaint();
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
    // The pill's colour is its fill layer (it cross-fades on the Feed); the
    // pill itself is the 56 × 32 shape that grows.
    expect(flat(getByTestId('nav-indicator-discover-fill')).backgroundColor).toBe(THEMES.light.pinkContainer);
    expect(flat(getByTestId('nav-indicator-discover-fill')).borderRadius).toBe(RADII.pill);
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
    expect(flat(getByTestId('nav-indicator-feed-fill')).backgroundColor).toBe(THEMES.light.stageRaised);
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
    expect(flat(getByTestId('nav-indicator-discover-fill')).backgroundColor).toBe(THEMES.dark.pinkContainer);
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

/**
 * Wave 3 lane A (motion spec §3.1 row 4, budgets F1/F4/F12; jank audit #3, #7):
 * the bar's motion runs on reanimated, never as a JS-driven `width` spring, and
 * a tap paints the new selection before the navigator starts its work.
 */
describe('FloatingTabBar — motion on the UI thread (Wave 3)', () => {
  const pillScaleX = (node: { props: { style?: unknown } }) =>
    ((flat(node).transform ?? []) as Record<string, unknown>[])
      .map((t) => t.scaleX)
      .filter((v) => v !== undefined);

  it('grows the new pill 32 → 56 dp by scaleX on fastSpatial; its laid-out width never animates', () => {
    mockReducedMotion.mockReturnValue(false);
    const { getByTestId, rerenderAt } = renderBar({ index: 1 });
    springCalls.length = 0;

    rerenderAt(2);
    const pill = getByTestId('nav-indicator-messages');
    // Layout is the final 56 × 32 from frame one; only the transform moves.
    expect(flat(pill).width).toBe(NAV_INDICATOR.width);
    // One frame of the spring already in (C0's head start: an animation's
    // first step paints a frame late), carrying that frame's velocity.
    const from = NAV_INDICATOR.from / NAV_INDICATOR.width;
    const head = springAt('fastSpatial', 1000 / 60);
    expect(pillScaleX(pill)[0]).toBeCloseTo(from + (1 - from) * head.x, 6);
    expect(springsTo(1)).toContainEqual(
      expect.objectContaining({
        config: expect.objectContaining({ ...SPRING.fastSpatial, velocity: (1 - from) * head.v }),
      }),
    );
  });

  it('shows the focused pill at rest on first paint (no grow on mount)', () => {
    mockReducedMotion.mockReturnValue(false);
    const { getByTestId } = renderBar({ index: 1 });
    expect(pillScaleX(getByTestId('nav-indicator-discover'))).toEqual([1]);
    expect(springCalls).toHaveLength(0);
  });

  it('Reduce Motion: the pill is simply there, no spring starts', () => {
    mockReducedMotion.mockReturnValue(true);
    const { getByTestId, rerenderAt } = renderBar({ index: 1 });
    rerenderAt(2);
    expect(pillScaleX(getByTestId('nav-indicator-messages'))).toEqual([1]);
    expect(springCalls.filter((c) => c.kind === 'spring')).toHaveLength(0);
  });

  it('paints the pressed tab as selected before it asks the navigator to move', () => {
    jest.useFakeTimers();
    const { getByTestId, queryByTestId, onTabPress } = renderBar({ index: 1 });

    fireEvent.press(getByTestId('nav-slot-you'));
    // Same frame as the tap: the pill is on You, the navigator has not been asked.
    expect(getByTestId('nav-indicator-you')).toBeTruthy();
    expect(queryByTestId('nav-indicator-discover')).toBeNull();
    expect(onTabPress).not.toHaveBeenCalled();

    flushPaint();
    expect(onTabPress).toHaveBeenCalledTimes(1);
    expect(onTabPress).toHaveBeenCalledWith({ key: 'you-1', name: 'you' }, false);
  });

  it('falls back to the committed tab when the navigator declines the move', () => {
    jest.useFakeTimers();
    const { getByTestId, queryByTestId } = renderBar({ index: 1 });
    fireEvent.press(getByTestId('nav-slot-you'));
    flushPaint();
    // onTabPress ran but the state index never changed (tabPress was prevented).
    expect(getByTestId('nav-indicator-discover')).toBeTruthy();
    expect(queryByTestId('nav-indicator-you')).toBeNull();
  });

  it('a focused tab press goes straight through (pop to top), no deferral', () => {
    const { getByTestId, onTabPress } = renderBar({ index: 1 });
    fireEvent.press(getByTestId('nav-slot-discover'));
    expect(onTabPress).toHaveBeenCalledWith({ key: 'discover-1', name: 'discover' }, true);
  });

  it('a committed switch re-renders only the two slots whose selection changed', () => {
    const { rerenderAt } = renderBar({ index: 1 });
    mockIconRenders.length = 0;
    rerenderAt(2);
    expect([...new Set(mockIconRenders)].sort()).toEqual(['nav-icon-discover', 'nav-icon-messages']);
  });

  it('cross-fades the bar to the stage colours on the Feed with fastEffects (no overshoot)', () => {
    mockReducedMotion.mockReturnValue(false);
    const { getByTestId, rerenderAt } = renderBar({ index: 1 });
    springCalls.length = 0;
    rerenderAt(0);
    expect(springsTo(1)).toContainEqual(
      expect.objectContaining({ config: expect.objectContaining(SPRING.fastEffects) }),
    );
    rerenderAt(1);
    expect(springsTo(0)).toContainEqual(
      expect.objectContaining({ config: expect.objectContaining(SPRING.fastEffects) }),
    );
    expect(flat(getByTestId('nav-bar')).backgroundColor).toBeDefined();
  });

  it('Reduce Motion: the bar recolours at once', () => {
    mockReducedMotion.mockReturnValue(true);
    const { rerenderAt } = renderBar({ index: 1 });
    rerenderAt(0);
    expect(springCalls).toHaveLength(0);
  });

  it('turns the Create key on the spatial spring', () => {
    mockReducedMotion.mockReturnValue(false);
    const { rerenderAt } = renderBar({ createOpen: false });
    springCalls.length = 0;
    rerenderAt(1, true);
    expect(springsTo(1)).toContainEqual(
      expect.objectContaining({ config: expect.objectContaining(SPRING.spatial) }),
    );
  });

  // Lane C0's PressableScale press (F1), on the key itself — the slot stays the
  // 48 dp touch target: a one-frame head start, then fastSpatial for the scale
  // and fastEffects for the state layer, both carrying the head start's velocity.
  it('presses the Create key in like every PressableScale: head start, then fastSpatial + its state layer', () => {
    mockReducedMotion.mockReturnValue(false);
    const { getByTestId } = renderBar({ createOpen: false });
    springCalls.length = 0;
    fireEvent(getByTestId('nav-slot-create'), 'pressIn');
    expect(springsTo(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        config: expect.objectContaining({ ...SPRING.fastSpatial, velocity: PRESS_HEAD_START.spatial.v }),
      }),
      expect.objectContaining({
        config: expect.objectContaining({ ...SPRING.fastEffects, velocity: PRESS_HEAD_START.effects.v }),
      }),
    ]));
    fireEvent(getByTestId('nav-slot-create'), 'pressOut');
    expect(springsTo(0)).toEqual(expect.arrayContaining([
      expect.objectContaining({ config: expect.objectContaining(SPRING.fastSpatial) }),
      expect.objectContaining({ config: expect.objectContaining(SPRING.fastEffects) }),
    ]));
  });

  it("the Create key's state layer is the theme's pressed ink, on the key's own shape", () => {
    const { getByTestId } = renderBar();
    const layer = flat(getByTestId('nav-create-layer'));
    expect(layer.backgroundColor).toBe(stateLayerFor('light').color);
    expect(layer.borderRadius).toBe(RADII.press);
    expect(layer.opacity).toBe(0);
  });

  it('Reduce Motion: the Create key turns and presses without a spring (its state layer fades 120 ms)', () => {
    mockReducedMotion.mockReturnValue(true);
    const { getByTestId, rerenderAt } = renderBar({ createOpen: false });
    springCalls.length = 0;
    fireEvent(getByTestId('nav-slot-create'), 'pressIn');
    fireEvent(getByTestId('nav-slot-create'), 'pressOut');
    rerenderAt(1, true);
    expect(springCalls.filter((c) => c.kind === 'spring')).toHaveLength(0);
    expect(springCalls.filter((c) => c.kind === 'timing').map((c) => (c.config as { duration: number }).duration))
      .toEqual([120, 120]);
  });
});

/**
 * On the web the pill grows as a compositor animation (WAAPI, the fastSpatial
 * curve): reanimated's main-thread spring settled in 250-460 ms behind the
 * destination's render at 4x CPU (feel run, 390x844), past F4's 250 ms.
 */
describe('FloatingTabBar on the web — the pill grows on the compositor', () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    mockWebSpring.mockClear();
  });
  afterEach(() => Object.defineProperty(Platform, 'OS', { value: originalOS }));

  it('runs scaleX 32/56 → 1 with the fastSpatial curve; no main-thread spring for it', () => {
    mockReducedMotion.mockReturnValue(false);
    const { rerenderAt } = renderBar({ index: 1 });
    expect(mockWebSpring).not.toHaveBeenCalled();
    springCalls.length = 0;
    rerenderAt(2);
    expect(mockWebSpring).toHaveBeenCalledTimes(1);
    expect(mockWebSpring).toHaveBeenCalledWith(
      expect.anything(),
      [{ transform: `scaleX(${NAV_INDICATOR.from / NAV_INDICATOR.width})` }, { transform: 'scaleX(1)' }],
      SPRING.fastSpatial,
    );
    expect(springCalls.filter((c) => c.config && (c.config as { stiffness?: number }).stiffness === SPRING.fastSpatial.stiffness)).toEqual([]);
  });

  it('starts the grow one frame in (head start), so the first painted frame already moves', () => {
    mockReducedMotion.mockReturnValue(false);
    const anim = { currentTime: 0 as number | null };
    mockWebSpring.mockReturnValue(anim);
    const { rerenderAt } = renderBar({ index: 1 });
    rerenderAt(2);
    expect(anim.currentTime).toBeCloseTo(1000 / 60, 6);
    mockWebSpring.mockReturnValue(undefined);
  });

  it('Reduce Motion: no grow at all', () => {
    mockReducedMotion.mockReturnValue(true);
    const { rerenderAt } = renderBar({ index: 1 });
    rerenderAt(2);
    expect(mockWebSpring).not.toHaveBeenCalled();
  });
});

describe('FloatingTabBar on the web — the Feed\'s colours cross-fade on the compositor', () => {
  // Feel run 3074493 (4x CPU): leaving the Feed, the bar's colour spring ran on
  // the page's main thread and froze half-way — a grey bar with near-invisible
  // labels — for ~900 ms while Discover / Messages mounted, then jumped. On the
  // web the stage colours are layers whose opacity the compositor fades.
  const originalOS = Platform.OS;
  // The stage twins are hidden from assistive tech (aria-hidden) by design.
  const HIDDEN = { includeHiddenElements: true };
  const fadeCalls = () => mockWebSpring.mock.calls.filter(
    ([, keyframes]) => (keyframes as Record<string, unknown>[]).some((k) => 'opacity' in k),
  );
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web' });
    mockWebSpring.mockClear();
    mockWebSpring.mockReturnValue(undefined);
    mockCurrentWebStyle.mockReset();
    mockCurrentWebStyle.mockReturnValue(null);
  });
  afterEach(() => Object.defineProperty(Platform, 'OS', { value: originalOS }));

  it('paints the stage ground, pill and labels as layers over the theme colours', () => {
    const { getByTestId } = renderBar({ index: 0 });
    expect(flat(getByTestId('nav-bar')).backgroundColor).toBe(THEMES.light.ground);
    expect(flat(getByTestId('nav-bar-stage', HIDDEN))).toEqual(
      expect.objectContaining({ backgroundColor: THEMES.light.stage, opacity: 1 }),
    );
    expect(flat(getByTestId('nav-indicator-feed-fill')).backgroundColor).toBe(THEMES.light.pinkContainer);
    expect(flat(getByTestId('nav-indicator-feed-fill-stage', HIDDEN))).toEqual(
      expect.objectContaining({ backgroundColor: THEMES.light.stageRaised, opacity: 1 }),
    );
    expect(flat(getByTestId('nav-label-feed-stage', HIDDEN))).toEqual(expect.objectContaining({ color: '#FFFFFF', opacity: 1 }));
    expect(flat(getByTestId('nav-label-discover-stage', HIDDEN))).toEqual(
      expect.objectContaining({ color: THEMES.dark.ink2, opacity: 1 }),
    );
    expect(flat(getByTestId('nav-label-discover')).color).toBe(THEMES.light.ink2);
  });

  it('leaving the Feed fades every stage layer 1 → 0 on fastEffects; no main-thread colour spring', () => {
    mockReducedMotion.mockReturnValue(false);
    const { getByTestId, rerenderAt } = renderBar({ index: 0 });
    mockWebSpring.mockClear();
    springCalls.length = 0;

    rerenderAt(1);
    expect(flat(getByTestId('nav-bar-stage', HIDDEN)).opacity).toBe(0);
    expect(flat(getByTestId('nav-label-messages-stage', HIDDEN)).opacity).toBe(0);
    expect(flat(getByTestId('nav-indicator-discover-fill-stage', HIDDEN)).opacity).toBe(0);
    // Ground, four labels and the new pill — one compositor fade each, in step.
    expect(fadeCalls()).toHaveLength(6);
    for (const [, keyframes, token] of fadeCalls()) {
      expect(keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
      expect(token).toBe(SPRING.fastEffects);
    }
    const effects = (c: { config: unknown }) => (c.config as { stiffness?: number } | undefined)?.stiffness === SPRING.fastEffects.stiffness;
    expect(springCalls.filter(effects)).toEqual([]);
  });

  it('arriving on the Feed fades them 0 → 1; a switch between light tabs leaves them alone', () => {
    mockReducedMotion.mockReturnValue(false);
    const { rerenderAt } = renderBar({ index: 1 });
    rerenderAt(2);
    expect(fadeCalls()).toEqual([]);
    rerenderAt(0);
    expect(fadeCalls()).toHaveLength(6);
    for (const [, keyframes] of fadeCalls()) expect(keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it('turns around from what is on screen when she leaves mid-fade', () => {
    mockReducedMotion.mockReturnValue(false);
    mockWebSpring.mockReturnValue({ playState: 'running' });
    const { rerenderAt } = renderBar({ index: 1 });
    rerenderAt(0);
    mockWebSpring.mockClear();
    mockCurrentWebStyle.mockReturnValue({ opacity: '0.4', transform: 'none' });
    rerenderAt(1);
    const ground = fadeCalls()[0];
    expect(ground[1]).toEqual([{ opacity: 0.4 }, { opacity: 0 }]);
  });

  it('Reduce Motion: the colours simply switch', () => {
    mockReducedMotion.mockReturnValue(true);
    const { getByTestId, rerenderAt } = renderBar({ index: 0 });
    rerenderAt(1);
    expect(fadeCalls()).toEqual([]);
    expect(flat(getByTestId('nav-bar-stage', HIDDEN)).opacity).toBe(0);
  });
});
