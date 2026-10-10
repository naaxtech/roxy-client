import { openDirectChat } from '../lib/directMessages';

/**
 * openDirectChat goes through the `start_direct` RPC (migration 132).
 *
 * It used to SELECT then INSERT into `conversations` straight from the phone.
 * That client-side path decided nothing about requests: a stranger's thread
 * opened in her main inbox and rang her bell with the text (CHAT-02). The RPC
 * finds-or-creates in one place (the old 23505 create-race recovery now lives
 * inside it), files a stranger's thread under the other woman's Requests,
 * applies the 20-new-chats-a-day cap and refuses a block-paired pair without
 * saying which.
 */

jest.mock('../lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));
jest.mock('../lib/analytics', () => ({
  Analytics: { dmOpened: jest.fn(), dmCreated: jest.fn() },
}));

const { supabase } = jest.requireMock('../lib/supabase');
const { Analytics } = jest.requireMock('../lib/analytics');

describe('openDirectChat', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks start_direct for the thread with her and returns its id', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'conv-1', error: null });
    await expect(openDirectChat('me', 'her')).resolves.toBe('conv-1');
    expect(supabase.rpc).toHaveBeenCalledWith('start_direct', { p_user: 'her' });
    expect(Analytics.dmOpened).toHaveBeenCalledWith('conv-1');
  });

  it('never writes conversations directly (CHAT-03)', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'conv-1', error: null });
    await openDirectChat('me', 'her');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('throws her words when the server refuses (rate limit)', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { code: 'PT429', message: 'rate_limited: you have started a lot of new chats today, try again tomorrow' },
    });
    await expect(openDirectChat('me', 'her')).rejects.toThrow(/new chats today/i);
    expect(Analytics.dmOpened).not.toHaveBeenCalled();
  });

  it('a blocked or deactivated account reads as "not available", never "blocked"', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: 'that account is not available' },
    });
    await expect(openDirectChat('me', 'her')).rejects.toThrow("That account isn't available.");
  });

  it('throws when the server answers with no id at all', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
    await expect(openDirectChat('me', 'her')).rejects.toThrow();
  });
});
