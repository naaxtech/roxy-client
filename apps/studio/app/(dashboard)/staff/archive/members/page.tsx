import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ReviewerAgreement } from '@/app/(dashboard)/applications/ReviewQueueClient';
import { MemberQueueClient } from './MemberQueueClient';

export const dynamic = 'force-dynamic';

interface ApplicationRow {
  id: string;
  community_id: string;
  status: string;
  submitted_at: string;
  communities: { name: string } | null;
}

/**
 * Staff's member queue.
 *
 * This is deliberately NOT a second admission path. Every decision here goes
 * through the same `decide_application` RPC (071_invite_gate_scoring.sql) that
 * /applications already uses — a second path that could approve or reject an
 * applicant outside that RPC is exactly the kind of drift that made
 * `block_user` write a status nothing read.
 *
 * What this screen adds on top of /applications is scope and batching: staff
 * see every pending application platform-wide (can_review_application's
 * `me.is_staff` branch bypasses the community filter that scopes an ordinary
 * reviewer), and staff can bulk-approve. Bulk actions are approve-only —
 * decide_application requires a >= 10 character reason for a rejection, and a
 * reason typed once cannot honestly apply to a second applicant.
 *
 * The reviewer gate is not re-implemented here. `can_review_application`
 * requires the caller's OWN account to be vetted and to have signed the
 * confidentiality undertaking — staff included, no bypass — because
 * applications carry other women's legal names. Skipping that check here would
 * not skip it in the database; it would just turn an honest "sign the
 * agreement first" screen into a silently empty queue, which is the exact
 * failure 079's postmortem is about.
 */
export default async function StaffArchiveMembersPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff, vetting_status')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) notFound();

  if (profile.vetting_status !== 'approved') {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Member queue</h1>
        <div className="border rounded-lg p-6 space-y-2">
          <p className="font-semibold">Your own account needs to be verified first</p>
          <p className="text-sm text-muted-foreground">
            Deciding applications means reading other women&apos;s legal names and identity
            check results. Only accounts that have been through verification themselves can do
            it, staff included.
          </p>
        </div>
      </div>
    );
  }

  const { data: settings } = await supabase
    .from('reviewer_settings')
    .select('reviewer_agreement_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!settings?.reviewer_agreement_at) {
    return <ReviewerAgreement userId={userId} />;
  }

  const { data: applications, error } = await supabase
    .from('membership_applications')
    .select('id, community_id, status, submitted_at, communities(name)')
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });

  if (error) {
    return (
      <div className="max-w-5xl space-y-4">
        <h1 className="text-2xl font-bold">Member queue</h1>
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">
            We could not load pending applications. Reload the page — if it keeps failing, your
            session may have expired.
          </p>
        </div>
      </div>
    );
  }

  const rows = (applications ?? []) as unknown as ApplicationRow[];

  // Same scoring as /applications: a live sum over active criteria, computed
  // client-side from application_criteria_met so the queue never has to trust
  // a materialised number that editing a criterion's points would strand.
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

  const sorted = [...rows].sort((a, b) => {
    const diff = (scores[b.id] ?? 0) - (scores[a.id] ?? 0);
    if (diff !== 0) return diff;
    return a.submitted_at.localeCompare(b.submitted_at);
  });

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          Member queue
          {sorted.length > 0 && <Badge variant="destructive">{sorted.length}</Badge>}
        </h1>
        <p className="text-muted-foreground mt-1">
          Every pending application platform-wide — not just your own community&apos;s. Decisions
          go through the same reviewer RPC as Applications.
        </p>
      </div>

      <MemberQueueClient
        applications={sorted.map((r) => ({
          id: r.id,
          communityName: r.communities?.name ?? 'Unknown community',
          submittedAt: r.submitted_at,
          score: scores[r.id] ?? 0,
        }))}
      />
    </div>
  );
}
