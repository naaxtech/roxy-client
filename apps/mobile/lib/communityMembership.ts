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
