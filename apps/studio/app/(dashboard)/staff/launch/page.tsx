import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatUtcDate } from '@/lib/dates';
import { isMissingColumn, isMissingTable } from '@/lib/schema-availability';
import { ilikePattern } from '@/lib/ilikePattern';
import {
  LaunchAccessClient,
  type AccessTier,
  type LaunchMember,
} from './LaunchAccessClient';

export const dynamic = 'force-dynamic';

const MEMBER_LIMIT = 500;

interface ProfileRow {
  id: string;
  display_name: string | null;
  username: string | null;
  access_tier: string | null;
  vetting_status: string | null;
  created_at: string | null;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Launch access</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Who can use the full Roxy app. Public members see the Archive and Roxy Official
          chat; everything else is Coming soon. Beta members see the rest. New accounts
          start public — this page is the only place that tag is set.
        </p>
      </div>
      {children}
    </div>
  );
}

/**
 * Staff toggle for `profiles.access_tier`.
 *
 * Community admins do not get this. Opening the full app is a product decision,
 * not a community role, so it goes through `set_access_tier` (migration 109)
 * the same way admission goes through `decide_application`: one SECURITY
 * DEFINER path, staff-only, audited. A direct client UPDATE on the column is
 * refused — 080 never granted it, and 109 does not add it.
 */
export default async function StaffLaunchAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tier?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? '';
  const tierFilter = params.tier === 'public' || params.tier === 'beta' ? params.tier : 'all';

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) notFound();

  const pattern = ilikePattern(q);
  let rosterQuery = supabase
    .from('profiles')
    .select('id, display_name, username, access_tier, vetting_status, created_at')
    .order('created_at', { ascending: false })
    .limit(MEMBER_LIMIT);

  if (pattern) {
    rosterQuery = rosterQuery.or(`username.ilike.${pattern},display_name.ilike.${pattern}`);
  }
  if (tierFilter !== 'all') {
    rosterQuery = rosterQuery.eq('access_tier', tierFilter);
  }

  const roster = await rosterQuery;

  if (isMissingColumn(roster.error) || isMissingTable(roster.error)) {
    return (
      <PageShell>
        <div className="border rounded-lg p-6 space-y-2">
          <p className="font-semibold">Launch access is not switched on yet</p>
          <p className="text-sm text-muted-foreground max-w-prose">
            The screen is ready; the database has not received the launch toggle yet.
            Nothing here will fail silently in the meantime.
          </p>
        </div>
      </PageShell>
    );
  }

  if (roster.error) {
    return (
      <PageShell>
        <div
          role="alert"
          className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose"
        >
          <p className="text-sm text-destructive">
            We could not load members. This is a loading failure, not an empty list —
            reload before you act on it.
          </p>
        </div>
      </PageShell>
    );
  }

  const rows = (roster.data ?? []) as ProfileRow[];
  const members: LaunchMember[] = rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    username: row.username,
    accessTier: row.access_tier === 'beta' ? 'beta' : 'public',
    vettingStatus: row.vetting_status,
    createdLabel: row.created_at ? formatUtcDate(row.created_at) : 'Unknown',
  }));

  return (
    <PageShell>
      <LaunchAccessClient
        members={members}
        truncated={rows.length >= MEMBER_LIMIT}
        initialQuery={q}
        initialFilter={tierFilter}
      />
    </PageShell>
  );
}

export type { AccessTier };
