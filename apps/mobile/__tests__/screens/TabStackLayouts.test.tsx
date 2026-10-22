/**
 * The app's stack layouts.
 *
 * The four tab layouts (app/(tabs)/<tab>/_layout.tsx) each wrap their stack in
 * TabFade with that tab's ground, so a tab switch paints the right ground in
 * frame 1 (the Feed's dark stage, the theme ground elsewhere) and only the
 * content fades (motion spec §3.1 row 4, F4).
 *
 * Every stack layout is a TransitionStack, never expo-router's bare `Stack`:
 * the explicit native motion (platform push, gestures, a fade under Reduce
 * Motion) and the web's push/pop/modal transitions live there (§3.1 row 5,
 * F3). A bare `Stack` jump-cuts on roxy.expo.app.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const mockFadeProps: { ground: string; testID?: string }[] = [];
jest.mock('../../components/motion/TabFade', () => {
  const { View } = require('react-native');
  return {
    TabFade: ({ ground, testID, children }: { ground: string; testID?: string; children: React.ReactNode }) => {
      mockFadeProps.push({ ground, testID });
      return <View testID="tab-fade-mock">{children}</View>;
    },
  };
});
/** Every TransitionStack render: its screenOptions and the screens it declares. */
const mockStacks: { screenOptions: unknown; screens: { name: string; options?: Record<string, unknown> }[] }[] = [];
jest.mock('../../components/motion/TransitionStack', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  const TransitionStack = ({ screenOptions, children }: { screenOptions?: unknown; children?: React.ReactNode }) => {
    const screens = ReactLocal.Children.toArray(children).map(
      (c: { props: { name: string; options?: Record<string, unknown> } }) => ({ name: c.props.name, options: c.props.options }),
    );
    mockStacks.push({ screenOptions, screens });
    return <View testID="tab-stack" />;
  };
  TransitionStack.Screen = function TransitionStackScreen() { return null; };
  return { TransitionStack };
});
// A bare expo-router Stack would render this instead (and fail the suite).
jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const Stack = () => <View testID="bare-stack" />;
  Stack.Screen = function BareScreen() { return null; };
  return { Stack };
});
jest.mock('../../components/features/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => children,
}));

import FeedLayout from '../../app/(tabs)/feed/_layout';
import DiscoverLayout from '../../app/(tabs)/discover/_layout';
import MessagesLayout from '../../app/(tabs)/messages/_layout';
import YouLayout from '../../app/(tabs)/you/_layout';
import AuthLayout from '../../app/(auth)/_layout';
import ArchiveLayout from '../../app/archive/_layout';
import ArchiveEntryLayout from '../../app/archive/[slug]/_layout';
import { STAGE_BG } from '../../components/feed/stageColors';
import { THEMES } from '../../lib/theme';
import { useThemeStore } from '../../store/themeStore';

beforeEach(() => {
  mockFadeProps.length = 0;
  mockStacks.length = 0;
  useThemeStore.setState({ theme: 'light' });
});

describe('stack layouts are TransitionStacks', () => {
  it.each([
    ['Feed', FeedLayout],
    ['Discover', DiscoverLayout],
    ['Messages', MessagesLayout],
    ['You', YouLayout],
    ['Auth', AuthLayout],
    ['Archive', ArchiveLayout],
    ['Archive entry', ArchiveEntryLayout],
  ] as const)('%s', (_name, Layout) => {
    const { getByTestId, queryByTestId } = render(<Layout />);
    expect(getByTestId('tab-stack')).toBeTruthy();
    expect(queryByTestId('bare-stack')).toBeNull();
  });

  it('the Archive composers stay modal routes (they rise on the web, present modally on native)', () => {
    render(<ArchiveLayout />);
    expect(mockStacks[mockStacks.length - 1].screens).toEqual(expect.arrayContaining([
      { name: 'new', options: { presentation: 'modal' } },
    ]));
    render(<ArchiveEntryLayout />);
    const entry = mockStacks[mockStacks.length - 1].screens;
    for (const name of ['review', 'edit', 'note']) {
      expect(entry).toContainEqual({ name, options: { presentation: 'modal' } });
    }
  });
});

describe('the root layout uses the TransitionStack', () => {
  // app/_layout.tsx pulls in the whole app (Stripe, PostHog, Supabase, fonts),
  // so this one is a source check: its stack must be the TransitionStack.
  it('renders <TransitionStack>, not a bare expo-router <Stack>', () => {
    const fs = require('fs');
    const path = require('path');
    const src: string = fs.readFileSync(path.join(__dirname, '../../app/_layout.tsx'), 'utf8');
    expect(src).toMatch(/<TransitionStack\b/);
    expect(src).not.toMatch(/<Stack\b/);
  });
});

describe('tab layouts fade their content over their own ground', () => {
  // The feel harness (tests/e2e/feel-transitions.spec.ts) finds each tab's
  // fade layer by name to time its ramp (F4).
  it.each([
    ['feed', FeedLayout],
    ['discover', DiscoverLayout],
    ['messages', MessagesLayout],
    ['you', YouLayout],
  ] as const)('names its fade layer tab-fade-%s', (name, Layout) => {
    render(<Layout />);
    expect(mockFadeProps[mockFadeProps.length - 1].testID).toBe(`tab-fade-${name}`);
  });

  it('Feed: the dark stage', () => {
    const { getByTestId } = render(<FeedLayout />);
    expect(getByTestId('tab-fade-mock')).toBeTruthy();
    expect(getByTestId('tab-stack')).toBeTruthy();
    expect(mockFadeProps[mockFadeProps.length - 1].ground).toBe(STAGE_BG);
  });

  it.each([
    ['Discover', DiscoverLayout],
    ['Messages', MessagesLayout],
    ['You', YouLayout],
  ] as const)('%s: the theme ground, in light and in dark', (_name, Layout) => {
    const light = render(<Layout />);
    expect(light.getByTestId('tab-stack')).toBeTruthy();
    expect(mockFadeProps[mockFadeProps.length - 1].ground).toBe(THEMES.light.ground);
    light.unmount();

    useThemeStore.setState({ theme: 'dark' });
    render(<Layout />);
    expect(mockFadeProps[mockFadeProps.length - 1].ground).toBe(THEMES.dark.ground);
  });
});
