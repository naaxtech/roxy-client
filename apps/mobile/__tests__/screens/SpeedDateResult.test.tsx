import { render, waitFor } from '@testing-library/react-native';

let mockSearchParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/analytics', () => ({ Analytics: { speedDateCompleted: jest.fn() } }));

const mockRpc = jest.fn();
const mockChannel = { on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() };
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    channel: jest.fn(() => mockChannel),
    removeChannel: jest.fn(),
  },
  callEdgeFunction: jest.fn().mockResolvedValue({ data: null, error: null }),
}));

import SpeedDateResult from '../../app/speed-dating/result';

beforeEach(() => {
  jest.clearAllMocks();
  mockChannel.on.mockReturnThis();
  mockChannel.subscribe.mockReturnThis();
  mockSearchParams = { session_id: 'sess-1', liked: '1', partner_id: 'partner-1' };
});

describe('SpeedDateResult — mutual match resolution', () => {
  it('submits its own like via submit_speed_date_like RPC', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'waiting', conversation_id: null }, error: null });
    render(<SpeedDateResult />);
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('submit_speed_date_like', { p_session_id: 'sess-1', p_liked: true }),
    );
  });

  it('shows the match card when the RPC returns matched', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'matched', conversation_id: 'conv-1' }, error: null });
    const { findByText } = render(<SpeedDateResult />);
    expect(await findByText("It's a match!")).toBeTruthy();
  });

  it('shows a waiting state instead of declaring a match when only one side has liked', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'waiting', conversation_id: null }, error: null });
    const { findByText, queryByText } = render(<SpeedDateResult />);
    expect(await findByText(/Waiting to see if it's mutual/i)).toBeTruthy();
    expect(queryByText("It's a match!")).toBeNull();
  });

  it('does not show a match when the RPC reports no_match even though this user liked', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'no_match', conversation_id: null }, error: null });
    const { findByText, queryByText } = render(<SpeedDateResult />);
    expect(await findByText(/doesn't look mutual this time/i)).toBeTruthy();
    expect(queryByText("It's a match!")).toBeNull();
  });

  it('re-checks on a timer so a missed realtime insert cannot strand the waiting state', async () => {
    // The speed_date_likes subscription is only created once the RPC has
    // already answered 'waiting'. A partner decision landing inside that
    // window fires before the channel exists, and with no fallback the user
    // sat on "Waiting to see if it's mutual" forever — never learning they
    // had matched.
    jest.useFakeTimers();
    try {
      mockRpc
        .mockResolvedValueOnce({ data: { status: 'waiting', conversation_id: null }, error: null })
        .mockResolvedValue({ data: { status: 'matched', conversation_id: 'conv-9' }, error: null });

      const { findByText } = render(<SpeedDateResult />);

      // First answer parks the screen in the waiting state...
      expect(await findByText(/Waiting to see if it's mutual/i)).toBeTruthy();
      expect(mockRpc).toHaveBeenCalledTimes(1);

      // ...and the fallback re-check, not any realtime event, is what gets it
      // out again.
      // Timer is virtual, so the 5s re-check costs no real wall time.
      expect(await findByText("It's a match!", {}, { timeout: 8_000 })).toBeTruthy();
      expect(mockRpc.mock.calls.length).toBeGreaterThan(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('submits liked:false when this user did not like the partner', async () => {
    mockSearchParams = { session_id: 'sess-1', liked: '0', partner_id: 'partner-1' };
    mockRpc.mockResolvedValue({ data: { status: 'no_match', conversation_id: null }, error: null });
    render(<SpeedDateResult />);
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('submit_speed_date_like', { p_session_id: 'sess-1', p_liked: false }),
    );
  });
});
