'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { invokeFunction } from '@/lib/supabase/invokeFunction';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { formatUtcDateTime } from '@/lib/dates';
import { edgeFunctionErrorMessage } from '../revisions/RevisionQueueClient';

const MIN_NOTE = 10;

export interface ReportItem {
  id: string;
  reason: string;
  detail: string | null;
  contentType: string;
  contentId: string | null;
  createdAt: string;
  entryTitle: string | null;
  entryAlreadyHidden: boolean;
  reviewAlreadyRemoved: boolean;
  unresolvedContent: boolean;
}

const REASON_LABELS: Record<string, string> = {
  archive_spoiler: 'Spoiler',
  archive_bad_entry: 'Bad entry',
  archive_review_abuse: 'Review abuse',
};

type ReportAction = 'hide_entry' | 'remove_review' | 'dismiss';

/**
 * There is no `staff-resolve-archive-report` edge function yet — nothing in
 * apps/studio can write to archive_entries.status or archive_reviews.status
 * as staff (096_archive_rls.sql gives neither table a staff UPDATE policy;
 * every write goes through a service-role function), and `reports` itself has
 * no staff UPDATE policy either (008_safety.sql: "Admin updates handled via
 * service role key in edge functions"). This name follows the existing
 * staff-approve-business / staff-approve-product convention as the most
 * predictable name for whoever builds it. Until it exists every action below
 * fails honestly through edgeFunctionErrorMessage — it will not claim a
 * report was resolved when it was not.
 */
const RESOLVE_FUNCTION = 'staff-resolve-archive-report';

function ReportCard({
  report,
  busy,
  onAct,
}: {
  report: ReportItem;
  busy: boolean;
  onAct: (id: string, action: ReportAction, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const isEntry = report.contentType === 'archive_entry';
  const isReview = report.contentType === 'archive_review';

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="destructive">{REASON_LABELS[report.reason] ?? report.reason}</Badge>
            {report.entryAlreadyHidden && <Badge variant="secondary">Entry already hidden</Badge>}
            {report.reviewAlreadyRemoved && <Badge variant="secondary">Review already removed</Badge>}
          </div>
          <p className="text-sm font-medium">
            {isEntry
              ? (report.entryTitle ?? 'An Archive entry')
              : isReview
                ? `A review${report.entryTitle ? ` on ${report.entryTitle}` : ''}`
                : 'Reported content'}
          </p>
          <p className="text-xs text-muted-foreground">{formatUtcDateTime(report.createdAt)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Review'}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 pt-1">
          {report.detail && (
            <div className="rounded-md bg-muted/40 p-3">
              <p className="text-xs font-medium mb-1">Reporter&apos;s note</p>
              <p className="text-sm">{report.detail}</p>
            </div>
          )}

          {report.unresolvedContent && (
            <p className="text-sm text-muted-foreground">
              The reported content could not be found — it may already be deleted, or this
              report predates archive content-type support. You can still dismiss the report.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`report-note-${report.id}`} className="text-xs font-medium">
              Note — required for every action
            </Label>
            <Textarea
              id={`report-note-${report.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you decide, and why?"
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {isEntry && !report.entryAlreadyHidden && (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || note.trim().length < MIN_NOTE}
                onClick={() => {
                  if (
                    !confirm(
                      `Hide "${report.entryTitle ?? 'this entry'}"? It disappears from the Archive until a mod unhides it. This is logged.`,
                    )
                  ) {
                    return;
                  }
                  onAct(report.id, 'hide_entry', note.trim());
                }}
              >
                {busy ? 'Working…' : 'Hide entry'}
              </Button>
            )}
            {isReview && !report.reviewAlreadyRemoved && (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || note.trim().length < MIN_NOTE}
                onClick={() => {
                  if (!confirm('Remove this review? It will no longer be visible. This is logged.')) {
                    return;
                  }
                  onAct(report.id, 'remove_review', note.trim());
                }}
              >
                {busy ? 'Working…' : 'Remove review'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || note.trim().length < MIN_NOTE}
              onClick={() => onAct(report.id, 'dismiss', note.trim())}
            >
              {busy ? 'Working…' : 'Dismiss report'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReportsQueueClient({ reports }: { reports: ReportItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const act = async (reportId: string, action: ReportAction, note: string) => {
    if (note.length < MIN_NOTE) {
      setError('Every report decision needs a note of at least 10 characters.');
      return;
    }
    setBusyId(reportId);
    setError(null);
    const { error: err, status } = await invokeFunction(supabase, RESOLVE_FUNCTION, {
      report_id: reportId,
      action,
      note,
    });
    setBusyId(null);
    if (err) {
      setError(edgeFunctionErrorMessage(err, status));
      return;
    }
    router.refresh();
  };

  if (reports.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center space-y-1.5">
        <p className="font-medium">Nothing waiting</p>
        <p className="text-sm text-muted-foreground">No archive reports are pending.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      {reports.map((report) => (
        <ReportCard
          key={report.id}
          report={report}
          busy={busyId === report.id}
          onAct={(id, action, note) => void act(id, action, note)}
        />
      ))}
    </div>
  );
}
