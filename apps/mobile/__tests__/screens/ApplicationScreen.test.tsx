import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';

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

// The screen reads the store without a selector; tests mutate this object.
const mockState: Record<string, unknown> = {};
jest.mock('../../store/gateStore', () => {
  const actual = jest.requireActual('../../store/gateStore');
  return {
    ...actual,
    useGateStore: (sel?: (s: Record<string, unknown>) => unknown) =>
      typeof sel === 'function' ? sel(mockState) : mockState,
  };
});

import ApplicationScreen from '../../app/(auth)/application';
import type { Criterion, ApplicationState } from '../../store/gateStore';

const APP: ApplicationState = {
  id: 'app-1',
  status: 'pending',
  submitted_at: '2026-10-01T09:00:00Z',
  ready_at: null,
  decided_at: null,
  rejected_until: null,
  community_id: 'c1',
};

const JOIN: Criterion = {
  id: 'crit-join', key: 'join_reason', kind: 'question', label: 'Why Roxy?',
  description: null, prompt: 'Tell us why.', points: 2, is_required: true,
  sort_order: 1, community_id: null,
};
const LEGAL: Criterion = {
  id: 'crit-legal', key: 'legal_name', kind: 'attribute', label: 'Real legal name',
  description: null, prompt: null, points: 3, is_required: false,
  sort_order: 2, community_id: null,
};

function setState(over: Record<string, unknown> = {}) {
  for (const k of Object.keys(mockState)) delete mockState[k];
  Object.assign(mockState, {
    application: APP,
    criteria: [JOIN, LEGAL],
    metCriterionIds: new Set<string>(['crit-join']),
    score: 2,
    loadingApplication: false,
    loadError: null,
    submitting: false,
    loadApplication: jest.fn().mockResolvedValue(undefined),
    saveAnswer: jest.fn().mockResolvedValue(true),
    saveLegalName: jest.fn().mockResolvedValue('saved'),
    startVerification: jest.fn(),
    grantVerificationConsent: jest.fn(),
    submitForReview: jest.fn().mockResolvedValue({ ok: true }),
    ...over,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setState();
});

describe('ApplicationScreen — Send for review (G-14)', () => {
  it('calls submitForReview, not a bare navigation', async () => {
    const { getByRole } = render(<ApplicationScreen />);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send application for review' }));
    });
    expect(mockState.submitForReview).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows the sent state with honest timing copy once the server accepts it', async () => {
    const { getByRole, findByTestId, getByText } = render(<ApplicationScreen />);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send application for review' }));
    });
    expect(await findByTestId('application-sent')).toBeTruthy();
    expect(getByText(/Usually within 48 hours\. We'll email you and send a push\./)).toBeTruthy();
  });

  it('shows the sent state on open when the application is already ready', () => {
    setState({ application: { ...APP, ready_at: '2026-10-02T10:00:00Z' } });
    const { getByTestId, queryByRole } = render(<ApplicationScreen />);
    expect(getByTestId('application-sent')).toBeTruthy();
    expect(queryByRole('button', { name: 'Send application for review' })).toBeNull();
  });

  it('says why the server refused, and stays on the form', async () => {
    (mockState.submitForReview as jest.Mock).mockResolvedValue({
      ok: false, reason: 'join_reason_too_short',
    });
    const { getByRole, findByTestId, queryByTestId } = render(<ApplicationScreen />);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send application for review' }));
    });
    const err = await findByTestId('submit-error');
    expect(err.props.children).toMatch(/at least 40 characters/);
    expect(queryByTestId('application-sent')).toBeNull();
  });

  it('a dropped connection is not blamed on her answers', async () => {
    (mockState.submitForReview as jest.Mock).mockResolvedValue({ ok: false, reason: 'unavailable' });
    const { getByRole, findByTestId } = render(<ApplicationScreen />);
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send application for review' }));
    });
    expect((await findByTestId('submit-error')).props.children).toMatch(/couldn't reach Roxy/i);
  });

  it('is disabled for screen readers until the required answers are in', () => {
    setState({ metCriterionIds: new Set<string>() });
    const { getByRole } = render(<ApplicationScreen />);
    const btn = getByRole('button', { name: 'Send application for review' });
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it('is busy (not pressable twice) while sending', () => {
    setState({ submitting: true });
    const { getByRole } = render(<ApplicationScreen />);
    const btn = getByRole('button', { name: 'Send application for review' });
    expect(btn.props.accessibilityState?.busy).toBe(true);
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });
});

describe('ApplicationScreen — legal name is correctable (130 RPC)', () => {
  it('a stored name shows Added with a Change action, no session-only "being added" state', () => {
    setState({ metCriterionIds: new Set<string>(['crit-join', 'crit-legal']) });
    const { getByRole, queryByText } = render(<ApplicationScreen />);
    expect(getByRole('button', { name: 'Change Real legal name' })).toBeTruthy();
    expect(queryByText(/being added to your score/)).toBeNull();
  });

  it('Change reopens the field and a save goes through saveLegalName again', async () => {
    setState({ metCriterionIds: new Set<string>(['crit-join', 'crit-legal']) });
    const { getByRole, getByLabelText } = render(<ApplicationScreen />);
    fireEvent.press(getByRole('button', { name: 'Change Real legal name' }));
    fireEvent.changeText(getByLabelText('Real legal name'), 'Jo Nicole Example');
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Save Real legal name' }));
    });
    expect(mockState.saveLegalName).toHaveBeenCalledWith('Jo Nicole Example');
  });

  it('after a save the field is not left in a fake pending state', async () => {
    const { getByRole, getByLabelText, queryByText } = render(<ApplicationScreen />);
    fireEvent.changeText(getByLabelText('Real legal name'), 'Jo Nicole Example');
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Save Real legal name' }));
    });
    await waitFor(() => expect(mockState.saveLegalName).toHaveBeenCalled());
    expect(queryByText(/being added to your score/)).toBeNull();
  });
});

describe('ApplicationScreen — copy and tokens (G-19)', () => {
  it('no longer tells her nothing is required next to REQUIRED badges', () => {
    const { queryByText } = render(<ApplicationScreen />);
    expect(queryByText(/None of this is required/)).toBeNull();
  });

  it('no gamified score card', () => {
    const { queryByText } = render(<ApplicationScreen />);
    expect(queryByText('YOUR SCORE')).toBeNull();
  });

  it('counts down to the join reason minimum while she types', () => {
    setState({ metCriterionIds: new Set<string>() });
    const { getByLabelText, getByText } = render(<ApplicationScreen />);
    fireEvent.changeText(getByLabelText('Why Roxy?'), 'Because I love it');
    expect(getByText(/23 more characters/)).toBeTruthy();
  });
});
