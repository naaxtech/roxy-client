import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
}));
jest.mock('../../lib/confirm', () => ({ showAlert: jest.fn() }));
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ signOut: jest.fn() }) }));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({ isPreviewing: false, kind: 'pending' }),
}));
jest.mock('../../store/viewAsStore', () => ({
  useViewAsStore: (sel: (s: { setPreview: jest.Mock }) => unknown) => sel({ setPreview: jest.fn() }),
}));

// Capture what the screen hands the sync hook.
const mockSyncCalls: { onDecision?: (p: string | null, n: string) => void; options?: unknown }[] = [];
const mockRefresh = jest.fn().mockResolvedValue(undefined);
jest.mock('../../hooks/useVettingStatusSync', () => ({
  useVettingStatusSync: (onDecision?: (p: string | null, n: string) => void, options?: unknown) => {
    mockSyncCalls.push({ onDecision, options });
    return { refresh: mockRefresh };
  },
}));

const mockState: Record<string, unknown> = {};
jest.mock('../../store/gateStore', () => {
  const actual = jest.requireActual('../../store/gateStore');
  return {
    ...actual,
    useGateStore: (sel?: (s: Record<string, unknown>) => unknown) =>
      typeof sel === 'function' ? sel(mockState) : mockState,
  };
});

import PendingScreen from '../../app/(auth)/pending';
import type { ApplicationState } from '../../store/gateStore';

const PENDING: ApplicationState = {
  id: 'app-1',
  status: 'pending',
  submitted_at: '2026-10-01T09:00:00Z',
  ready_at: '2026-10-01T09:30:00Z',
  decided_at: null,
  rejected_until: null,
  community_id: 'c1',
};

function setState(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockState)) delete mockState[k];
  Object.assign(mockState, {
    application: PENDING,
    loadingApplication: false,
    loadError: null,
    appeal: null,
    loadApplication: jest.fn().mockResolvedValue(undefined),
    requestAppeal: jest.fn().mockResolvedValue(true),
    ...over,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSyncCalls.length = 0;
  setState();
});

describe('PendingScreen — live status (G-11)', () => {
  it('mounts the vetting sync while she waits', () => {
    render(<PendingScreen />);
    expect(mockSyncCalls.length).toBeGreaterThan(0);
    expect(typeof mockSyncCalls[0].onDecision).toBe('function');
  });

  it('an approval while the screen is open takes her into the app', async () => {
    render(<PendingScreen />);
    await act(async () => { mockSyncCalls[mockSyncCalls.length - 1].onDecision?.('pending', 'approved'); });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/feed');
  });

  it('a rejection while the screen is open reloads the application so the reason shows', async () => {
    render(<PendingScreen />);
    await act(async () => { mockSyncCalls[mockSyncCalls.length - 1].onDecision?.('pending', 'rejected'); });
    expect(mockState.loadApplication).toHaveBeenCalledTimes(2);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('Refresh status re-reads the profile too, not only the application', async () => {
    const { getByRole } = render(<PendingScreen />);
    await act(async () => { fireEvent.press(getByRole('button', { name: 'Refresh status' })); });
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockState.loadApplication).toHaveBeenCalledTimes(2);
  });
});
