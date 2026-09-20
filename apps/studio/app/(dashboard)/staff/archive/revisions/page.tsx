import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/schema-availability';
import { Badge } from '@/components/ui/badge';
import { RevisionQueueClient } from './RevisionQueueClient';
import {
  ARCHIVE_REVISION_QUEUE_SELECT,
  revisionRowToItem,
  type ArchiveRevisionQueueRow,
} from '@/lib/archiveRevisionQueue';

export const dynamic = 'force-dynamic';

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Revision queue</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Member-proposed creates and edits to the Archive. Every write goes through
          staff-review-archive-revision on the service role — nothing here writes to
          archive_entries directly.
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

/**
 * A mod may not review her own submission. `archive_revisions_select_own_or_staff`
 * (096_archive_rls.sql) already lets her see it — RLS scopes who can read a row,
 * not whose decision is honest to make. The edge function enforces the refusal
 * server-side; excluding her own rows here as well means the queue never shows
 * a control that a click would only bounce off the server.
 */
export default async function StaffArchiveRevisionsPage() {
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

  const probe = await supabase.from('archive_revisions').select('id').limit(1);
  if (isMissingTable(probe.error)) {
    return (
      <PageShell>
        <div className="border rounded-lg p-6 space-y-1.5">
          <p className="font-medium">The Archive is not switched on for Roxy yet</p>
          <p className="text-sm text-muted-foreground max-w-prose">
            This queue is ready. The migration that creates archive_revisions has not been
            applied to this project yet.
          </p>
        </div>
      </PageShell>
    );
  }
  if (probe.error) {
    return (
      <PageShell>
        <ErrorBox>
          We could not load the revision queue. Reload the page — if it keeps failing, your
          session may have expired.
        </ErrorBox>
      </PageShell>
    );
  }

  const [pending, decided] = await Promise.all([
    supabase
      .from('archive_revisions')
      .select(ARCHIVE_REVISION_QUEUE_SELECT)
      .eq('status', 'pending')
      .neq('submitted_by', userId)
      .order('created_at', { ascending: true }),
    // Recently decided, for the "revert an applied revision" list. Same
    // self-moderation exclusion — she should not be offered a revert control
    // over an entry state that traces back to her own proposal.
    supabase
      .from('archive_revisions')
      .select(ARCHIVE_REVISION_QUEUE_SELECT)
      .eq('status', 'approved')
      .neq('submitted_by', userId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (pending.error || decided.error) {
    return (
      <PageShell>
        <ErrorBox>
          We could not load the revision queue. Reload the page — if it keeps failing, your
          session may have expired.
        </ErrorBox>
      </PageShell>
    );
  }

  const pendingItems = ((pending.data ?? []) as unknown as ArchiveRevisionQueueRow[]).map(
    revisionRowToItem,
  );
  const decidedItems = ((decided.data ?? []) as unknown as ArchiveRevisionQueueRow[]).map(
    revisionRowToItem,
  );

  return (
    <PageShell>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Pending review
          {pendingItems.length > 0 && <Badge variant="destructive">{pendingItems.length}</Badge>}
        </h2>
        <RevisionQueueClient mode="pending" revisions={pendingItems} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recently applied</h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Approved revisions. Reverting restores the entry to what it held before this
          revision was applied.
        </p>
        <RevisionQueueClient mode="decided" revisions={decidedItems} />
      </section>
    </PageShell>
  );
}
