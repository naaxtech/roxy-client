import { openDirectChat } from '../lib/directMessages';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../lib/analytics', () => ({
  Analytics: { dmOpened: jest.fn(), dmCreated: jest.fn() },
}));

const { supabase } = jest.requireMock('../lib/supabase');
const { Analytics } = jest.requireMock('../lib/analytics');

function mockConversations(
  findResult: { data: unknown; error: unknown },
  insertResult: { data: unknown; error: unknown } = { data: null, error: null },
) {
  const maybeSingle = jest.fn().mockResolvedValue(findResult);
  const single = jest.fn().mockResolvedValue(insertResult);
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: jest.fn(() => ({
      contains: jest.fn(() => ({
        eq: jest.fn(() => ({ limit: jest.fn(() => ({ maybeSingle })) })),
      })),
    })),
    insert: jest.fn(() => ({ select: jest.fn(() => ({ single })) })),
  }));
}

describe('openDirectChat', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the existing conversation id when one exists', async () => {
    mockConversations({ data: { id: 'conv-1' }, error: null });
    await expect(openDirectChat('me', 'her')).resolves.toBe('conv-1');
    expect(Analytics.dmOpened).toHaveBeenCalledWith('conv-1');
    expect(Analytics.dmCreated).not.toHaveBeenCalled();
  });

  it('creates a conversation when none exists', async () => {
    mockConversations({ data: null, error: null }, { data: { id: 'conv-new' }, error: null });
    await expect(openDirectChat('me', 'her')).resolves.toBe('conv-new');
    expect(Analytics.dmCreated).toHaveBeenCalled();
  });

  it('throws when the lookup fails', async () => {
    mockConversations({ data: null, error: new Error('rls denied') });
    await expect(openDirectChat('me', 'her')).rejects.toThrow('rls denied');
  });

  it('throws when the insert fails', async () => {
    mockConversations({ data: null, error: null }, { data: null, error: new Error('insert denied') });
    await expect(openDirectChat('me', 'her')).rejects.toThrow('insert denied');
    expect(Analytics.dmCreated).not.toHaveBeenCalled();
  });

  it('recovers the existing conversation when the insert loses the unique race (23505)', async () => {
    // First lookup: none. Insert: unique violation. Second lookup: the winner's row.
    const maybeSingle = jest.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id: 'conv-won' }, error: null });
    const single = jest.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } });
    (supabase.from as jest.Mock).mockImplementation(() => ({
      select: jest.fn(() => ({
        contains: jest.fn(() => ({
          eq: jest.fn(() => ({ limit: jest.fn(() => ({ maybeSingle })) })),
        })),
      })),
      insert: jest.fn(() => ({ select: jest.fn(() => ({ single })) })),
    }));
    await expect(openDirectChat('me', 'her')).resolves.toBe('conv-won');
    expect(Analytics.dmOpened).toHaveBeenCalledWith('conv-won');
    expect(Analytics.dmCreated).not.toHaveBeenCalled();
  });
});
