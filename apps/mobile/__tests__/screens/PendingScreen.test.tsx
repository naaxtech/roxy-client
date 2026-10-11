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
    loadAppeal: jest.fn().mockResolvedValue(undefined),
    requestAppeal: jest.fn().mockResolvedValue('sent'),
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

/** G-12: rejected — the reason, the date, one appeal, and a way back in. */
describe('PendingScreen — rejected (130: decision_reason, rejected_until, appeals)', () => {
  const FUTURE = '2099-01-15T00:00:00Z';
  const PAST = '2020-01-15T00:00:00Z';
  const rejected = (over: Partial<ApplicationState> = {}): ApplicationState => ({
    ...PENDING,
    status: 'rejected',
    decided_at: '2026-10-05T10:00:00Z',
    rejected_until: FUTURE,
    decision_reason: 'not_known',
    ...over,
  });

  it("shows the reviewer's reason category in words, never a raw key", () => {
    setState({ application: rejected() });
    const { getByTestId } = render(<PendingScreen />);
    expect(getByTestId('rejection-reason').props.children).toBe(
      "The community that invited you didn't feel they knew you well enough yet.",
    );
  });

  it('with no category it still says a person decided, without inventing a reason', () => {
    setState({ application: rejected({ decision_reason: null }) });
    const { queryByTestId } = render(<PendingScreen />);
    expect(queryByTestId('rejection-reason')).toBeNull();
  });

  it('shows the cooldown date and no new-code button before it', () => {
    setState({ application: rejected() });
    const { getByText, queryByRole } = render(<PendingScreen />);
    expect(getByText(/15 January 2099/)).toBeTruthy();
    expect(queryByRole('button', { name: 'Enter a new code' })).toBeNull();
  });

  it('after the cooldown she can enter a new code, signed in', () => {
    setState({ application: rejected({ rejected_until: PAST }) });
    const { getByRole } = render(<PendingScreen />);
    fireEvent.press(getByRole('button', { name: 'Enter a new code' }));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/code');
  });

  it('loads her appeal so a sent appeal is not offered again', () => {
    const loadAppeal = jest.fn().mockResolvedValue(undefined);
    setState({ application: rejected(), loadAppeal });
    render(<PendingScreen />);
    expect(loadAppeal).toHaveBeenCalled();
  });

  it('sends an appeal and shows that it went to Roxy staff', async () => {
    const requestAppeal = jest.fn().mockResolvedValue('sent');
    setState({ application: rejected(), requestAppeal, loadAppeal: jest.fn() });
    const { getByLabelText, getByRole, findByTestId } = render(<PendingScreen />);
    fireEvent.changeText(getByLabelText('Your appeal'), 'My friend in the community can vouch for me');
    await act(async () => { fireEvent.press(getByRole('button', { name: 'Send appeal' })); });
    expect(requestAppeal).toHaveBeenCalledWith('My friend in the community can vouch for me');
    expect(await findByTestId('appeal-sent')).toBeTruthy();
  });

  it('a failed send is a retry, not a claim it was already sent', async () => {
    const { showAlert } = jest.requireMock('../../lib/confirm') as { showAlert: jest.Mock };
    const requestAppeal = jest.fn().mockResolvedValue('failed');
    setState({ application: rejected(), requestAppeal, loadAppeal: jest.fn() });
    const { getByLabelText, getByRole, queryByTestId } = render(<PendingScreen />);
    fireEvent.changeText(getByLabelText('Your appeal'), 'My friend in the community can vouch for me');
    await act(async () => { fireEvent.press(getByRole('button', { name: 'Send appeal' })); });
    expect(showAlert).toHaveBeenCalledWith('Could not send', expect.stringMatching(/try again/i));
    expect(queryByTestId('appeal-sent')).toBeNull();
  });

  it('an appeal under review is shown as such, with no form', () => {
    setState({
      application: rejected(),
      appeal: { requested_at: '2026-10-06T10:00:00Z', resolved_at: null, outcome: null },
      loadAppeal: jest.fn(),
    });
    const { getByTestId, queryByLabelText } = render(<PendingScreen />);
    expect(getByTestId('appeal-sent')).toBeTruthy();
    expect(queryByLabelText('Your appeal')).toBeNull();
  });

  it('an upheld appeal says the decision stands, with no form', () => {
    setState({
      application: rejected(),
      appeal: { requested_at: '2026-10-06T10:00:00Z', resolved_at: '2026-10-08T10:00:00Z', outcome: 'upheld' },
      loadAppeal: jest.fn(),
    });
    const { getByTestId, queryByLabelText } = render(<PendingScreen />);
    expect(getByTestId('appeal-upheld')).toBeTruthy();
    expect(queryByLabelText('Your appeal')).toBeNull();
  });

  it('the send button is a disabled button for screen readers until 10 characters', () => {
    setState({ application: rejected(), loadAppeal: jest.fn() });
    const { getByRole } = render(<PendingScreen />);
    expect(getByRole('button', { name: 'Send appeal' }).props.accessibilityState?.disabled).toBe(true);
  });
});
