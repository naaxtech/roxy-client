import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

const mockInsets = jest.fn(() => ({ top: 0, bottom: 34, left: 0, right: 0 }));
const mockReducedMotion = jest.fn(() => false);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets(),
}));
jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion(),
}));

import { FloatingTabBar } from '../../../components/nav/FloatingTabBar';
import {
  ACTIVE_TINT_ALPHA, indicatorFadeDuration, TAB_MIN_TOUCH,
} from '../../../components/nav/navTokens';
import { THEMES, contrastRatio } from '../../../lib/theme';

type Route = { key: string; name: string };

const ROUTES: Route[] = [
  { key: 'grow-1', name: 'grow' },
  { key: 'connect-1', name: 'connect' },
  { key: 'discover-1', name: 'discover' },
  { key: 'messages-1', name: 'messages' },
  { key: 'build-1', name: 'build' },
  { key: 'profile-1', name: 'profile' },
];

function renderBar(overrides: {
  index?: number;
  descriptors?: Record<string, { options: { tabBarBadge?: number | string } }>;
  onTabPress?: jest.Mock;
  onCreatePress?: jest.Mock;
} = {}) {
  const onTabPress = overrides.onTabPress ?? jest.fn();
  const onCreatePress = overrides.onCreatePress ?? jest.fn();
  const descriptors =
    overrides.descriptors ??
    Object.fromEntries(ROUTES.map((r) => [r.key, { options: {} }]));
  const utils = render(
    <FloatingTabBar
      state={{ index: overrides.index ?? 0, routes: ROUTES }}
      descriptors={descriptors}
      onTabPress={onTabPress}
      onCreatePress={onCreatePress}
    />
  );
  return { ...utils, onTabPress, onCreatePress };
}

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

beforeEach(() => {
  mockInsets.mockReturnValue({ top: 0, bottom: 34, left: 0, right: 0 });
  mockReducedMotion.mockReturnValue(false);
});

