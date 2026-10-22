/**
 * The sign-in screen, v2 (design direction › Onboarding): returning members
 * see "Welcome back." above the sign-in form. The e2e helpers depend on
 * `welcome-screen`, `auth-submit-btn` (aria-label "Sign In"), `email-input`
 * and `password-input`.
 */
import React from 'react';
import { Animated } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    signUp: jest.fn(), signInWithPassword: jest.fn(), resetPassword: jest.fn(),
    signInWithApple: jest.fn(), signInWithGoogle: jest.fn(),
  }),
}));
const mockGate = {
  validatedCode: null as string | null,
  validatedCommunityName: null as string | null,
  submitApplicationForCode: jest.fn(),
};
jest.mock('../../store/gateStore', () => ({ useGateStore: () => mockGate }));
jest.mock('../../components/ui/RoxyWordmark', () => ({ RoxyWordmark: () => null }));
jest.mock('../../components/auth/TurnstileWidget', () => ({ TurnstileWidget: () => null }));
jest.mock('../../lib/authProviders', () => ({ enabledOAuthProviders: () => [] }));
// F12: the Reduce Motion answer is driven per test.
let mockReduced = false;
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import WelcomeScreen from '../../app/(auth)/welcome';

beforeEach(() => {
  mockGate.validatedCode = null;
  mockGate.validatedCommunityName = null;
});

describe('welcome hero motion (F12)', () => {
  afterEach(() => { mockReduced = false; jest.restoreAllMocks(); });

  it('the hero pops in on the spatial spring token', () => {
    const spring = jest.spyOn(Animated, 'spring');
    render(<WelcomeScreen />);
    expect(spring).toHaveBeenCalledTimes(1);
    expect(spring.mock.calls[0][1]).toEqual(expect.objectContaining({ toValue: 1, stiffness: expect.any(Number), damping: expect.any(Number) }));
  });

  it('under Reduce Motion the hero is simply there: no spring starts', () => {
    mockReduced = true;
    const spring = jest.spyOn(Animated, 'spring');
    const v = render(<WelcomeScreen />);
    expect(spring).not.toHaveBeenCalled();
    expect(v.getByTestId('welcome-screen')).toBeTruthy();
  });
});

describe('welcome / sign in (v2)', () => {
  it('greets a returning member with "Welcome back." above the sign-in form', () => {
    const r = render(<WelcomeScreen />);
    expect(r.getByTestId('welcome-screen')).toBeTruthy();
    expect(r.getByTestId('welcome-back')).toHaveTextContent('Welcome back.');
    expect(r.getByTestId('auth-submit-btn').props.accessibilityLabel).toBe('Sign In');
    expect(r.getByTestId('email-input')).toBeTruthy();
    expect(r.getByTestId('password-input')).toBeTruthy();
  });

  it('does not say Welcome back to someone making her account', () => {
    mockGate.validatedCode = 'ABCDEFGH9K';
    mockGate.validatedCommunityName = 'Lagos Sapphic Readers';
    const r = render(<WelcomeScreen />);
    expect(r.queryByTestId('welcome-back')).toBeNull();
    expect(r.getByTestId('auth-submit-btn').props.accessibilityLabel).toBe('Sign Up');
  });

  it('switching to sign in brings the greeting back', () => {
    mockGate.validatedCode = 'ABCDEFGH9K';
    const r = render(<WelcomeScreen />);
    fireEvent.press(r.getByText('Already have an account? Sign in'));
    expect(r.getByTestId('welcome-back')).toBeTruthy();
  });
});
