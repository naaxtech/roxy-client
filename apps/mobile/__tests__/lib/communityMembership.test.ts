/**
 * Community membership goes through migration 132's RPCs (CHAT-09).
 *
 * A private community used to open to anyone who sent one INSERT. Now a
 * public one opens at once, a private one takes a request a moderator
 * approves (or an invite she accepts), and a ban closes both doors. The store
 * must never claim she joined when the server only filed a request.
 */
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

import {
  requestToJoinCommunity, respondJoinRequest, inviteToCommunity, respondCommunityInvite,
  removeCommunityMember, unbanCommunityMember, fetchCommunityBans,
} from '../../lib/communityMembership';
import { useCommunityStore } from '../../store/communityStore';

const { supabase } = jest.requireMock('../../lib/supabase');

const community = (id: string, is_private = false) => ({
  id, name: id, slug: id, description: null, cover_image_url: null, category: 'interest', is_private,
  member_count: 1, created_by: 'u1', created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  useCommunityStore.setState({ allCommunities: [], joinedCommunities: [], joinedIds: new Set(), requestedIds: new Set() } as never);
});

describe('wrappers call the right RPC with the right names', () => {
  it.each([
    [() => requestToJoinCommunity('c1', 'hi'), 'request_to_join_community', { p_community: 'c1', p_note: 'hi' }],
    [() => respondJoinRequest('c1', 'u2', true), 'respond_join_request', { p_community: 'c1', p_user: 'u2', p_approve: true }],
    [() => inviteToCommunity('c1', 'u2'), 'invite_to_community', { p_community: 'c1', p_user: 'u2' }],
    [() => respondCommunityInvite('c1', false), 'respond_community_invite', { p_community: 'c1', p_accept: false }],
    [() => removeCommunityMember('c1', 'u2', { ban: true, reason: 'spam' }), 'remove_community_member', { p_community: 'c1', p_user: 'u2', p_ban: true, p_reason: 'spam' }],
    [() => removeCommunityMember('c1', 'u2'), 'remove_community_member', { p_community: 'c1', p_user: 'u2', p_ban: false, p_reason: null }],
    [() => unbanCommunityMember('c1', 'u2'), 'unban_community_member', { p_community: 'c1', p_user: 'u2' }],
  ])('%#', async (call, name, args) => {
    supabase.rpc.mockResolvedValueOnce({ data: 'joined', error: null });
    await call();
    expect(supabase.rpc).toHaveBeenCalledWith(name, args);
  });

  it('a refusal throws her words, never a raw Postgres message', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: "you can't join this community" } });
    await expect(requestToJoinCommunity('c1')).rejects.toThrow("You can't join this community.");
  });
});

describe('communityStore.joinCommunity', () => {
  it('a public community: joined, through the RPC (no direct INSERT)', async () => {
    useCommunityStore.setState({ allCommunities: [community('c1')] } as never);
    supabase.rpc.mockResolvedValueOnce({ data: 'joined', error: null });
    const outcome = await useCommunityStore.getState().joinCommunity('c1', 'me');
    expect(outcome).toBe('joined');
    expect(supabase.rpc).toHaveBeenCalledWith('request_to_join_community', { p_community: 'c1', p_note: null });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(useCommunityStore.getState().joinedIds.has('c1')).toBe(true);
  });

  it('a private community: "requested" — not shown as joined, remembered as asked', async () => {
    useCommunityStore.setState({ allCommunities: [community('c2', true)] } as never);
    supabase.rpc.mockResolvedValueOnce({ data: 'requested', error: null });
    const outcome = await useCommunityStore.getState().joinCommunity('c2', 'me');
    expect(outcome).toBe('requested');
    expect(useCommunityStore.getState().joinedIds.has('c2')).toBe(false);
    expect(useCommunityStore.getState().joinedCommunities).toHaveLength(0);
    expect(useCommunityStore.getState().requestedIds.has('c2')).toBe(true);
  });

  it('a refused join reverts and throws', async () => {
    useCommunityStore.setState({ allCommunities: [community('c1')] } as never);
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: "you can't join this community" } });
    await expect(useCommunityStore.getState().joinCommunity('c1', 'me')).rejects.toThrow("You can't join this community.");
    expect(useCommunityStore.getState().joinedIds.has('c1')).toBe(false);
  });
});

describe('fetchCommunityBans', () => {
  it('lists the current bans for moderators, newest first, expired ones left out', async () => {
    const ops: [string, unknown[]][] = [];
    const rows = [{ user_id: 'u2', reason: 'spam', created_at: '2026-10-11T09:00:00Z', expires_at: null, profile: { id: 'u2', display_name: 'Sam', username: 'sam', avatar_url: null } }];
    const q: Record<string, unknown> = {};
    ['select', 'eq', 'or', 'order'].forEach((m) => { q[m] = (...a: unknown[]) => { ops.push([m, a]); return q; }; });
    (q as { then: unknown }).then = (res: (v: unknown) => void) => res({ data: rows, error: null });
    supabase.from.mockImplementation((t: string) => { ops.push(['from', [t]]); return q; });
    const out = await fetchCommunityBans('c1');
    expect(ops[0]).toEqual(['from', ['community_bans']]);
    expect(ops).toContainEqual(['eq', ['community_id', 'c1']]);
    expect(ops.find(([m]) => m === 'or')?.[1][0]).toMatch(/expires_at.is.null,expires_at.gt./);
    expect(ops).toContainEqual(['order', ['created_at', { ascending: false }]]);
    expect(out).toEqual(rows);
  });

  it('a refused read throws', async () => {
    const q: Record<string, unknown> = {};
    ['select', 'eq', 'or', 'order'].forEach((m) => { q[m] = () => q; });
    (q as { then: unknown }).then = (res: (v: unknown) => void) => res({ data: null, error: { message: 'nope' } });
    supabase.from.mockImplementation(() => q);
    await expect(fetchCommunityBans('c1')).rejects.toBeTruthy();
  });
});
