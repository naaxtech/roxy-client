'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { invokeFunction } from '@/lib/supabase/invokeFunction';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { formatUtcDateTime } from '@/lib/dates';
import { buildRevisionDiff } from '@/lib/archiveRevisionDiff';

const MIN_NOTE = 10;

export interface RevisionItem {
  id: string;
  entryId: string | null;
  entryTitle: string | null;
  entrySlug: string | null;
  submittedByName: string;
  patch: Record<string, unknown>;
  prev: Record<string, unknown> | null;
  kind: 'create' | 'edit';
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  createdAt: string;
}

type Decision = 'approved' | 'rejected';

/**
 * `staff-review-archive-revision`'s documented contract (per the build brief
 * this screen was written against) is `{revision_id, decision:
 * 'approved'|'rejected', review_note?}`. "Revert an applied revision" is not in
 * that contract — `archive_revision_status` (095_archive_core.sql) has no
 * 'reverted' value either. There is currently no server path that can restore
 * archive_entries to a revision's `prev` snapshot: archive_entries has no
 * staff UPDATE policy (096_archive_rls.sql — every write goes through a
 * service-role edge function), so this cannot be done as a direct client
 * write regardless.
 *
 * ASSUMPTION, pending confirmation from whoever finishes that edge function:
 * this sends decision: 'reverted' as the natural, minimal extension of the
 * same two-value enum, on the same endpoint. If the deployed function does not
 * recognise it, the request fails honestly (edgeFunctionErrorMessage below)
 * rather than claiming a revert that did not happen — it will not perform a
 * silent no-op.
 */
const REVERT_DECISION = 'reverted';

/** Maps invokeFunction's {error, status} to what a mod should see. */
export function edgeFunctionErrorMessage(error: string | null, status: number | undefined): string {
  if (!error) return '';
  if (status === 404) {
    return 'This action is not switched on for Roxy yet. Nothing was changed.';
  }
  return error;
}

function DiffTable({ revision }: { revision: RevisionItem }) {
  const rows = buildRevisionDiff(revision.patch, revision.prev, revision.kind);
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">This revision proposes no field changes.</p>;
  }
  return (
    <div className="border rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr className="border-b">
            <th className="text-left px-3 py-2 font-medium">Field</th>
            <th className="text-left px-3 py-2 font-medium">Current</th>
            <th className="text-left px-3 py-2 font-medium">Proposed</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.key} className={row.changed ? 'bg-primary/5' : undefined}>
              <td className="px-3 py-2 font-medium whitespace-nowrap">{row.label}</td>
              <td className="px-3 py-2 text-muted-foreground max-w-xs">
                {revision.kind === 'create' ? <span className="italic">new entry</span> : row.before}
              </td>
              <td className="px-3 py-2 max-w-xs font-medium">{row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevisionCard({
  revision,
  mode,
  onDecide,
  onRevert,
  busy,
}: {
  revision: RevisionItem;
  mode: 'pending' | 'decided';
  onDecide: (id: string, decision: Decision, note: string) => void;
  onRevert: (id: string, note: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">
              {revision.kind === 'create' ? 'New entry' : 'Edit'}
              {revision.entryTitle ? `: ${revision.entryTitle}` : ''}
            </span>
            <Badge variant="secondary">{revision.kind}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Proposed by {revision.submittedByName}</p>
          <p className="text-xs text-muted-foreground">{formatUtcDateTime(revision.createdAt)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : mode === 'pending' ? 'Review' : 'Details'}
        </Button>
      </div>

      {open && (
        <div className="space-y-3 pt-1">
          <DiffTable revision={revision} />

          {mode === 'pending' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`note-${revision.id}`} className="text-xs font-medium">
                  Review note — required to reject
                </Label>
                <Textarea
                  id={`note-${revision.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What led you to this decision?"
                  rows={3}
                  maxLength={2000}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => onDecide(revision.id, 'approved', note.trim())}>
                  {busy ? 'Saving…' : 'Approve'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    if (note.trim().length < MIN_NOTE) return;
                    onDecide(revision.id, 'rejected', note.trim());
                  }}
                >
                  {busy ? 'Saving…' : 'Reject'}
                </Button>
              </div>
            </>
          )}

          {mode === 'decided' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`revert-note-${revision.id}`} className="text-xs font-medium">
                  Reason for reverting — required
                </Label>
                <Textarea
                  id={`revert-note-${revision.id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why is this being undone?"
                  rows={3}
                  maxLength={2000}
                />
              </div>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || note.trim().length < MIN_NOTE}
                onClick={() => {
                  if (
                    !confirm(
                      `Revert this revision? "${revision.entryTitle ?? 'This entry'}" will go back to the state it held before this change was applied. This is logged.`,
                    )
                  ) {
                    return;
                  }
                  onRevert(revision.id, note.trim());
                }}
              >
                {busy ? 'Reverting…' : 'Revert to previous state'}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function RevisionQueueClient({
  mode,
  revisions,
}: {
  mode: 'pending' | 'decided';
  revisions: RevisionItem[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const decide = async (revisionId: string, decision: Decision, note: string) => {
    if (decision === 'rejected' && note.length < MIN_NOTE) {
      setError('A rejection needs a review note of at least 10 characters.');
      return;
    }
    setBusyId(revisionId);
    setError(null);
    const { error: err, status } = await invokeFunction(supabase, 'staff-review-archive-revision', {
      revision_id: revisionId,
      decision,
      review_note: note || undefined,
    });
    setBusyId(null);
    if (err) {
      setError(edgeFunctionErrorMessage(err, status));
      return;
    }
    startTransition(() => router.refresh());
  };

  const revert = async (revisionId: string, note: string) => {
    setBusyId(revisionId);
    setError(null);
    const { error: err, status } = await invokeFunction(supabase, 'staff-review-archive-revision', {
      revision_id: revisionId,
      decision: REVERT_DECISION,
      review_note: note,
    });
    setBusyId(null);
    if (err) {
      setError(edgeFunctionErrorMessage(err, status));
      return;
    }
    startTransition(() => router.refresh());
  };

  if (revisions.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center space-y-1.5">
        <p className="font-medium">Nothing here</p>
        <p className="text-sm text-muted-foreground">
          {mode === 'pending'
            ? 'No revisions are waiting for review.'
            : 'No revisions have been applied recently.'}
        </p>
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
      {revisions.map((revision) => (
        <RevisionCard
          key={revision.id}
          revision={revision}
          mode={mode}
          busy={busyId === revision.id}
          onDecide={(id, decision, note) => void decide(id, decision, note)}
          onRevert={(id, note) => void revert(id, note)}
        />
      ))}
    </div>
  );
}
