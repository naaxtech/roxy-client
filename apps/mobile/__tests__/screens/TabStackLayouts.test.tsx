/**
 * The four tab layouts (app/(tabs)/<tab>/_layout.tsx) each wrap their stack in
 * TabFade with that tab's ground, so a tab switch paints the right ground in
 * frame 1 (the Feed's dark stage, the theme ground elsewhere) and only the
 * content fades (motion spec §3.1 row 4, F4).
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const mockFadeProps: { ground: string }[] = [];
jest.mock('../../components/motion/TabFade', () => {
  const { View } = require('react-native');
  return {
    TabFade: ({ ground, children }: { ground: string; children: React.ReactNode }) => {
      mockFadeProps.push({ ground });
      return <View testID="tab-fade-mock">{children}</View>;
    },
  };
});
jest.mock('expo-router', () => {
  const { View } = require('react-native');
  return { Stack: () => <View testID="tab-stack" /> };
});
jest.mock('../../components/features/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => children,
}));

import FeedLayout from '../../app/(tabs)/feed/_layout';
import DiscoverLayout from '../../app/(tabs)/discover/_layout';
import MessagesLayout from '../../app/(tabs)/messages/_layout';
import YouLayout from '../../app/(tabs)/you/_layout';
import { STAGE_BG } from '../../components/feed/stageColors';
import { THEMES } from '../../lib/theme';
import { useThemeStore } from '../../store/themeStore';

beforeEach(() => {
  mockFadeProps.length = 0;
  useThemeStore.setState({ theme: 'light' });
});

describe('tab layouts fade their content over their own ground', () => {
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
