'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { formatUtcDate } from '@/lib/dates';

const MIN_REJECT_NOTE = 10;

export interface MemberQueueItem {
  id: string;
  communityName: string;
  submittedAt: string;
  score: number;
}

/**
 * `decide_application` (071_invite_gate_scoring.sql) raises in Postgres
 * English. This turns its known failure modes into what a mod should actually
 * do next, the same way MembersClient's `roleErrorMessage` does for
 * `set_community_role`.
 */
export function decideApplicationErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already decided')) {
    return 'Someone else has already decided this application.';
  }
  if (m.includes('not authorised') || m.includes('not authorized')) {
    return 'You are not authorised to decide this application. Reload the page — your reviewer status may have changed.';
  }
  if (m.includes('at least 10 characters') || m.includes('requires a note')) {
    return 'A rejection needs a reason of at least 10 characters.';
  }
  return 'Could not save that decision. Please try again.';
}

interface BulkResult {
  succeeded: number;
  failed: { id: string; message: string }[];
}

export function MemberQueueClient({ applications }: { applications: MemberQueueItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const supabase = createClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  const allSelected = applications.length > 0 && selected.size === applications.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(applications.map((a) => a.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const decide = async (applicationId: string, decision: 'approved' | 'rejected') => {
    const note = (notes[applicationId] ?? '').trim();
    if (decision === 'rejected' && note.length < MIN_REJECT_NOTE) {
      setError('A rejection needs a reason of at least 10 characters.');
      return;
    }
    setBusy(applicationId);
    setError(null);
    setBulkResult(null);
    const { error: err } = await supabase.rpc('decide_application', {
      p_application_id: applicationId,
      p_decision: decision,
      p_note: note || null,
    });
    setBusy(null);
    if (err) {
      setError(decideApplicationErrorMessage(err.message));
      return;
    }
    setOpenId(null);
    startTransition(() => router.refresh());
  };

  const bulkApprove = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    setError(null);
    setBulkResult(null);

    const outcomes = await Promise.all(
      ids.map(async (id) => {
        const { error: err } = await supabase.rpc('decide_application', {
          p_application_id: id,
          p_decision: 'approved',
          p_note: null,
        });
        return { id, error: err };
      }),
    );

    setBulkBusy(false);
    const failed = outcomes
      .filter((o) => o.error)
      .map((o) => ({ id: o.id, message: decideApplicationErrorMessage(o.error!.message) }));
    const succeeded = outcomes.length - failed.length;

    setBulkResult({ succeeded, failed });
    setSelected(new Set());
    if (succeeded > 0) startTransition(() => router.refresh());
  };

  const bulkLabel = useMemo(() => {
    const n = selected.size;
    return n === 0 ? 'Approve selected' : `Approve ${n} selected`;
  }, [selected]);

  if (applications.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center space-y-1.5">
        <p className="font-medium">Nothing waiting</p>
        <p className="text-sm text-muted-foreground">No applications are pending right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border rounded-lg p-4">
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="select-all"
            checked={allSelected}
            onCheckedChange={toggleAll}
            aria-label="Select all applications"
          />
          <Label htmlFor="select-all" className="text-sm font-medium">
            {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
          </Label>
        </div>
        <Button size="sm" disabled={selected.size === 0 || bulkBusy} onClick={() => void bulkApprove()}>
          {bulkBusy ? 'Approving…' : bulkLabel}
        </Button>
      </div>

      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {bulkResult && (
        <div
          role="status"
          className={`border rounded-lg px-4 py-3 space-y-1 ${
            bulkResult.failed.length > 0 ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30'
          }`}
        >
          <p className="text-sm">
            Approved {bulkResult.succeeded} of {bulkResult.succeeded + bulkResult.failed.length}.
          </p>
          {bulkResult.failed.length > 0 && (
            <ul className="text-xs text-destructive space-y-0.5">
              {bulkResult.failed.map((f) => (
                <li key={f.id}>{f.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-3">
        {applications.map((app) => {
          const isOpen = openId === app.id;
          const isBusy = busy === app.id;
          return (
            <div key={app.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  className="mt-1"
                  checked={selected.has(app.id)}
                  onCheckedChange={() => toggleOne(app.id)}
                  aria-label={`Select application from ${app.communityName}`}
                />
                <div className="flex-1 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Application</span>
                      <Badge variant="secondary">Score {app.score}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Invited by {app.communityName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Waiting since {formatUtcDate(app.submittedAt)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenId(isOpen ? null : app.id)}
                  >
                    {isOpen ? 'Close' : 'Review'}
                  </Button>
                </div>
              </div>

              {isOpen && (
                <div className="space-y-3 pl-7">
                  <div className="space-y-1.5">
                    <Label htmlFor={`note-${app.id}`} className="text-xs font-medium">
                      Reason — required to reject
                    </Label>
                    <Textarea
                      id={`note-${app.id}`}
                      value={notes[app.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [app.id]: e.target.value }))}
                      placeholder="What led you to this decision?"
                      rows={3}
                      maxLength={2000}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={isBusy} onClick={() => void decide(app.id, 'approved')}>
                      {isBusy ? 'Saving…' : 'Approve'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isBusy}
                      onClick={() => void decide(app.id, 'rejected')}
                    >
                      {isBusy ? 'Saving…' : 'Reject'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
