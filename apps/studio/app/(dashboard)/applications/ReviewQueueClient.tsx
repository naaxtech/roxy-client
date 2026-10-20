'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApplicantContextPanel, type ReviewContext } from '@/components/gate/ApplicantContextPanel';
import {
  REJECTION_REASONS,
  TONE_CLASSES,
  decideErrorMessage,
  waitAge,
} from '@/lib/applicationQueue';

const MIN_NOTE = 10;

export interface QueueItem {
  id: string;
  communityName: string;
  /** When she sent it for review (membership_applications.ready_at). */
  readyAt: string;
  score: number;
}

/**
 * The confidentiality undertaking.
 *
 * Not decoration: `can_review_application` returns false until
 * reviewer_agreement_at is set, so without this the queue is empty at the
 * database level, not just hidden in the UI. Since 130 the signature goes
 * through `sign_reviewer_agreement()`, which refuses anyone staff have not made
 * a reviewer — a member can no longer sign herself into the queue (G-07).
 *
 * Takes no props: the function signs for auth.uid(), so a caller cannot sign
 * for somebody else (older call sites passed a userId; they were updated).
 */
export function ReviewerAgreement() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sign = async () => {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.rpc('sign_reviewer_agreement');
    setSaving(false);
    if (err) {
      setError(
        err.message.includes('not made you a reviewer')
          ? 'Roxy staff have not made you a reviewer yet.'
          : 'Could not save that. Please try again.',
      );
      return;
    }
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Before you review</h1>
      <div className="border rounded-lg p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Applications contain other women&apos;s personal details and identity check results.
          On a WLW platform that information can put someone in real danger if it leaves this
          screen.
        </p>
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1.5">
          <li>Every time a legal name is revealed, it is logged against your account.</li>
          <li>You may not screenshot, copy, forward or discuss an applicant&apos;s details
            outside this tool.</li>
          <li>You may not use anything you read here to contact someone outside Roxy.</li>
          <li>Rejections need a reason. So does a watchlist flag.</li>
        </ul>
        <div className="flex items-start gap-2.5">
          <Checkbox
            id="agree"
            checked={accepted}
            onCheckedChange={(v) => setAccepted(v === true)}
          />
          <Label htmlFor="agree" className="text-sm leading-snug font-normal">
            I understand, and I agree to handle applicant information this way.
          </Label>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={() => void sign()} disabled={!accepted || saving}>
          {saving ? 'Saving…' : 'Start reviewing'}
        </Button>
      </div>
    </div>
  );
}

type Loaded =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; ctx: ReviewContext };

