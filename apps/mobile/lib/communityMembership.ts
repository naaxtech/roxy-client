import { supabase } from './supabase';
import { chatErrorMessage } from './chat';

/**
 * Community membership through migration 132's RPCs (CHAT-09).
 *
 * A private community used to open to anyone who sent one INSERT into
 * community_members, and nobody could ever be removed. Now:
 *  - a public community opens at once (`joined`);
 *  - a private one files a request a moderator approves (`requested`), or
 *    accepts the invite a moderator sent;
 *  - moderators remove and ban (below their own rank), and a ban closes
 *    every door: join, request, invite, posting.
 * Each wrapper throws her words on a refusal (lib/chat chatErrorMessage).
 */

export type JoinOutcome = 'joined' | 'requested' | 'member';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const err = new Error(chatErrorMessage(error)) as Error & { cause?: unknown; code?: string };
    err.cause = error;
    err.code = (error as { code?: string }).code;
    throw err;
  }
  return data as T;
}

export function requestToJoinCommunity(communityId: string, note?: string | null): Promise<JoinOutcome> {
  return rpc<JoinOutcome>('request_to_join_community', { p_community: communityId, p_note: note?.trim() || null });
}

/** Moderators: answer a request. Approving makes her a member. */
export function respondJoinRequest(communityId: string, userId: string, approve: boolean): Promise<void> {
  return rpc<void>('respond_join_request', { p_community: communityId, p_user: userId, p_approve: approve });
}

/** Moderators: invite an approved member. 'joined' when she had already asked. */
export function inviteToCommunity(communityId: string, userId: string): Promise<'invited' | 'joined' | 'member'> {
  return rpc('invite_to_community', { p_community: communityId, p_user: userId });
}

/** The invitee answers. A no is never shown to whoever invited her. */
export function respondCommunityInvite(communityId: string, accept: boolean): Promise<void> {
  return rpc<void>('respond_community_invite', { p_community: communityId, p_accept: accept });
}

/** Moderators: remove someone below their rank; `ban` keeps her out. */
export function removeCommunityMember(
  communityId: string,
  userId: string,
  opts: { ban?: boolean; reason?: string | null } = {},
): Promise<void> {
  return rpc<void>('remove_community_member', {
    p_community: communityId,
    p_user: userId,
    p_ban: !!opts.ban,
    p_reason: opts.reason?.trim() || null,
  });
}

export function unbanCommunityMember(communityId: string, userId: string): Promise<void> {
  return rpc<void>('unban_community_member', { p_community: communityId, p_user: userId });
}

export interface CommunityBan {
  user_id: string;
  reason: string | null;
  created_at: string;
  expires_at: string | null;
  profile: { id: string; display_name: string | null; username: string | null; avatar_url: string | null } | null;
}

/**
 * Moderators: who is banned here now (an expired ban no longer counts),
 * newest first. community_bans_select (132) returns nothing to a member but
 * her own row, so this is only called for moderators.
 */
export async function fetchCommunityBans(communityId: string): Promise<CommunityBan[]> {
  const { data, error } = await supabase
    .from('community_bans')
    .select('user_id, reason, created_at, expires_at, profile:profiles!community_bans_user_id_fkey(id, display_name, username, avatar_url)')
    .eq('community_id', communityId)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CommunityBan[];
}

// ── Moderator tools ─────────────────────────────────────────────────────────

const RANK: Record<string, number> = { owner: 4, admin: 3, moderator: 2, border_patrol: 1, member: 0 };

/** The ranks remove_community_member compares (132). */
export function communityRank(role: string | null | undefined): number {
  return RANK[role ?? ''] ?? 0;
}

/**
 * May she remove / ban this person? Moderators and up, and only someone below
 * her own rank — the server refuses the rest, so the menu never offers it.
 */
export function canModerateMember(myRole: string | null | undefined, theirRole: string | null | undefined): boolean {
  const mine = communityRank(myRole);
  return mine >= RANK.moderator && mine > communityRank(theirRole);
}

export interface JoinRequest {
  user_id: string;
  note: string | null;
  created_at: string;
  profile: { id: string; display_name: string | null; username: string | null; avatar_url: string | null } | null;
}

/** Moderators: the pending asks, oldest first. RLS returns nothing to anyone else. */
export async function fetchJoinRequests(communityId: string): Promise<JoinRequest[]> {
  const { data, error } = await supabase
    .from('community_join_requests')
    .select('user_id, note, created_at, profile:profiles!community_join_requests_user_id_fkey(id, display_name, username, avatar_url)')
    .eq('community_id', communityId)
    .eq('status', 'pending')
    .eq('kind', 'request')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as JoinRequest[];
}

/** Everyone above 'member' in this community → her role. Members are absent. */
export async function fetchElevatedRoles(communityId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('community_members')
    .select('user_id, role')
    .eq('community_id', communityId)
    .neq('role', 'member');
  if (error) throw error;
  return new Map(((data ?? []) as { user_id: string; role: string }[]).map((r) => [r.user_id, r.role]));
}

export interface CommunityInvite {
  community_id: string;
  created_at: string;
  community: { id: string; name: string } | null;
}

/**
 * Her open invites to private communities. communities_read_invited (132)
 * lets her see the name of a community she was invited to — and nothing else
 * about any private community she is not in.
 */
export async function fetchMyCommunityInvites(userId: string): Promise<CommunityInvite[]> {
  const { data, error } = await supabase
    .from('community_join_requests')
    .select('community_id, created_at, community:communities(id, name)')
    .eq('user_id', userId)
    .eq('kind', 'invite')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CommunityInvite[];
}
