jest.mock('../../lib/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
  callEdgeFunction: jest.fn(),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('@stripe/stripe-react-native', () => ({ useStripe: jest.fn() }));

import { sanitizePaymentError } from '../../lib/stripe';

describe('sanitizePaymentError', () => {
  it('redacts client_secret from error objects', () => {
    const err = { message: 'failed', client_secret: 'pi_abc_secret_xyz' };
    const result = sanitizePaymentError(err);
    expect((result as any).client_secret).toBe('[redacted]');
    expect((result as any).message).toBe('failed');
  });

  it('returns non-objects unchanged', () => {
    expect(sanitizePaymentError('some error')).toBe('some error');
    expect(sanitizePaymentError(null)).toBe(null);
  });

  it('returns objects without client_secret unchanged', () => {
    const err = { message: 'network error' };
    expect(sanitizePaymentError(err)).toEqual({ message: 'network error' });
  });
});
