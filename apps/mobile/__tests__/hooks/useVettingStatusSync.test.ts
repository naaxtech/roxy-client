/**
 * G-11: a waiting applicant learns her decision while the app is open.
 *
 * Pins three rules of hooks/useVettingStatusSync:
 *  - it subscribes through lib/realtimeChannel.freshChannel, so a resubscribe
 *    (remount, foreground) can never be handed a closing cached channel;
 *  - an UPDATE on her application row and the app returning to 'active' both
 *    re-read her own profile (my_profile) and put it in the profile store;
 *  - a change of vetting_status fires onDecision exactly once.
 */
import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';

const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn((_table: string) => ({ select: mockSelect }));
const mockRemoveChannel = jest.fn((_ch: unknown) => Promise.resolve('ok'));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    removeChannel: (ch: unknown) => mockRemoveChannel(ch),
  },
}));

type Handler = (payload: unknown) => void;
const mockChannels: { topic: string; on: jest.Mock; subscribe: jest.Mock; handler?: Handler; filter?: unknown }[] = [];
const mockFreshChannel = jest.fn((topic: string) => {
  const ch = {
    topic,
    handler: undefined as Handler | undefined,
    filter: undefined as unknown,
    on: jest.fn(),
    subscribe: jest.fn(),
  };
  ch.on.mockImplementation((_evt: string, filter: unknown, cb: Handler) => {
    ch.filter = filter;
    ch.handler = cb;
    return ch;
  });
  ch.subscribe.mockImplementation(() => ch);
  mockChannels.push(ch);
  return ch;
});
jest.mock('../../lib/realtimeChannel', () => ({
  freshChannel: (topic: string) => mockFreshChannel(topic),
}));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

const mockAuthState = { user: { id: 'user-1' } as { id: string } | null };
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: typeof mockAuthState) => unknown) => sel(mockAuthState),
}));

const mockSetProfile = jest.fn();
const mockProfileState: { profile: { vetting_status: string } | null; setProfile: jest.Mock } = {
  profile: { vetting_status: 'pending' },
  setProfile: mockSetProfile,
};
jest.mock('../../store/profileStore', () => {
  const useProfileStore = (sel: (s: typeof mockProfileState) => unknown) => sel(mockProfileState);
  useProfileStore.getState = () => mockProfileState;
  return { useProfileStore };
});

import { useVettingStatusSync } from '../../hooks/useVettingStatusSync';

let appStateListener: ((s: string) => void) | null = null;
const mockSubRemove = jest.fn();

const row = (vetting_status: string) => ({ data: { id: 'user-1', vetting_status }, error: null });
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  jest.clearAllMocks();
  mockChannels.length = 0;
  mockAuthState.user = { id: 'user-1' };
  mockProfileState.profile = { vetting_status: 'pending' };
  mockMaybeSingle.mockResolvedValue(row('pending'));
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, cb: (s: string) => void) => {
    appStateListener = cb;
    return { remove: mockSubRemove };
  }) as never);
});

describe('useVettingStatusSync', () => {
  it('subscribes through freshChannel to her own application row', async () => {
    renderHook(() => useVettingStatusSync());
    await flush();
    expect(mockFreshChannel).toHaveBeenCalledWith('vetting:user-1');
    expect(mockChannels[0].filter).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'membership_applications',
      filter: 'auth_user_id=eq.user-1',
    });
    expect(mockChannels[0].subscribe).toHaveBeenCalled();
  });

  it('reads her profile from my_profile on mount', async () => {
    renderHook(() => useVettingStatusSync());
    await flush();
    expect(mockFrom).toHaveBeenCalledWith('my_profile');
    expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
    expect(mockSetProfile).toHaveBeenCalledWith(expect.objectContaining({ vetting_status: 'pending' }));
  });

  it('a realtime UPDATE re-reads the profile and fires onDecision once on approval', async () => {
    jest.useFakeTimers();
    try {
      const onDecision = jest.fn();
      renderHook(() => useVettingStatusSync(onDecision));
      await flush();
      expect(onDecision).not.toHaveBeenCalled();

      mockMaybeSingle.mockResolvedValue(row('approved'));
      await act(async () => { mockChannels[0].handler?.({}); });
      await act(async () => { jest.advanceTimersByTime(500); });
      await flush();

      expect(onDecision).toHaveBeenCalledTimes(1);
      expect(onDecision).toHaveBeenCalledWith('pending', 'approved');
      expect(mockSetProfile).toHaveBeenLastCalledWith(expect.objectContaining({ vetting_status: 'approved' }));

      // A second nudge with the same status is not a second decision.
      await act(async () => { mockChannels[0].handler?.({}); });
      await act(async () => { jest.advanceTimersByTime(500); });
      await flush();
      expect(onDecision).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('enabled:false neither subscribes nor reads', async () => {
    renderHook(() => useVettingStatusSync(undefined, { enabled: false }));
    await flush();
    expect(mockFreshChannel).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('the app returning to the foreground refetches (the socket may have slept)', async () => {
    const onDecision = jest.fn();
    renderHook(() => useVettingStatusSync(onDecision));
    await flush();
    const callsBefore = mockMaybeSingle.mock.calls.length;

    mockMaybeSingle.mockResolvedValue(row('rejected'));
    await act(async () => { appStateListener?.('background'); });
    expect(mockMaybeSingle.mock.calls.length).toBe(callsBefore);

    await act(async () => { appStateListener?.('active'); });
    await flush();
    expect(mockMaybeSingle.mock.calls.length).toBe(callsBefore + 1);
    expect(onDecision).toHaveBeenCalledWith('pending', 'rejected');
  });

  it('foregrounding resubscribes on a NEW channel so a dying one is never reused', async () => {
    renderHook(() => useVettingStatusSync());
    await flush();
    expect(mockFreshChannel).toHaveBeenCalledTimes(1);

    await act(async () => { appStateListener?.('active'); });
    await flush();

    expect(mockFreshChannel).toHaveBeenCalledTimes(2);
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannels[0]);
    expect(mockChannels[1]).not.toBe(mockChannels[0]);
    expect(mockChannels[1].subscribe).toHaveBeenCalled();
  });

  it('unmount removes the channel and the AppState listener', async () => {
    const { unmount } = renderHook(() => useVettingStatusSync());
    await flush();
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannels[0]);
    expect(mockSubRemove).toHaveBeenCalled();
  });

  it('does nothing while signed out', async () => {
    mockAuthState.user = null;
    renderHook(() => useVettingStatusSync());
    await flush();
    expect(mockFreshChannel).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('a failed read is logged and never fires a decision', async () => {
    const { logError } = jest.requireMock('../../lib/errorLogger') as { logError: jest.Mock };
    const onDecision = jest.fn();
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    renderHook(() => useVettingStatusSync(onDecision));
    await flush();
    expect(logError).toHaveBeenCalled();
    expect(onDecision).not.toHaveBeenCalled();
    expect(mockSetProfile).not.toHaveBeenCalled();
  });

  it('a slow realtime burst is coalesced with fake timers: one read per tick', async () => {
    jest.useFakeTimers();
    try {
      renderHook(() => useVettingStatusSync());
      await flush();
      const before = mockMaybeSingle.mock.calls.length;
      await act(async () => {
        mockChannels[0].handler?.({});
        mockChannels[0].handler?.({});
        mockChannels[0].handler?.({});
      });
      await act(async () => { jest.advanceTimersByTime(500); });
      await flush();
      expect(mockMaybeSingle.mock.calls.length).toBe(before + 1);
    } finally {
      jest.useRealTimers();
    }
  });
});
