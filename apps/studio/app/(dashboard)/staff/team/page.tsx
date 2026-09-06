import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatUtcDate } from '@/lib/dates';
import { isMissingColumn, isMissingTable } from '@/lib/schema-availability';
import { ilikePattern } from '@/lib/ilikePattern';
import { TeamClient, type StaffKind, type TeamMember } from './TeamClient';

export const dynamic = 'force-dynamic';

const MEMBER_LIMIT = 500;

interface ProfileRow {
  id: string;
  display_name: string | null;
  username: string | null;
  staff_role: string | null;
  is_staff: boolean | null;
  is_community_owner?: boolean | null;
  vetting_status?: string | null;
  created_at: string | null;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Roxy team</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Roxy core sees every member, every staff account, and every community
          owner. Staff can run the host tools. Only core can add or remove
          staff, and only core can tag a community owner — never self-serve,
          approved members only. Core itself is seeded, not assigned here.
        </p>
      </div>
      {children}
    </div>
  );
}

function toMember(row: ProfileRow): TeamMember {
  const role: StaffKind | null =
    row.staff_role === 'core' || row.staff_role === 'staff'
      ? row.staff_role
      : row.is_staff
        ? 'staff'
        : null;
  return {
    id: row.id,
    displayName: row.display_name,
    username: row.username,
    staffRole: role,
    isCommunityOwner: row.is_community_owner === true,
    vettingStatus: row.vetting_status ?? null,
    createdLabel: row.created_at ? formatUtcDate(row.created_at) : 'Unknown',
  };
}

export default async function StaffTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? '';

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff, staff_role')
    .eq('id', userId)
    .single();
  if (profile?.staff_role !== 'core') notFound();

  const TEAM_COLS =
    'id, display_name, username, staff_role, is_staff, is_community_owner, vetting_status, created_at';
  const TEAM_COLS_FALLBACK = 'id, display_name, username, staff_role, is_staff, created_at';

  const teamFull = await supabase
    .from('profiles')
    .select(TEAM_COLS)
    .or('is_staff.eq.true,is_community_owner.eq.true')
    .order('created_at', { ascending: false })
    .limit(MEMBER_LIMIT);

  const hasOwnerCol = !isMissingColumn(teamFull.error);
  const team = hasOwnerCol
    ? teamFull
    : await supabase
        .from('profiles')
        .select(TEAM_COLS_FALLBACK)
        .eq('is_staff', true)
        .order('created_at', { ascending: false })
        .limit(MEMBER_LIMIT);

  if (isMissingColumn(team.error) || isMissingTable(team.error)) {
    return (
      <PageShell>
        <div className="border rounded-lg p-6 space-y-2">
          <p className="font-semibold">Staff roles are not switched on yet</p>
          <p className="text-sm text-muted-foreground max-w-prose">
            The screen is ready; the database has not received the core/staff
            toggle yet. Nothing here will fail silently in the meantime.
          </p>
        </div>
      </PageShell>
    );
  }

  if (team.error) {
    return (
      <PageShell>
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose"
        >
          <p className="text-sm text-destructive">
            We could not load the team. This is a loading failure, not an empty
            list — reload before you act on it.
          </p>
        </div>
      </PageShell>
    );
  }

  const pattern = ilikePattern(q);
  let rosterQuery = supabase
    .from('profiles')
    .select(hasOwnerCol ? TEAM_COLS : TEAM_COLS_FALLBACK)
    .order('created_at', { ascending: false })
    .limit(MEMBER_LIMIT);
  if (pattern) {
    rosterQuery = rosterQuery.or(`username.ilike.${pattern},display_name.ilike.${pattern}`);
  }

  const roster = pattern ? await rosterQuery : { data: [] as ProfileRow[], error: null };

  if (roster.error && !isMissingColumn(roster.error) && !isMissingTable(roster.error)) {
    return (
      <PageShell>
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose"
        >
          <p className="text-sm text-destructive">
            We could not search members. Reload before you act on it.
          </p>
        </div>
      </PageShell>
    );
  }

  const teamRows = (team.data ?? []) as ProfileRow[];
  const rosterRows = (roster.data ?? []) as ProfileRow[];

  return (
    <PageShell>
      <TeamClient
        members={teamRows.map(toMember)}
        roster={rosterRows.map(toMember)}
        truncated={rosterRows.length >= MEMBER_LIMIT}
        initialQuery={q}
      />
    </PageShell>
  );
}
