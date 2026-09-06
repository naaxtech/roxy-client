import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { formatUtcDate } from '@/lib/dates';
import { getHostScope } from '@/lib/hostScope';
import { isMissingTable } from '@/lib/schema-availability';
import {
  MembersClient,
  type ManagedCommunity,
  type MemberItem,
} from './MembersClient';

export const dynamic = 'force-dynamic';

/** Big communities exist. One screen does not need all of them at once. */
const MEMBER_LIMIT = 500;

const ROLE_RANK: Record<string, number> = {
  admin: 0,
  border_patrol: 1,
  moderator: 2,
  member: 3,
};

interface MemberRow {
  community_id: string;
  user_id: string;
  role: string;
  joined_at: string | null;
  profiles: {
    display_name: string | null;
    username: string | null;
    vetting_status: string | null;
  } | null;
}

/**
 * Members and roles.
 *
 * Role changes go through `set_community_role` (migration 078), which is the
 * single audited path — direct writes to community_members.role are refused by
 * design. That migration is not applied to every project yet, so this page
 * probes for the audit table it creates and degrades to a read-only roster
 * instead of offering a control that would fail on click.
 */
export default async function CommunityMembersPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const scope = await getHostScope(supabase, userId, ['admin', 'border_patrol']);

  if (scope.error) {
    return (
      <PageShell isCore={scope.isCore}>
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose"
        >
          <p className="text-sm text-destructive">
            We could not load your communities. Reload the page — if it keeps failing, your
            session may have expired.
          </p>
        </div>
      </PageShell>
    );
  }

  const communities: ManagedCommunity[] = scope.communities.map((community) => ({
    id: community.id,
    name: community.name,
    callerRole: community.callerRole,
  }));

  if (communities.length === 0) {
    return (
      <PageShell isCore={scope.isCore}>
        <div className="border rounded-lg p-8 space-y-3">
          <p className="font-medium">
            {scope.isCore ? 'There are no communities yet' : 'You do not run a community yet'}
          </p>
          <p className="text-sm text-muted-foreground max-w-prose">
            {scope.isCore
              ? 'Create a community and its roster appears here. You can set every role from this page.'
              : 'This page lists the members of communities you administer or patrol. Create one, or ask an admin of yours to give you a role, and your roster appears here.'}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/community">Go to Community</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  const communityIds = communities.map((community) => community.id);

  // The probe and the roster are independent, so they go together. A missing
  // community_role_changes table means 078 has not been applied here; anything
  // else (including "no rows") means role management is live.
  const [roster, roleAudit] = await Promise.all([
    supabase
      .from('community_members')
      .select('community_id, user_id, role, joined_at, profiles(display_name, username, vetting_status)')
      .in('community_id', communityIds)
      .limit(MEMBER_LIMIT),
    supabase.from('community_role_changes').select('id').limit(1),
  ]);

  const roleManagementAvailable = !isMissingTable(roleAudit.error);

  if (roster.error) {
    return (
      <PageShell isCore={scope.isCore}>
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose"
        >
          <p className="text-sm text-destructive">
            We could not load your members. This is a loading failure, not an empty community —
            reload before you act on it.
          </p>
        </div>
      </PageShell>
    );
  }

  const memberRows = (roster.data ?? []) as unknown as MemberRow[];
  const communityNames = new Map(communities.map((community) => [community.id, community.name]));

  const members: MemberItem[] = memberRows
    .map((row) => ({
      communityId: row.community_id,
      userId: row.user_id,
      role: row.role,
      // A ghosted or deactivated member is hidden by profiles_select_public
      // (migration 080). She is still a member, so she is still listed —
      // without a name we can honestly show.
      displayName: row.profiles?.display_name ?? null,
      username: row.profiles?.username ?? null,
      vettingStatus: row.profiles?.vetting_status ?? null,
      joinedLabel: row.joined_at ? formatUtcDate(row.joined_at) : 'Unknown',
    }))
    .sort((a, b) => {
      const byCommunity = (communityNames.get(a.communityId) ?? '').localeCompare(
        communityNames.get(b.communityId) ?? '',
      );
      if (byCommunity !== 0) return byCommunity;
      const byRole = (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9);
      if (byRole !== 0) return byRole;
      return (a.displayName ?? '').localeCompare(b.displayName ?? '');
    });

  return (
    <PageShell isCore={scope.isCore}>
      <MembersClient
        currentUserId={userId}
        communities={communities}
        members={members}
        roleManagementAvailable={roleManagementAvailable}
        truncated={memberRows.length >= MEMBER_LIMIT}
      />
    </PageShell>
  );
}

function PageShell({ children, isCore = false }: { children: React.ReactNode; isCore?: boolean }) {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Members and roles</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          {isCore
            ? 'Every community on Roxy, and who is in each one. You can change any role — this is HQ.'
            : "Who is in your community, and what each of them can do. Roles decide who can invite, who can moderate, and who is allowed to read an applicant's legal name."}
        </p>
      </div>
      {children}
    </div>
  );
}
