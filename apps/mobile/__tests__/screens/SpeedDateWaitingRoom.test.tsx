import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

let mockSearchParams: Record<string, string> = {};
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}));

const mockConfirmAction = jest.fn();
jest.mock('../../lib/confirm', () => ({
  confirmAction: (...args: any[]) => mockConfirmAction(...args),
  showAlert: jest.fn(),
}));

const mockRpc = jest.fn();
const mockSingle = jest.fn();
const mockUpdate = jest.fn();
const mockCallEdgeFunction = jest.fn();
const mockChannel = { on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() };
const mockRemoveChannel = jest.fn();

jest.mock('../../lib/supabase', () => ({
  callEdgeFunction: (...args: any[]) => mockCallEdgeFunction(...args),
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    channel: jest.fn(() => mockChannel),
    removeChannel: (...args: any[]) => mockRemoveChannel(...args),
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single: (...a: any[]) => mockSingle(...a) })),
      })),
      update: (...a: any[]) => {
        mockUpdate(...a);
        return { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
      },
    })),
  },
}));

import SpeedDateWaitingRoom from '../../app/speed-dating/waiting-room';

/** The heartbeat RPC's shape: a set-returning function, so an array. */
const heartbeat = (session_status: string, room_url: string | null = null) =>
  Promise.resolve({ data: [{ session_status, room_url }], error: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockChannel.on.mockReturnThis();
  mockChannel.subscribe.mockReturnThis();
  mockSingle.mockResolvedValue({ data: { status: 'scheduled', daily_room_url: null }, error: null });
  mockRpc.mockImplementation((fn: string) =>
    fn === 'speed_date_queue_heartbeat'
      ? heartbeat('scheduled')
      : Promise.resolve({ data: true, error: null }),
  );
  mockCallEdgeFunction.mockResolvedValue({
    data: { session_id: 'sess-1', status: 'waiting', room_url: null, participant_count: 1 },
    error: null,
  });
  mockConfirmAction.mockResolvedValue(true);
  mockSearchParams = { session_id: 'sess-1' };
});

describe('SpeedDateWaitingRoom — queue integrity', () => {
  it('retires the session through leave_speed_date_queue when the user leaves the queue', async () => {
    // Regression: the old handler read participant_ids, filtered itself out and
    // wrote the remainder back, leaving a permanent status='scheduled' row with
    // an empty participant list. Those rows accumulated at the front of the
    // matchmaking scan until nobody could be paired at all.
    const { getByText } = render(<SpeedDateWaitingRoom />);

    await act(async () => {
      fireEvent.press(getByText('Leave Queue'));
    });

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('leave_speed_date_queue', {
        p_session_id: 'sess-1',
      }),
    );
    // and never by hand-editing participant_ids
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('subscribes filtered to its own session row, never table-wide', () => {
    const { supabase } = jest.requireMock('../../lib/supabase');
    render(<SpeedDateWaitingRoom />);

    expect(supabase.channel).toHaveBeenCalledWith('waiting-room-sess-1');
    expect(mockChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        table: 'speed_date_sessions',
        filter: 'id=eq.sess-1',
      }),
      expect.any(Function),
    );
  });

  it('gives up with a no-one-around state instead of spinning forever', async () => {
    jest.useFakeTimers();
    try {
      const { findByText, queryByText } = render(<SpeedDateWaitingRoom />);

      expect(queryByText(/No one's free right now/i)).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(91_000);
      });

      expect(await findByText(/No one's free right now/i)).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('heartbeats its queue row instead of only reading it', async () => {
    // The server can only distinguish a waiting user from an abandoned row by
    // being told. Without this beat, expire_stale_speed_date_sessions retires
    // the row out from under a user who is still on this screen — and does it
    // on somebody else's join, so neither of them can ever pair.
    jest.useFakeTimers();
    try {
      render(<SpeedDateWaitingRoom />);

      await act(async () => {
        jest.advanceTimersByTime(3_100);
      });

      expect(mockRpc).toHaveBeenCalledWith('speed_date_queue_heartbeat', {
        p_session_id: 'sess-1',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejoins the queue when the server reports its place is gone', async () => {
    // 'completed' is invisible to the 004 read policy, so a plain SELECT poll
    // just 404s here and the screen went on promising that the call would start
    // automatically. It never would: the row was retired.
    mockRpc.mockImplementation((fn: string) =>
      fn === 'speed_date_queue_heartbeat'
        ? heartbeat('completed')
        : Promise.resolve({ data: true, error: null }),
    );
    mockCallEdgeFunction.mockResolvedValue({
      data: { session_id: 'sess-2', status: 'waiting', room_url: null, participant_count: 1 },
      error: null,
    });

    jest.useFakeTimers();
    try {
      render(<SpeedDateWaitingRoom />);

      await act(async () => {
        jest.advanceTimersByTime(3_100);
      });

      expect(mockCallEdgeFunction).toHaveBeenCalledWith('join-speed-date-session', {});
      // and re-points the screen at the new row, or the subscription and the
      // heartbeat keep talking about a session that no longer concerns us.
      expect(mockReplace).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: '/speed-dating/waiting-room',
          params: expect.objectContaining({ session_id: 'sess-2' }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('"Keep waiting" actually rejoins the queue rather than only resetting the countdown', async () => {
    // It used to increment a local counter and nothing else — no server call at
    // all — so the deadline reset while the row it was waiting on could already
    // be gone.
    jest.useFakeTimers();
    try {
      const { getByText } = render(<SpeedDateWaitingRoom />);

      await act(async () => {
        jest.advanceTimersByTime(91_000);
      });

      await act(async () => {
        fireEvent.press(getByText('Keep waiting'));
      });

      expect(mockCallEdgeFunction).toHaveBeenCalledWith('join-speed-date-session', {});
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejoins into the same community pool it was queued in', async () => {
    mockSearchParams = { session_id: 'sess-1', communityId: 'comm-7', communityName: 'Manila WLW' };
    mockRpc.mockImplementation((fn: string) =>
      fn === 'speed_date_queue_heartbeat'
        ? heartbeat('completed')
        : Promise.resolve({ data: true, error: null }),
    );

    jest.useFakeTimers();
    try {
      render(<SpeedDateWaitingRoom />);

      await act(async () => {
        jest.advanceTimersByTime(3_100);
      });

      expect(mockCallEdgeFunction).toHaveBeenCalledWith('join-speed-date-session', {
        community_id: 'comm-7',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
