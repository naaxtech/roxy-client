import { render, waitFor, act } from '@testing-library/react-native';
import { StreakChip } from '../../components/feed/StreakChip';
import { recordDailyCheckin } from '../../lib/streaks';
import { useAuthStore } from '../../store/authStore';

jest.mock('../../lib/streaks', () => ({ recordDailyCheckin: jest.fn() }));

const checkin = recordDailyCheckin as jest.MockedFunction<typeof recordDailyCheckin>;

/** The store types this as a full supabase `User`; the chip only reads `id`. */
const signIn = (id: string) =>
  act(() => {
    useAuthStore.setState({ user: { id } as never, session: {} as never, loading: false });
  });

const signOut = () =>
  act(() => {
    useAuthStore.setState({ user: null, session: null, loading: false });
  });

beforeEach(() => {
  checkin.mockReset();
  signOut();
});

describe('StreakChip', () => {
  it('does not call the check-in RPC before there is a signed-in user', () => {
    // The bug: the chip fired `record_daily_checkin` on mount with no
    // dependency on auth, so on a cold start it raced the session. It lost
    // often enough to be seen — the RPC answered
    // `P0001 not authenticated`, `recordDailyCheckin` swallowed it to `null`,
    // and the chip hid itself. A streak that disappears at random is
    // indistinguishable from a streak that was lost.
    render(<StreakChip onPress={() => undefined} />);
    expect(checkin).not.toHaveBeenCalled();
  });

  it('calls it once the user arrives', async () => {
    checkin.mockResolvedValue(4);
    const view = render(<StreakChip onPress={() => undefined} />);

    signIn('u1');
    view.rerender(<StreakChip onPress={() => undefined} />);

    await waitFor(() => expect(checkin).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.getByTestId('feed-streak-chip')).toBeTruthy());
  });

  it('does not check in twice for the same user across a re-render', async () => {
    checkin.mockResolvedValue(2);
    signIn('u1');
    const view = render(<StreakChip onPress={() => undefined} />);
    await waitFor(() => expect(checkin).toHaveBeenCalledTimes(1));

    view.rerender(<StreakChip onPress={() => undefined} />);
    await waitFor(() => expect(checkin).toHaveBeenCalledTimes(1));
  });

  it('stays hidden when the streak is unknown', async () => {
    // `null` is "we could not find out", not "zero days". Rendering a 0 would
    // be the chip claiming a fact it does not have.
    checkin.mockResolvedValue(null);
    signIn('u1');
    const view = render(<StreakChip onPress={() => undefined} />);

    await waitFor(() => expect(checkin).toHaveBeenCalled());
    expect(view.queryByTestId('feed-streak-chip')).toBeNull();
  });

  it('stays hidden when the streak is zero', async () => {
    // There was a test here that mocked a REJECTION. `recordDailyCheckin` logs
    // and resolves `null` for every failure and cannot reject — see
    // `__tests__/lib/streaks.test.ts` — so it asserted a path production has no
    // way to take, against a `.catch` in this component that nothing could
    // enter. Both are gone. What is worth pinning is the boundary: a real zero.
    checkin.mockResolvedValue(0);
    signIn('u1');
    const view = render(<StreakChip onPress={() => undefined} />);

    await waitFor(() => expect(checkin).toHaveBeenCalled());
    expect(view.queryByTestId('feed-streak-chip')).toBeNull();
  });

  it('drops a stale count when the signed-in user changes', async () => {
    checkin.mockResolvedValue(9);
    signIn('u1');
    const view = render(<StreakChip onPress={() => undefined} />);
    await waitFor(() => expect(view.getByTestId('feed-streak-chip')).toBeTruthy());

    // Her streak must not be shown to whoever signs in next.
    checkin.mockImplementation(() => new Promise(() => undefined));
    signIn('u2');
    view.rerender(<StreakChip onPress={() => undefined} />);

    expect(view.queryByTestId('feed-streak-chip')).toBeNull();
  });
});
