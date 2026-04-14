jest.mock('../../lib/supabase', () => ({
  supabase: { channel: jest.fn(), removeChannel: jest.fn() },
  callEdgeFunction: jest.fn(),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('@stripe/stripe-react-native', () => ({ useStripe: jest.fn() }));

import { sanitizePaymentError, subscribeToTicket } from '../../lib/stripe';

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

describe('subscribeToTicket', () => {
  const { supabase } = jest.requireMock('../../lib/supabase');

  beforeEach(() => {
    jest.clearAllMocks();
    const onFn = jest.fn();
    const subscribeFn = jest.fn();
    onFn.mockReturnValue({ subscribe: subscribeFn });
    supabase.channel.mockReturnValue({ on: onFn });
  });

  it('subscribes to event_attendees postgres_changes', () => {
    const onFn = jest.fn().mockReturnValue({ subscribe: jest.fn() });
    supabase.channel.mockReturnValue({ on: onFn });

    subscribeToTicket('event-123', 'user-456', jest.fn());

    expect(supabase.channel).toHaveBeenCalledWith('ticket:event-123:user-456');
    expect(onFn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        table: 'event_attendees',
        filter: 'event_id=eq.event-123',
      }),
      expect.any(Function),
    );
  });

  it('calls onTicket when payload matches userId and has ticket_code', () => {
    let capturedHandler: (payload: any) => void = () => {};
    const onFn = jest.fn((_, __, handler) => {
      capturedHandler = handler;
      return { subscribe: jest.fn() };
    });
    supabase.channel.mockReturnValue({ on: onFn });

    const onTicket = jest.fn();
    subscribeToTicket('event-123', 'user-456', onTicket);

    capturedHandler({ new: { user_id: 'user-456', ticket_code: 'ROXY-ABCD1234' } });
    expect(onTicket).toHaveBeenCalledWith('ROXY-ABCD1234');
  });

  it('does not call onTicket when payload userId does not match', () => {
    let capturedHandler: (payload: any) => void = () => {};
    const onFn = jest.fn((_, __, handler) => {
      capturedHandler = handler;
      return { subscribe: jest.fn() };
    });
    supabase.channel.mockReturnValue({ on: onFn });

    const onTicket = jest.fn();
    subscribeToTicket('event-123', 'user-456', onTicket);

    capturedHandler({ new: { user_id: 'different-user', ticket_code: 'ROXY-ABCD1234' } });
    expect(onTicket).not.toHaveBeenCalled();
  });

  it('does not call onTicket when ticket_code is absent', () => {
    let capturedHandler: (payload: any) => void = () => {};
    const onFn = jest.fn((_, __, handler) => {
      capturedHandler = handler;
      return { subscribe: jest.fn() };
    });
    supabase.channel.mockReturnValue({ on: onFn });

    const onTicket = jest.fn();
    subscribeToTicket('event-123', 'user-456', onTicket);

    capturedHandler({ new: { user_id: 'user-456', ticket_code: null } });
    expect(onTicket).not.toHaveBeenCalled();
  });

  it('returns an unsub function that calls removeChannel', () => {
    // subscribe() returns the channel itself in real Supabase (chaining pattern)
    const mockChannel: any = {};
    mockChannel.on = jest.fn().mockReturnValue({ subscribe: jest.fn().mockReturnValue(mockChannel) });
    supabase.channel.mockReturnValue(mockChannel);

    const unsub = subscribeToTicket('event-123', 'user-456', jest.fn());
    unsub();

    expect(supabase.removeChannel).toHaveBeenCalledWith(mockChannel);
  });
});

describe('purchaseTicket soldOut path', () => {
  it('returns soldOut:true when edge function returns sold_out error', async () => {
    const { callEdgeFunction } = jest.requireMock('../../lib/supabase');
    callEdgeFunction.mockResolvedValue({ data: null, error: 'sold_out' });

    const { purchaseTicket } = require('../../lib/stripe');
    const result = await purchaseTicket(
      '00000000-0000-0000-0000-000000000001',
      jest.fn(),
      jest.fn(),
      'user-1',
    );
    expect(result.soldOut).toBe(true);
    expect(result.success).toBe(false);
  });
});
