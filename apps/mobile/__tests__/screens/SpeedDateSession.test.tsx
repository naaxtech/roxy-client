import { render, waitFor } from '@testing-library/react-native';

let mockSearchParams: Record<string, string> = {};
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace, back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}));

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/confirm', () => ({ confirmAction: jest.fn().mockResolvedValue(true) }));
jest.mock('../../lib/analytics', () => ({ Analytics: { speedDateJoined: jest.fn() } }));

let mockDailyAvailable = true;
jest.mock('../../lib/video', () => ({
  DailyProvider: jest.fn().mockImplementation(() => ({
    get isAvailable() { return mockDailyAvailable; },
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn(),
    renderRemoteVideo: jest.fn(() => null),
    renderLocalVideo: jest.fn(() => null),
  })),
}));

jest.mock('../../hooks/useVideoCall', () => ({
  useVideoCall: () => ({ state: 'connected', remoteParticipant: null }),
}));

const mockSingle = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single: (...a: any[]) => mockSingle(...a) })),
      })),
    })),
  },
}));

import SpeedDateSession from '../../app/(tabs)/connect/speed-dating/session';

const sessionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  community_id: null,
  scheduled_at: new Date().toISOString(),
  duration_seconds: 300,
  participant_ids: ['me', 'partner-1'],
  status: 'active',
  daily_room_url: 'https://roxy.daily.co/room',
  prompts: ['Prompt one'],
  created_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDailyAvailable = true;
  mockSearchParams = { session_id: 'sess-1', room_url: 'https://roxy.daily.co/room' };
  mockSingle.mockResolvedValue({ data: sessionRow(), error: null });
});

describe('SpeedDateSession — round timer', () => {
  it('derives remaining time from the server start instant, not from local ticks', async () => {
    // Regression: elapsed time was a setInterval tick counter started at mount.
    // RN suspends JS timers in the background, and each handset mounted at a
    // different moment, so the two sides of the same date disagreed about when
    // it ended and backgrounding stretched it indefinitely.
    // The clock is pinned for the duration of this test. It used to read the
    // real one and allow a three-second band (00:09-00:11) to absorb however
    // long render took -- which made the test a race against the machine it ran
    // on: it failed roughly two runs in three on a loaded box, for no reason
    // connected to the behaviour under test. A fixed instant makes the expected
    // value exactly one string.
    const FIXED_NOW = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

    try {
      mockSingle.mockResolvedValue({
        data: sessionRow({ started_at: new Date(FIXED_NOW - 290_000).toISOString() }),
        error: null,
      });

      const { findByText } = render(<SpeedDateSession />);

      // 300s round that started 290s ago has exactly 10s left, regardless of
      // when this client happened to mount.
      expect(await findByText('00:10')).toBeTruthy();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('starts a fresh round at the full duration', async () => {
    const { findByText } = render(<SpeedDateSession />);
    expect(await findByText(/^0[45]:\d{2}$/)).toBeTruthy();
  });
});

describe('SpeedDateSession — video availability', () => {
  it('explains itself when video is unavailable in this build instead of waiting forever', async () => {
    // Expo Go and web resolve @daily-co/react-native-daily-js to nothing, so
    // join() was skipped silently and the screen sat on "Waiting for match…"
    // with a running clock and no explanation.
    mockDailyAvailable = false;

    const { findByText } = render(<SpeedDateSession />);

    expect(await findByText(/Video isn't available/i)).toBeTruthy();
  });

  it('does not show the unavailable notice when video works', async () => {
    const { queryByText } = render(<SpeedDateSession />);
    await waitFor(() => expect(mockSingle).toHaveBeenCalled());
    expect(queryByText(/Video isn't available/i)).toBeNull();
  });
});