describe('FloatingTabBar', () => {
  it('renders exactly five slots, in the order Home · Rooms · Create · Inbox · You', () => {
    const { getAllByTestId } = renderBar();
    expect(getAllByTestId(/^nav-slot-/).map((n) => n.props.testID)).toEqual([
      'nav-slot-grow',
      'nav-slot-connect',
      'nav-slot-create',
      'nav-slot-messages',
      'nav-slot-profile',
    ]);
  });

  it('labels every slot — icon-only navigation fails a first-timer', () => {
    const { getByText } = renderBar();
    for (const label of ['Home', 'Rooms', 'Create', 'Inbox', 'You']) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  it('drops the old Grow · Connect · Play · Messages · Build vocabulary', () => {
    const { queryByText } = renderBar();
    for (const gone of ['Grow', 'Connect', 'Play', 'Messages', 'Build', 'Discover']) {
      expect(queryByText(gone)).toBeNull();
    }
  });

  it('gives every slot a real 44pt touch target rather than hitSlop', () => {
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

  it('routes Rooms at the existing connect route, not a renamed folder', () => {
    const { getByTestId, onTabPress } = renderBar();
    fireEvent.press(getByTestId('nav-slot-connect'));
    expect(onTabPress).toHaveBeenCalledWith({ key: 'connect-1', name: 'connect' }, false);
  });

  it('routes You at the existing profile route', () => {
    const { getByTestId, onTabPress } = renderBar();
    fireEvent.press(getByTestId('nav-slot-profile'));
    expect(onTabPress).toHaveBeenCalledWith({ key: 'profile-1', name: 'profile' }, false);
  });

  it('reports the focused slot so a tab press can be a no-op', () => {
    const { getByTestId, onTabPress } = renderBar({ index: 0 });
    fireEvent.press(getByTestId('nav-slot-grow'));
    expect(onTabPress).toHaveBeenCalledWith({ key: 'grow-1', name: 'grow' }, true);
  });

  it('the create slot is an action, never a navigation', () => {
    const { getByTestId, onTabPress, onCreatePress } = renderBar();
    fireEvent.press(getByTestId('nav-slot-create'));
    expect(onCreatePress).toHaveBeenCalledTimes(1);
    expect(onTabPress).not.toHaveBeenCalled();
  });

  it('announces the focused slot to a screen reader', () => {
    const { getByTestId } = renderBar({ index: 1 });
    expect(getByTestId('nav-slot-connect').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('nav-slot-grow').props.accessibilityState).toEqual({ selected: false });
  });

  it('keeps the pill fill fully opaque so it stays legible over an arbitrary photo', () => {
    const { getByTestId } = renderBar();
    const bg = String(flat(getByTestId('nav-pill')).backgroundColor);
    expect(bg).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  // The create plate carries WHITE, not inkOn()'s dark ink. That is a brand
  // decision made by the brand owner on 2026-08-07 after seeing dark ink on the
  // gradient plates: it read as heavy and wrong against the rest of the app.
  //
  // The cost is recorded here rather than lost. The glyph is an icon, so the bar
  // is WCAG 2.2 SC 1.4.11 non-text contrast at 3:1, not 4.5:1. White measures
  // 4.21:1 on #E81C8E and 3.56:1 on #FF2F71 — both pass 3:1 — and 2.86:1 on
  // #FF6A2E, which does not. The glyph sits centred, so it renders over the
  // middle stop rather than the orange end.
  //
  // If this needs to satisfy 3:1 at every stop, the fix is NOT dark ink: it is
  // BRAND_VEIL (rgba(26,10,46,0.42), already in feedChromeTokens), which takes
  // white on #FF6A2E to 6.38:1 while keeping the ink white.
  // src: https://www.w3.org/TR/WCAG22/#non-text-contrast · read 2026-08-06
  it('carries white ink on the create plate, per the brand decision', () => {
    const { getByTestId } = renderBar();
    expect(getByTestId('nav-create-icon').props.color).toBe('#fff');
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

  it('renders a tab badge from the navigator options', () => {
    const descriptors = Object.fromEntries(ROUTES.map((r) => [r.key, { options: {} }]));
    descriptors['messages-1'] = { options: { tabBarBadge: 7 } };
    const { getByTestId, queryByTestId } = renderBar({ descriptors });
    expect(getByTestId('nav-badge-messages')).toHaveTextContent('7');
    expect(queryByTestId('nav-badge-grow')).toBeNull();
  });

  it('drops the indicator crossfade when Reduce Motion is on', () => {
    expect(indicatorFadeDuration(false)).toBeGreaterThan(0);
    expect(indicatorFadeDuration(true)).toBe(0);
  });

  // The active tint lightens the surface toward `roxy`, which is the colour the
  // active label is painted in — so raising the tint lowers the ratio. At 1F the
  // light theme lands on 4.42:1. Composite it and hold both themes to the bar.
  it.each(['dark', 'light'] as const)(
    'keeps the active label at 4.5:1 once the indicator tint is composited (%s)',
    (theme) => {
      const { roxy, surface } = THEMES[theme];
      const alpha = parseInt(ACTIVE_TINT_ALPHA, 16) / 255;
      const channels = (hex: string) =>
        [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
      const [fr, fg, fb] = channels(roxy);
      const [br, bg, bb] = channels(surface);
      const mix = (f: number, b: number) => Math.round(b + (f - b) * alpha);
      const composited =
        '#' + [mix(fr, br), mix(fg, bg), mix(fb, bb)]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');

      expect(contrastRatio(roxy, composited)).toBeGreaterThanOrEqual(4.5);
    }
  );

  // The inactive label carries the other four fifths of the bar's copy.
  it.each(['dark', 'light'] as const)(
    'keeps the inactive label at 4.5:1 on the pill fill (%s)',
    (theme) => {
      const { textMuted, surface } = THEMES[theme];
      expect(contrastRatio(textMuted, surface)).toBeGreaterThanOrEqual(4.5);
    }
  );
});
