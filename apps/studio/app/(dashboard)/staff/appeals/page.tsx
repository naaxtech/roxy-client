import { createClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/staff-guard';
import { Badge } from '@/components/ui/badge';
import {
  AppealsClient,
  GrandfatheredList,
  type AppealItem,
  type GrandfatheredItem,
} from './AppealsClient';

export const dynamic = 'force-dynamic';

interface AppealRow {
  id: string;
  application_id: string;
  reason: string;
  requested_at: string;
  resolved_at: string | null;
  outcome: string | null;
  membership_applications: {
    decision_reason: string | null;
    communities: { name: string } | null;
  } | null;
}

interface GrandfatheredRow {
  user_id: string;
  display_name: string | null;
  username: string | null;
  joined_at: string | null;
  grandfathered_at: string | null;
  reviewed: boolean;
}

/**
 * Appeals and grandfathered members (G-12, G-23).
 *
 * Before 130 an appeal was written to application_appeals and nothing read it:
 * the "Roxy staff will review it" promise on her rejected screen was false.
 * Now staff resolve each one through resolve_appeal (staff reviewers only,
 * note required, decision-logged, she is emailed either way).
 *
 * Reads go through RLS (aa_staff_read: is_roxy_staff) and the SECURITY
 * DEFINER grandfathered_members(), which returns nothing for non-staff.
 * requireStaffPage is the first line; the database is the last.
 */
export default async function StaffAppealsPage() {
  await requireStaffPage();
  const supabase = await createClient();

  const [appealsRes, grandfatheredRes, reviewerRes] = await Promise.all([
    supabase
      .from('application_appeals')
      .select(
        'id, application_id, reason, requested_at, resolved_at, outcome, membership_applications(decision_reason, communities(name))',
      )
      .order('requested_at', { ascending: true })
      .limit(200),
    supabase.rpc('grandfathered_members'),
    supabase.rpc('is_staff_reviewer'),
  ]);

  const loadFailed = Boolean(appealsRes.error || grandfatheredRes.error);

  const appeals: AppealItem[] = ((appealsRes.data ?? []) as unknown as AppealRow[]).map((r) => ({
    id: r.id,
    applicationId: r.application_id,
    appeal: r.reason,
    requestedAt: r.requested_at,
    resolvedAt: r.resolved_at,
    outcome: r.outcome,
    communityName: r.membership_applications?.communities?.name ?? null,
    rejectionReason: r.membership_applications?.decision_reason ?? null,
  }));
  // Open first (oldest first), then the most recently resolved.
  appeals.sort((a, b) => {
    if (!a.resolvedAt !== !b.resolvedAt) return a.resolvedAt ? 1 : -1;
    if (!a.resolvedAt) return a.requestedAt.localeCompare(b.requestedAt);
    return (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '');
  });

  const grandfathered: GrandfatheredItem[] = (
    (grandfatheredRes.data ?? []) as GrandfatheredRow[]
  ).map((g) => ({
    userId: g.user_id,
    displayName: g.display_name,
    username: g.username,
    joinedAt: g.joined_at,
    reviewed: g.reviewed,
  }));

  const openCount = appeals.filter((a) => !a.resolvedAt).length;
  const unreviewed = grandfathered.filter((g) => !g.reviewed).length;
  const canDecide = reviewerRes.data === true;

  return (
    <div className="max-w-5xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          Appeals
          {openCount > 0 && <Badge variant="destructive">{openCount}</Badge>}
        </h1>
        <p className="text-muted-foreground mt-1">
          One appeal per rejection. Overturning approves her and emails her that she&apos;s in;
          upholding emails her when she can apply again. Every outcome is written to the
          permanent decision log.
        </p>
      </div>

      {loadFailed && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">
            Some of this page could not load. Reload — if it keeps failing, your session may have
            expired.
          </p>
        </div>
      )}

      {!canDecide && (
        <div className="border rounded-lg px-4 py-3 text-sm text-muted-foreground">
          You can read appeals, but deciding them needs a staff reviewer who has signed the
          reviewer agreement (open Applications to sign it).
        </div>
      )}

      <AppealsClient appeals={appeals} now={new Date().toISOString()} />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Grandfathered members
            {unreviewed > 0 && <Badge variant="secondary">{unreviewed} not reviewed</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            These accounts joined before the invite gate and were let in without a review. Review
            is optional: keep them, or send someone to the waiting room so she applies with a
            code like everyone else.
          </p>
        </div>
        <GrandfatheredList members={grandfathered} />
      </section>
    </div>
  );
}
