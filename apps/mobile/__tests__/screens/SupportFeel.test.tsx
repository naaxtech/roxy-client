import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

/**
 * Support / roadmap screen feel (lane D): the first load is a skeleton, not a
 * spinner (F8, F11), and "Pitch an idea" opens on the shared Sheet (F5), not
 * a system slide. Read-only: every query is held open, nothing is written.
 */
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../components/donations/DonateModal', () => ({ DonateModal: () => null }));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: object) => unknown) => {
    const state = { user: { id: 'me' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../store/buildStore', () => ({
  useBuildStore: (sel?: (s: object) => unknown) => {
    const state = { loadSupports: jest.fn(), supportedIds: new Set(), toggleSupport: jest.fn() };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('../../lib/supabase', () => {
  const pending = new Promise(() => {});
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is', 'neq', 'gte', 'lte']) q[m] = () => q;
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => pending.then(res, rej);
  q.maybeSingle = () => pending;
  q.single = () => pending;
  return {
    supabase: { from: () => q, rpc: () => pending },
    callEdgeFunction: () => pending,
  };
});

import SupportScreen from '../../app/support';

it('the first load is a skeleton (F8), never a spinner (F11)', () => {
  const v = render(<SupportScreen />);
  expect(v.getByTestId('support-loading').props.accessibilityRole).toBe('progressbar');
  expect(v.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
});

it('Pitch an idea opens on the shared Sheet (F5), not a system slide', async () => {
  const v = render(<SupportScreen />);
  await act(async () => { fireEvent.press(v.getByTestId('support-tab-pitched')); });
  await act(async () => { fireEvent.press(v.getByTestId('support-pitch-open')); });
  expect(v.getByTestId('support-pitch-sheet')).toBeTruthy();
  expect(v.getByTestId('support-pitch-sheet-scrim', { includeHiddenElements: true })).toBeTruthy();
});
