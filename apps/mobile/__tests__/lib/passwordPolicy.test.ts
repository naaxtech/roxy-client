import { MIN_PASSWORD_LENGTH, passwordTooShortMessage } from '../../lib/passwordPolicy';
import { MIN_PASSWORD } from '../../app/(auth)/welcome';

/**
 * One password rule for sign-up and for a reset (gate wave 3): a reset used
 * to accept 6 characters while sign-up asked for 10, so the weakest rule won.
 */
describe('password policy', () => {
  it('is at least 10 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });

  it('sign-up uses the same minimum', () => {
    expect(MIN_PASSWORD).toBe(MIN_PASSWORD_LENGTH);
  });

  it('says what is wrong only when it is too short', () => {
    expect(passwordTooShortMessage('123456789')).toBe('Use at least 10 characters.');
    expect(passwordTooShortMessage('1234567890')).toBeNull();
    expect(passwordTooShortMessage('')).toBe('Use at least 10 characters.');
  });
});
