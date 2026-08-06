import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

const mockPush = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

import { HomeCategoryPills } from '../../../components/nav/HomeCategoryPills';
import { HOME_CATEGORIES } from '../../../components/nav/navTokens';
import { TAB_MIN_TOUCH } from '../../../components/nav/navTokens';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

beforeEach(() => {
  mockPush.mockClear();
});

describe('HomeCategoryPills', () => {
  it('gives Events and Games first-class placement without spending a nav slot', () => {
    const { getByText } = render(<HomeCategoryPills />);
    expect(getByText('Events')).toBeTruthy();
    expect(getByText('Games')).toBeTruthy();
  });

  it('keeps every de-tabbed surface reachable', () => {
    const { getByText } = render(<HomeCategoryPills />);
    expect(getByText('Live')).toBeTruthy();
    expect(getByText('Build')).toBeTruthy();
  });

  it('ships no pill without a destination', () => {
    const { queryByText } = render(<HomeCategoryPills />);
    for (const absent of ['Shop', 'Marketplace', 'For You', 'Following']) {
      expect(queryByText(absent)).toBeNull();
    }
    expect(HOME_CATEGORIES.every((c) => c.href.length > 0)).toBe(true);
  });

  it('routes each pill at a path that exists today', () => {
    const { getByTestId } = render(<HomeCategoryPills />);
    const expected: Record<string, string> = {
      events: '/(tabs)/connect?tab=events',
      games: '/(tabs)/discover',
      live: '/(tabs)/connect?tab=rooms',
      build: '/(tabs)/build',
    };
    for (const [key, href] of Object.entries(expected)) {
      mockPush.mockClear();
      fireEvent.press(getByTestId(`home-pill-${key}`));
      expect(mockPush).toHaveBeenCalledWith(href);
    }
  });

  it('gives every pill a real 44pt touch target', () => {
    const { getAllByTestId } = render(<HomeCategoryPills />);
    const pills = getAllByTestId(/^home-pill-/);
    expect(pills).toHaveLength(HOME_CATEGORIES.length);
    for (const pill of pills) {
      expect(Number(flat(pill).minHeight)).toBeGreaterThanOrEqual(TAB_MIN_TOUCH);
      expect(pill.props.hitSlop).toBeUndefined();
    }
  });

  it('names each pill for a screen reader', () => {
    const { getByLabelText } = render(<HomeCategoryPills />);
    expect(getByLabelText('Events')).toBeTruthy();
    expect(getByLabelText('Games')).toBeTruthy();
  });
});
