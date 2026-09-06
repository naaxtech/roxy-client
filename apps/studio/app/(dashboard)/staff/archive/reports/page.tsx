import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ReportsQueueClient, type ReportItem } from './ReportsQueueClient';

export const dynamic = 'force-dynamic';

/**
 * The three archive report reasons this queue exists for.
 *
 * These are NOT yet accepted anywhere upstream. `reports.reason`
 * (008_safety.sql) is CHECKed to
 * ('harassment','spam','inappropriate','hate_speech','other') — 094 widened
 * `content_type` for room/speed_date but never touched `reason`, and
 * `submit-report`'s REPORT_CONTENT_TYPES allowlist
 * (supabase/functions/submit-report/index.ts) still only lists
 * message/post/profile/room/speed_date. So today, nothing can insert a report
 * with any of these three reasons or an archive content_type.
 *
 * There is a second, independent gap underneath that: `reports` itself has no
 * staff SELECT policy at all (008_safety.sql grants only
 * `reporter_id = auth.uid()`), unlike `products`
 * (043_staff_product_select.sql's `products_select_staff`), so even a valid
 * archive report would be invisible to this RLS-scoped query today. This page
 * deliberately still reads through the ordinary session-bound client — the
 * same pattern every other staff queue in this app uses — rather than
 * introducing a service-role read as a one-off workaround; a
 * `reports_select_staff` policy in the shape of 043 is the fix, and it lives
 * in supabase/migrations, outside apps/studio. See this session's report to
 * the coordinator.
 */
const ARCHIVE_REASONS = ['archive_spoiler', 'archive_bad_entry', 'archive_review_abuse'] as const;
const ARCHIVE_CONTENT_TYPES = ['archive_entry', 'archive_review'] as const;

interface ReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  content_type: string;
  content_id: string | null;
  reason: string;
  detail: string | null;
  status: string;
  created_at: string;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Reports queue</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Spoilers, bad entries, and review abuse reported against the Archive.
        </p>
      </div>
      {children}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose">
      <p className="text-sm text-destructive">{children}</p>
    </div>
  );
}

export default async function StaffArchiveReportsPage() {
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

  const { data: reports, error } = await supabase
    .from('reports')
    .select('id, reporter_id, reported_user_id, content_type, content_id, reason, detail, status, created_at')
    .in('reason', ARCHIVE_REASONS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    return (
      <PageShell>
        <ErrorBox>
          We could not load the reports queue. Reload the page — if it keeps failing, your
          session may have expired.
        </ErrorBox>
      </PageShell>
    );
  }

  const rows = (reports ?? []) as ReportRow[];

  const entryIds = rows
    .filter((r) => r.content_type === 'archive_entry' && r.content_id)
    .map((r) => r.content_id as string);
  const reviewIds = rows
    .filter((r) => r.content_type === 'archive_review' && r.content_id)
    .map((r) => r.content_id as string);

  const [entriesRes, reviewsRes] = await Promise.all([
    entryIds.length > 0
      ? supabase.from('archive_entries').select('id, title, status').in('id', entryIds)
      : Promise.resolve({ data: [], error: null }),
    reviewIds.length > 0
      ? supabase.from('archive_reviews').select('id, body, status, entry_id').in('id', reviewIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const entriesById = new Map((entriesRes.data ?? []).map((e) => [e.id, e]));
  const reviewsById = new Map((reviewsRes.data ?? []).map((r) => [r.id, r]));

  const items: ReportItem[] = rows.map((r) => {
    const isEntry = r.content_type === 'archive_entry';
    const isReview = r.content_type === 'archive_review';
    const entry = isEntry && r.content_id ? entriesById.get(r.content_id) : undefined;
    const review = isReview && r.content_id ? reviewsById.get(r.content_id) : undefined;

    return {
      id: r.id,
      reason: r.reason,
      detail: r.detail,
      contentType: r.content_type,
      contentId: r.content_id,
      createdAt: r.created_at,
      entryTitle: entry?.title ?? null,
      entryAlreadyHidden: entry?.status === 'hidden',
      reviewAlreadyRemoved: review?.status === 'removed',
      // Neither the entry nor the review resolved — either content_type isn't
      // one this queue recognises yet, or the row was already deleted.
      unresolvedContent: !entry && !review,
    };
  });

  return (
    <PageShell>
      <div className="flex items-center gap-3 -mt-4">
        {items.length > 0 && <Badge variant="destructive">{items.length}</Badge>}
        <span className="text-sm text-muted-foreground">
          {items.length === 0 ? 'Nothing pending' : `${items.length} pending report${items.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <ReportsQueueClient reports={items} />
      <p className="text-xs text-muted-foreground max-w-prose">
        Looking for {ARCHIVE_CONTENT_TYPES.join(' / ')} reports and seeing nothing at all, even
        during active use of the app? The report submission path for the Archive may not be
        live yet — see this session&apos;s handoff notes.
      </p>
    </PageShell>
  );
}
