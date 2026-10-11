/**
 * Moderator tools for CHAT-09: who outranks whom (the same ranks
 * remove_community_member uses), and the pending join-request queue.
 */
const mockQuery: any = {};
jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(() => mockQuery),
  },
}));

import { canModerateMember, communityRank, fetchJoinRequests, fetchElevatedRoles } from '../../lib/communityMembership';

const { supabase } = jest.requireMock('../../lib/supabase');

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ['select', 'eq', 'neq', 'order']) mockQuery[k] = jest.fn(() => mockQuery);
});

describe('canModerateMember (mirrors remove_community_member ranks)', () => {
  it('ranks owner > admin > moderator > border_patrol > member', () => {
    expect(['owner', 'admin', 'moderator', 'border_patrol', 'member', null].map(communityRank)).toEqual([4, 3, 2, 1, 0, 0]);
  });
  it('a moderator removes a member, never an equal or a higher rank', () => {
    expect(canModerateMember('moderator', 'member')).toBe(true);
    expect(canModerateMember('moderator', 'border_patrol')).toBe(true);
    expect(canModerateMember('moderator', 'moderator')).toBe(false);
    expect(canModerateMember('moderator', 'admin')).toBe(false);
  });
  it('an admin removes moderators; a member or border patrol removes nobody', () => {
    expect(canModerateMember('admin', 'moderator')).toBe(true);
    expect(canModerateMember('member', 'member')).toBe(false);
    expect(canModerateMember('border_patrol', 'member')).toBe(false);
    expect(canModerateMember(null, 'member')).toBe(false);
  });
});

describe('fetchJoinRequests', () => {
  it('reads pending requests (not invites) for one community, oldest first, with the asker', async () => {
    mockQuery.order = jest.fn(() => Promise.resolve({
      data: [{ user_id: 'u1', note: 'hi', created_at: 't', profile: { id: 'u1', display_name: 'Ana', username: 'ana', avatar_url: null } }],
      error: null,
    }));
    const rows = await fetchJoinRequests('c1');
    expect(supabase.from).toHaveBeenCalledWith('community_join_requests');
    expect(mockQuery.select.mock.calls[0][0]).toContain('profiles!community_join_requests_user_id_fkey');
    expect(mockQuery.eq).toHaveBeenCalledWith('community_id', 'c1');
    expect(mockQuery.eq).toHaveBeenCalledWith('status', 'pending');
    expect(mockQuery.eq).toHaveBeenCalledWith('kind', 'request');
    expect(rows[0].profile?.display_name).toBe('Ana');
  });

  it('throws on a read error (never "nobody asked")', async () => {
    mockQuery.order = jest.fn(() => Promise.resolve({ data: null, error: { message: 'x' } }));
    await expect(fetchJoinRequests('c1')).rejects.toBeTruthy();
  });
});

describe('fetchElevatedRoles', () => {
  it('maps everyone above member to her role', async () => {
    mockQuery.neq = jest.fn(() => Promise.resolve({ data: [{ user_id: 'a', role: 'admin' }, { user_id: 'm', role: 'moderator' }], error: null }));
    const roles = await fetchElevatedRoles('c1');
    expect(mockQuery.neq).toHaveBeenCalledWith('role', 'member');
    expect(roles.get('a')).toBe('admin');
    expect(roles.get('nobody')).toBeUndefined();
  });
});