export function ReviewQueueClient({
  applications,
  canRevealNames,
  now,
}: {
  applications: QueueItem[];
  /** Legal names are staff-only since 130 (reveal_applicant_legal_name). */
  canRevealNames: boolean;
  /** The server's clock, so the badge renders the same on server and client. */
  now?: Date | string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [contexts, setContexts] = useState<Record<string, Loaded>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const clock = now ? new Date(now) : new Date();
  const ages = new Map(applications.map((a) => [a.id, waitAge(a.readyAt, clock)]));
  const overdue = applications.filter((a) => ages.get(a.id)?.tone === 'overdue').length;
  const dueSoon = applications.filter((a) => ages.get(a.id)?.tone === 'due').length;

  const loadContext = async (applicationId: string) => {
    setContexts((c) => ({ ...c, [applicationId]: { state: 'loading' } }));
    const { data, error: err } = await supabase.rpc('application_review_context', {
      p_application_id: applicationId,
    });
    setContexts((c) => ({
      ...c,
      [applicationId]: err || !data
        ? { state: 'error' }
        : { state: 'ready', ctx: data as ReviewContext },
    }));
  };

  const toggle = (applicationId: string) => {
    if (openId === applicationId) {
      setOpenId(null);
      return;
    }
    setOpenId(applicationId);
    setError(null);
    const current = contexts[applicationId];
    if (!current || current.state === 'error') void loadContext(applicationId);
  };

  // The ONLY path to a legal name. It is a SECURITY DEFINER function that writes
  // an audit row before returning — there is no RLS policy that would let a
  // direct select reach this column.
  const revealName = async (applicationId: string) => {
    setBusy(applicationId);
    setError(null);
    const { data, error: err } = await supabase.rpc('reveal_applicant_legal_name', {
      app_id: applicationId,
    });
    setBusy(null);
    if (err) {
      setError('Could not retrieve that. The reveal was not recorded.');
      return;
    }
    setNames((n) => ({ ...n, [applicationId]: (data as string | null) ?? null }));
  };

  const decide = async (applicationId: string, decision: 'approved' | 'rejected') => {
    const note = (notes[applicationId] ?? '').trim();
    const reason = reasons[applicationId] ?? '';
    if (decision === 'rejected' && (note.length < MIN_NOTE || !reason)) {
      setError('A rejection needs a reason category and a note of at least 10 characters.');
      return;
    }
    setBusy(applicationId);
    setError(null);
    const { error: err } = await supabase.rpc('decide_application', {
      p_application_id: applicationId,
      p_decision: decision,
      p_note: note || null,
      p_reason: decision === 'rejected' ? reason : null,
    });
    setBusy(null);
    if (err) {
      setError(decideErrorMessage(err.message));
      return;
    }
    setOpenId(null);
    startTransition(() => router.refresh());
  };

  const flagWatchlist = async (applicationId: string) => {
    const reason = (notes[applicationId] ?? '').trim();
    if (reason.length < MIN_NOTE) {
      setError('A watchlist flag needs a note of at least 10 characters.');
      return;
    }
    setBusy(applicationId);
    setError(null);
    const { error: err } = await supabase
      .from('application_reviews')
      .upsert(
        { application_id: applicationId, watchlist: true, watchlist_reason: reason },
        { onConflict: 'application_id' },
      );
    setBusy(null);
    if (err) {
      setError('Could not save that flag.');
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-5">
      {applications.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {applications.length} waiting · {overdue} overdue · {dueSoon} due soon.
          Oldest first: we tell applicants most decisions land within 48 hours.
        </p>
      )}

      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {applications.length === 0 ? (
        <div className="border rounded-lg p-8 text-center space-y-1.5">
          <p className="font-medium">Nothing waiting</p>
          <p className="text-sm text-muted-foreground">
            Every application that has been sent for review is decided. New ones appear here
            the moment she presses &ldquo;Send for review&rdquo;.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => {
            const isOpen = openId === app.id;
            const age = ages.get(app.id) ?? waitAge(app.readyAt, clock);
            const loaded = contexts[app.id];
            const revealed = names[app.id];
            const note = (notes[app.id] ?? '').trim();
            const reason = reasons[app.id] ?? '';
            const canReject = note.length >= MIN_NOTE && reason.length > 0;
            return (
              <div
                key={app.id}
                data-testid={`application-${app.id}`}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Application</span>
                      <Badge
                        data-testid="wait-badge"
                        data-tone={age.tone}
                        variant="outline"
                        className={TONE_CLASSES[age.tone]}
                      >
                        {age.label}
                      </Badge>
                      <Badge variant="secondary">Score {app.score}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">Invited by {app.communityName}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => toggle(app.id)}>
                    {isOpen ? 'Close' : 'Review'}
                  </Button>
                </div>

                {isOpen && (
                  <div className="space-y-4 pt-1">
                    {(!loaded || loaded.state === 'loading') && (
                      <p className="text-sm text-muted-foreground">Loading her application…</p>
                    )}
                    {loaded?.state === 'error' && (
                      <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                        <p className="text-sm text-destructive">
                          Could not load this application. Your access may have changed.
                        </p>
                        <Button size="sm" variant="outline" onClick={() => void loadContext(app.id)}>
                          Try again
                        </Button>
                      </div>
                    )}
                    {loaded?.state === 'ready' && <ApplicantContextPanel ctx={loaded.ctx} />}

                    {canRevealNames && loaded?.state === 'ready' && loaded.ctx.legal_name_on_file && (
                      <div className="rounded-md bg-muted/40 p-3 space-y-2">
                        <p className="text-xs font-medium">Legal name</p>
                        {revealed === undefined ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void revealName(app.id)}
                            disabled={busy === app.id}
                          >
                            Reveal (this is logged)
                          </Button>
                        ) : (
                          <p className="text-sm">
                            {revealed ?? <span className="text-muted-foreground">Not provided</span>}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
                      <div className="space-y-1.5">
                        <Label htmlFor={`reason-${app.id}`} className="text-xs font-medium">
                          Reason category (to reject)
                        </Label>
                        <Select
                          id={`reason-${app.id}`}
                          value={reason}
                          onChange={(e) => setReasons((r) => ({ ...r, [app.id]: e.target.value }))}
                        >
                          <option value="">Choose…</option>
                          {REJECTION_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          She sees the category in plain words, never your note.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`note-${app.id}`} className="text-xs font-medium">
                          Private note for reviewers (required to reject or flag)
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
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => void decide(app.id, 'approved')}
                        disabled={busy === app.id}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void decide(app.id, 'rejected')}
                        disabled={busy === app.id || !canReject}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void flagWatchlist(app.id)}
                        disabled={busy === app.id}
                      >
                        Flag for watchlist
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Approving joins her to {app.communityName} and Roxy Official and emails her
                      that she&apos;s in. Rejecting emails her the reason category, the date she
                      can apply again and how to appeal. Every decision is written to the
                      permanent decision log.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
