import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ReviewQueueClient, ReviewerAgreement } from './ReviewQueueClient';

export const dynamic = 'force-dynamic';

interface ApplicationRow {
  id: string;
  community_id: string;
  status: string;
  submitted_at: string;
  communities: { name: string } | null;
}

/**
 * The review queue.
 *
 * There is deliberately no community filter in the query below. RLS
 * (`can_review_application`, migration 070) already restricts every row to the
 * caller's own community, plus the aged overflow pool if they opted in, plus
 * everything if they are staff. Re-implementing that filter here would create a
 * second copy of the rule that could drift from the one that actually protects
 * the data.
 */
export default async function ApplicationsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff, vetting_status')
    .eq('id', userId)
    .single();

  // A reviewer must herself be vetted. A grandfathered 'unvetted' admin has
  // full app access but has never been checked by anyone, and applicant files
  // contain legal names and identity outcomes.
  if (!profile) notFound();

  const { data: settings } = await supabase
    .from('reviewer_settings')
    .select('accepts_overflow, reviewer_agreement_at')
    .eq('user_id', userId)
    .maybeSingle();

  const hasAgreement = Boolean(settings?.reviewer_agreement_at);
  const canReview = profile.vetting_status === 'approved';

  if (!canReview) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Applications</h1>
        <div className="border rounded-lg p-6 space-y-2">
          <p className="font-semibold">Your own account needs to be verified first</p>
          <p className="text-sm text-muted-foreground">
            Reviewing applications means reading other people&apos;s legal names and identity
            check results. Only members who have been through verification themselves can do
            it. Complete your own verification in the Roxy app and this page will open.
          </p>
        </div>
      </div>
    );
  }

  if (!hasAgreement) {
    return <ReviewerAgreement userId={userId} />;
  }

  const { data: applications } = await supabase
    .from('membership_applications')
    .select('id, community_id, status, submitted_at, communities(name)')
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });

  const rows = (applications ?? []) as unknown as ApplicationRow[];

  // Scores in one round trip rather than an RPC per row. Computed from the same
  // active criteria the server's application_score() uses, so the ordering here
  // matches what the applicant sees on her own checklist.
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

  // Highest score first: the most complete applications are the quickest to
  // decide. Oldest first within a score so nothing rots at the bottom.
  const sorted = [...rows].sort((a, b) => {
    const diff = (scores[b.id] ?? 0) - (scores[a.id] ?? 0);
    if (diff !== 0) return diff;
    return a.submitted_at.localeCompare(b.submitted_at);
  });

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          Applications
          {sorted.length > 0 && <Badge variant="destructive">{sorted.length}</Badge>}
        </h1>
        <p className="text-muted-foreground mt-1">
          Every person here was invited by a code your community issued. A human decides on
          each one — the score only changes what you see first.
        </p>
      </div>

      <ReviewQueueClient
        userId={userId}
        applications={sorted.map((r) => ({
          id: r.id,
          communityName: r.communities?.name ?? 'Unknown community',
          submittedAt: r.submitted_at,
          score: scores[r.id] ?? 0,
        }))}
        acceptsOverflow={settings?.accepts_overflow ?? false}
      />
    </div>
  );
}
