import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ReviewQueueClient, ReviewerAgreement } from './ReviewQueueClient';

export const dynamic = 'force-dynamic';

interface ApplicationRow {
  id: string;
  community_id: string;
  ready_at: string;
  communities: { name: string } | null;
}

/**
 * The review queue: applications she has sent for review, oldest first, each
 * with its wait against the 48-hour promise (G-10), the full context a reviewer
 * needs (G-13, loaded per card from application_review_context) and decisions
 * through decide_application, which writes the append-only decision log and
 * queues her email (130).
 *
 * There is deliberately no community filter in the query below. RLS
 * (`can_review_application`, rewritten in 130) already restricts every row to
 * communities staff made the caller a reviewer for, plus everything for staff.
 * Re-implementing that filter here would create a second copy of the rule that
 * could drift from the one that actually protects the data.
 *
 * Overflow moved, it did not disappear: since 130 the aged-overflow pool is
 * staff-only (any community admin could otherwise read strangers'
 * applications, G-07), and staff see every application here already. The old
 * per-reviewer opt-in toggle wrote a table members can no longer write.
 *
 * Not staff-only: community reviewers whom staff granted use this page too.
 * Their gate is the database's (granted + agreement signed + approved).
 */
export default async function ApplicationsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  // Her own private columns come from my_profile since 130: vetting_status is
  // no longer in the column grant on profiles, so selecting it there is a
  // permission error, which used to land here as a 404.
  const { data: me } = await supabase
    .from('my_profile')
    .select('is_staff, staff_role, vetting_status')
    .maybeSingle();
  const profile = me as {
    is_staff: boolean | null;
    staff_role: string | null;
    vetting_status: string | null;
  } | null;
  if (!profile) notFound();

  const isCore = profile.staff_role === 'core';
  const isStaff = profile.is_staff === true;

  if (!isCore && profile.vetting_status !== 'approved') {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Applications</h1>
        <div className="border rounded-lg p-6 space-y-2">
          <p className="font-semibold">Your own account needs to be verified first</p>
          <p className="text-sm text-muted-foreground">
            Reviewing applications means reading other women&apos;s answers and identity check
            results. Only members who have been through verification themselves can do it.
          </p>
        </div>
      </div>
    );
  }

  const { data: settings } = await supabase
    .from('reviewer_settings')
    .select('reviewer_agreement_at, reviewer_granted_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!isStaff && !isCore && !settings?.reviewer_granted_at) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Applications</h1>
        <div className="border rounded-lg p-6 space-y-2">
          <p className="font-semibold">Roxy staff haven&apos;t made you a reviewer yet</p>
          <p className="text-sm text-muted-foreground">
            Community admins and border patrol review applications once Roxy staff grant them
            reviewer access. Ask the Roxy team if your community needs a reviewer.
          </p>
        </div>
      </div>
    );
  }

  if (!isCore && !settings?.reviewer_agreement_at) {
    return <ReviewerAgreement />;
  }

  const [{ data: applications, error }, { data: staffReviewer }] = await Promise.all([
    supabase
      .from('membership_applications')
      .select('id, community_id, ready_at, communities(name)')
      .eq('status', 'pending')
      // Drafts are hers until she presses "Send for review" (G-14).
      .not('ready_at', 'is', null)
      .order('ready_at', { ascending: true }),
    supabase.rpc('is_staff_reviewer'),
  ]);

  if (error) {
    return (
      <div className="max-w-5xl space-y-4">
        <h1 className="text-2xl font-bold">Applications</h1>
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">
            We could not load the queue. Reload the page — if it keeps failing, your session may
            have expired.
          </p>
        </div>
      </div>
    );
  }

  const rows = (applications ?? []) as unknown as ApplicationRow[];

  // Scores in one round trip rather than an RPC per row. Computed from the same
  // active criteria the server's application_score() uses. Shown, not sorted
  // by: the queue is oldest first so nothing rots at the bottom.
  const scores: Record<string, number> = {};
  if (rows.length > 0) {
    const { data: met } = await supabase
      .from('application_criteria_met')
      .select('application_id, verification_criteria(points, is_active)')
      .in('application_id', rows.map((r) => r.id));

    for (const row of (met ?? []) as unknown as {
      application_id: string;
      verification_criteria: { points: number; is_active: boolean } | null;
    }[]) {
      if (!row.verification_criteria?.is_active) continue;
      scores[row.application_id] =
        (scores[row.application_id] ?? 0) + row.verification_criteria.points;
    }
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          Applications
          {rows.length > 0 && <Badge variant="destructive">{rows.length}</Badge>}
        </h1>
        <p className="text-muted-foreground mt-1">
          {isStaff || isCore
            ? 'Every application on Roxy that has been sent for review. A human decides on each one.'
            : 'Every person here was invited by a code your community issued. A human decides on each one.'}
        </p>
      </div>

      <ReviewQueueClient
        applications={rows.map((r) => ({
          id: r.id,
          communityName: r.communities?.name ?? 'Unknown community',
          readyAt: r.ready_at,
          score: scores[r.id] ?? 0,
        }))}
        canRevealNames={staffReviewer === true}
        now={new Date().toISOString()}
      />
    </div>
  );
}
