import { useSafetyStore } from '../../store/safetyStore';

/**
 * Unblocking has to prove it happened.
 *
 * 085 shipped `block_user` with no `unblock_user`, so a block was permanent by
 * accident and the prototype's "Blocked" list had no undo to call. 093 adds one
 * that RETURNS the affected row count, and this is why: PostgREST answers 200
 * for a statement that matched nothing, so "no error" is not evidence. The
 * nearest miss in this app's history is `block_user` writing
 * `friendships.status='blocked'` that nothing read, while the sheet told her
 * "You will not see each other here" — a safety control that reported success
 * over a state change nobody could observe.
 */

const mockRpc = jest.fn();
const mockLogError = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  callEdgeFunction: jest.fn(),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));

const her = { id: 'u9', display_name: 'Sam', username: 'sam', avatar_url: null };

beforeEach(() => {
  mockRpc.mockReset();
  mockLogError.mockReset();
  useSafetyStore.setState({
    blockedUserIds: ['u9', 'u10'],
    blockedProfiles: [her, { id: 'u10', display_name: 'Ro', username: 'ro', avatar_url: null }],
    loadingBlocks: false,
    blockLoadError: false,
  });
});

describe('unblockUser', () => {
  it('removes her from the list when the database says a row went', async () => {
    mockRpc.mockResolvedValue({ data: 1, error: null });

    await useSafetyStore.getState().unblockUser('u9');

    expect(mockRpc).toHaveBeenCalledWith('unblock_user', { p_target_id: 'u9' });
    expect(useSafetyStore.getState().blockedUserIds).toEqual(['u10']);
    expect(useSafetyStore.getState().blockedProfiles.map((p) => p.id)).toEqual(['u10']);
  });

  it('leaves her blocked when the call succeeded but changed nothing', async () => {
    // 200 with zero rows. Removing her from the list here would show an undo
    // that did not happen, and she would believe he could reach her again when
    // in fact — or worse, believe he could NOT when he can.
    mockRpc.mockResolvedValue({ data: 0, error: null });

    await useSafetyStore.getState().unblockUser('u9');

    expect(useSafetyStore.getState().blockedUserIds).toContain('u9');
    expect(useSafetyStore.getState().blockedProfiles.map((p) => p.id)).toContain('u9');
  });

  it('leaves her blocked and records the failure when the call errors', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'PGRST202' } });

    await useSafetyStore.getState().unblockUser('u9');

    expect(useSafetyStore.getState().blockedUserIds).toContain('u9');
    expect(mockLogError).toHaveBeenCalled();
  });

  it('reports whether it worked, so the screen does not have to guess', async () => {
    mockRpc.mockResolvedValue({ data: 1, error: null });
    await expect(useSafetyStore.getState().unblockUser('u9')).resolves.toBe(true);

    mockRpc.mockResolvedValue({ data: 0, error: null });
    await expect(useSafetyStore.getState().unblockUser('u10')).resolves.toBe(false);
  });
});

describe('loadBlockedProfiles', () => {
  it('fills the list from the scoped function', async () => {
    useSafetyStore.setState({ blockedProfiles: [] });
    mockRpc.mockResolvedValue({ data: [her], error: null });

    await useSafetyStore.getState().loadBlockedProfiles();

    expect(mockRpc).toHaveBeenCalledWith('blocked_profiles');
    expect(useSafetyStore.getState().blockedProfiles).toEqual([her]);
  });

  it('does not empty the list when the refresh fails', async () => {
    // Same rule `loadBlockedUsers` already follows: a failed refresh must never
    // look like "you have not blocked anyone".
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });

    await useSafetyStore.getState().loadBlockedProfiles();

    expect(useSafetyStore.getState().blockedProfiles).toHaveLength(2);
    expect(useSafetyStore.getState().blockLoadError).toBe(true);
  });
});
