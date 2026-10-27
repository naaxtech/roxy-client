/**
 * The invite-code gate, v2 (design direction › Onboarding): on `ground` with
 * the wordmark and the safety sentence word for word; the code in Plex Mono in
 * one 8-radius cell per character (the active cell outlined 2 dp in `pink`);
 * Continue is the lipped primary and visibly waits until the code is complete.
 * The e2e helpers depend on `code-gate-screen` and `already-have-account`.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { THEMES, RADII } from '../../lib/theme';
import { FONTS } from '../../lib/typography';
import { INVITE_CODE_LENGTH } from '../../lib/inviteCode';
import { useThemeStore } from '../../store/themeStore';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
}));
let mockUser: { id: string } | null = null;
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser, signOut: jest.fn() }) }));

const mockValidate = jest.fn();
const mockGate = {
  validateCode: (...a: unknown[]) => mockValidate(...a),
  checking: false,
  codeError: null as string | null,
  validatedCommunityName: null as string | null,
  clearCode: jest.fn(),
  redeemError: null,
  submitApplicationForCode: jest.fn(),
};
jest.mock('../../store/gateStore', () => ({
  useGateStore: () => mockGate,
  CODE_MESSAGES: { invalid: 'That code is not one we know.', unavailable: 'We could not check it.' },
  REDEEM_MESSAGES: { unavailable: 'We could not reach Roxy just now.' },
}));
jest.mock('../../components/ui/RoxyWordmark', () => ({ RoxyWordmark: () => null }));

// Her own profile row, read before a signed-in redemption (my_profile).
type Row = { id: string; vetting_status: string | null; deleted_at: string | null } | null;
const mockOwnProfile = jest.fn<Promise<{ data: Row; error: unknown }>, []>();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => mockOwnProfile() }) }) }),
  },
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn(), logBreadcrumb: jest.fn() }));

import CodeGateScreen from '../../app/(auth)/code';

// The cells are paint for the one real input, hidden from assistive tech.
const H = { includeHiddenElements: true } as const;

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockValidate.mockReset().mockResolvedValue(true);
  mockUser = null;
  mockGate.codeError = null;
  mockGate.validatedCommunityName = null;
  mockGate.submitApplicationForCode.mockReset().mockResolvedValue('app-1');
  (mockGate.clearCode as jest.Mock).mockReset();
  mockOwnProfile.mockReset().mockResolvedValue({ data: null, error: null });
  useThemeStore.setState({ theme: 'light' });
});

describe('code gate (v2)', () => {
  it('keeps the testIDs the auth e2e helpers use', () => {
    const r = render(<CodeGateScreen />);
    expect(r.getByTestId('code-gate-screen')).toBeTruthy();
    expect(r.getByTestId('already-have-account')).toBeTruthy();
    expect(r.getByTestId('code-input')).toBeTruthy();
  });

  it('sits on ground, with the safety sentence word for word', () => {
    const r = render(<CodeGateScreen />);
    expect(flat(r.getByTestId('code-gate-screen')).backgroundColor).toBe(THEMES.light.ground);
    expect(r.getByText('Every member is invited by a community that vouches for her. That’s how we keep this place safe.')).toBeTruthy();
  });

  it('shows one mono cell per code character, radius 8', () => {
    const r = render(<CodeGateScreen />);
    for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
      const cell = flat(r.getByTestId(`code-cell-${i}`, H));
      expect(cell.borderRadius).toBe(RADII.sm);
    }
    expect(r.queryByTestId(`code-cell-${INVITE_CODE_LENGTH}`, H)).toBeNull();
    fireEvent.changeText(r.getByTestId('code-input'), 'ab12');
    expect(r.getByTestId('code-cell-0', H)).toHaveTextContent('A');
    expect(r.getByTestId('code-cell-3', H)).toHaveTextContent('2');
    expect(flat(r.getByText('A', H)).fontFamily).toBe(FONTS.mono.medium);
  });

  it('outlines the active cell 2 dp in pink while she types', () => {
    const r = render(<CodeGateScreen />);
    fireEvent(r.getByTestId('code-input'), 'focus');
    fireEvent.changeText(r.getByTestId('code-input'), 'AB');
    const active = flat(r.getByTestId('code-cell-2', H));
    expect(active.borderColor).toBe(THEMES.light.pink);
    expect(active.borderWidth).toBe(2);
    expect(flat(r.getByTestId('code-cell-1', H)).borderColor).not.toBe(THEMES.light.pink);
  });

  it('Continue waits, visibly, until the code is complete', async () => {
    const r = render(<CodeGateScreen />);
    fireEvent.changeText(r.getByTestId('code-input'), 'ABCDEFGH9');
    expect(r.getByTestId('code-submit').props.accessibilityState.disabled).toBe(true);
    await act(async () => { fireEvent.press(r.getByTestId('code-submit')); });
    expect(mockValidate).not.toHaveBeenCalled();

    fireEvent.changeText(r.getByTestId('code-input'), 'ABCDEFGH9K');
    expect(r.getByTestId('code-submit').props.accessibilityState.disabled).toBe(false);
    await act(async () => { fireEvent.press(r.getByTestId('code-submit')); });
    expect(mockValidate).toHaveBeenCalledWith('ABCDEFGH9K');
    expect(mockPush).toHaveBeenCalledWith('/(auth)/welcome');
  });

  it('folds misread letters the way the server issues codes (I/L → 1, O → 0, U → V)', () => {
    const r = render(<CodeGateScreen />);
    fireEvent.changeText(r.getByTestId('code-input'), 'iLou');
    expect(r.getByTestId('code-cell-0', H)).toHaveTextContent('1');
    expect(r.getByTestId('code-cell-1', H)).toHaveTextContent('1');
    expect(r.getByTestId('code-cell-2', H)).toHaveTextContent('0');
    expect(r.getByTestId('code-cell-3', H)).toHaveTextContent('V');
  });

  it('marks every cell when the server rejects the code, and says why', () => {
    mockGate.codeError = 'invalid';
    const r = render(<CodeGateScreen />);
    expect(flat(r.getByTestId('code-cell-0', H)).borderColor).toBe(THEMES.light.danger);
    expect(r.getByTestId('code-error')).toHaveTextContent('That code is not one we know.');
  });

  it('a signed-in applicant whose code failed is offered sign out, not the account link', () => {
    mockUser = { id: 'u1' };
    const r = render(<CodeGateScreen />);
    expect(r.getByTestId('code-sign-out')).toBeTruthy();
    expect(r.queryByTestId('already-have-account')).toBeNull();
  });
});

/**
 * Defence in depth for Bug B (848c7c75). The layout now routes a member off
 * /code, but if she is ever on it — Back, a typed URL, a slow profile fetch —
 * Continue must not call redeem_invite_code for her: on anything but an
 * approved row the server resets her to 'pending' (134_gate_followups.sql).
 */
