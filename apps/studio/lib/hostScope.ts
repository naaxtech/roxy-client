import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { isMissingColumn } from '@/lib/schema-availability';

/** Roles that can operate a given Studio host surface. */
export type HostRole = 'admin' | 'border_patrol' | 'moderator';

export type HostCommunity = {
  id: string;
  name: string;
  /** Effective role for this caller. Core is always treated as admin. */
  callerRole: HostRole;
  description: string | null;
  memberCount: number | null;
};

export type HostScope = {
  isCore: boolean;
  communities: HostCommunity[];
  error: PostgrestError | null;
};

type MembershipRow = {
  community_id: string;
  role: string;
  communities: {
    id?: string;
    name: string | null;
    description?: string | null;
    member_count?: number | null;
  } | null;
};

type CommunityRow = {
  id: string;
  name: string;
  description: string | null;
  member_count: number | null;
};

export function isCoreAccount(staffRole: string | null | undefined): boolean {
  return staffRole === 'core';
}

/**
 * Who this caller may run as a host.
 *
 * Roxy core owns the product. They are not a community admin of each
 * community — they do not need to be. Everyone else stays scoped to the
 * memberships they actually hold.
 */
export function resolveHostCommunities(input: {
  isCore: boolean;
  allCommunities: CommunityRow[];
  memberships: MembershipRow[];
}): HostCommunity[] {
  if (input.isCore) {
    return input.allCommunities
      .map((community) => ({
        id: community.id,
        name: community.name,
        callerRole: 'admin' as const,
        description: community.description,
        memberCount: community.member_count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return input.memberships
    .map((row) => {
      const community = row.communities;
      if (!community) return null;
      const id = community.id ?? row.community_id;
      if (!id) return null;
      const role = row.role;
      if (role !== 'admin' && role !== 'border_patrol' && role !== 'moderator') {
        return null;
      }
      return {
        id,
        name: community.name ?? 'Unnamed community',
        callerRole: role,
        description: community.description ?? null,
        memberCount: community.member_count ?? null,
      } satisfies HostCommunity;
    })
    .filter((row): row is HostCommunity => row != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load the communities this Studio caller may manage.
 *
 * `roles` is the membership filter for everyone except core. Core always
 * receives every community, with `callerRole: 'admin'`.
 */
export async function getHostScope(
  supabase: SupabaseClient,
  userId: string,
  roles: HostRole[],
): Promise<HostScope> {
  const profile = await supabase
    .from('profiles')
    .select('staff_role')
    .eq('id', userId)
    .maybeSingle();

  const isCore =
    !isMissingColumn(profile.error) && isCoreAccount(profile.data?.staff_role);

  if (isCore) {
    const all = await supabase
      .from('communities')
      .select('id, name, description, member_count')
      .order('name');
    if (all.error) {
      return { isCore: true, communities: [], error: all.error };
    }
    return {
      isCore: true,
      communities: resolveHostCommunities({
        isCore: true,
        allCommunities: (all.data ?? []) as CommunityRow[],
        memberships: [],
      }),
      error: null,
    };
  }

  const memberships = await supabase
    .from('community_members')
    .select('community_id, role, communities(id, name, description, member_count)')
    .eq('user_id', userId)
    .in('role', roles);

  if (memberships.error) {
    return { isCore: false, communities: [], error: memberships.error };
  }

  return {
    isCore: false,
    communities: resolveHostCommunities({
      isCore: false,
      allCommunities: [],
      memberships: (memberships.data ?? []) as unknown as MembershipRow[],
    }),
    error: null,
  };
}