describe('code gate, signed in — a code never downgrades a member', () => {
  const submitFullCode = async (r: ReturnType<typeof render>) => {
    fireEvent.changeText(r.getByTestId('code-input'), 'ABCDEFGH9K');
    await act(async () => { fireEvent.press(r.getByTestId('code-submit')); });
  };

  it.each(['approved', 'pending', 'unvetted'])('a %s account is sent home and nothing is redeemed', async (status) => {
    mockUser = { id: 'u1' };
    mockOwnProfile.mockResolvedValue({ data: { id: 'u1', vetting_status: status, deleted_at: null }, error: null });
    const r = render(<CodeGateScreen />);
    await submitFullCode(r);
    expect(mockGate.submitApplicationForCode).not.toHaveBeenCalled();
    expect(mockGate.clearCode).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/feed');
  });

  it('G-15 still works: no profile row, so the code opens her application', async () => {
    mockUser = { id: 'u1' };
    const r = render(<CodeGateScreen />);
    await submitFullCode(r);
    expect(mockGate.submitApplicationForCode).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/(auth)/application');
  });

  it('when her account cannot be read, nothing is redeemed and she is told to retry', async () => {
    mockUser = { id: 'u1' };
    mockOwnProfile.mockResolvedValue({ data: null, error: { message: 'network' } });
    const r = render(<CodeGateScreen />);
    await submitFullCode(r);
    expect(mockGate.submitApplicationForCode).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(r.getByTestId('code-error')).toHaveTextContent('We could not reach Roxy just now.');
  });
});
