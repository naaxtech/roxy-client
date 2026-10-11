'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { formatUtcDate } from '@/lib/dates';
import { TONE_CLASSES, rejectionReasonLabel, waitAge } from '@/lib/applicationQueue';

const MIN_NOTE = 10;

export interface AppealItem {
  id: string;
  applicationId: string;
  /** Her own words. */
  appeal: string;
  requestedAt: string;
  resolvedAt: string | null;
  outcome: 'upheld' | 'overturned' | string | null;
  communityName: string | null;
  /** The reason category she was rejected with. */
  rejectionReason: string | null;
}

export interface GrandfatheredItem {
  userId: string;
  displayName: string | null;
  username: string | null;
  joinedAt: string | null;
  reviewed: boolean;
}

/** resolve_appeal / review_grandfathered_member refusals (130), as sentences. */
export function appealErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already resolved')) return 'Someone else has already resolved this appeal.';
  if (m.includes('only roxy staff')) return 'Only Roxy staff reviewers who signed the agreement can do this.';
  if (m.includes('at least 10 characters')) return 'Write a note of at least 10 characters.';
  if (m.includes('not a grandfathered member')) return 'That account is not on the grandfathered list.';
  if (m.includes('not found')) return 'That appeal no longer exists. Reload the page.';
  return 'Could not save that. Please try again.';
}

/**
 * Appeals (G-12). One appeal per rejection, read by Roxy staff only.
 * Overturn approves her (joins her communities, emails "You're in" from the
 * status trigger). Uphold keeps the rejection and emails her the date she can
 * apply again. Both write the append-only decision log.
 */
export function AppealsClient({ appeals, now }: { appeals: AppealItem[]; now?: Date | string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();
  const clock = now ? new Date(now) : new Date();

  const open = appeals.filter((a) => !a.resolvedAt);
  const resolved = appeals.filter((a) => a.resolvedAt);

  const resolve = async (appeal: AppealItem, outcome: 'upheld' | 'overturned') => {
    const note = (notes[appeal.id] ?? '').trim();
    if (note.length < MIN_NOTE) {
      setError('Write a note of at least 10 characters.');
      return;
    }
    const question = outcome === 'overturned'
      ? 'Overturn the rejection? She will be approved, joined to her community and emailed that she’s in.'
      : 'Uphold the rejection? She will be emailed that the decision stands and when she can apply again.';
    if (!window.confirm(question)) return;
    setBusy(appeal.id);
    setError(null);
    const { error: err } = await supabase.rpc('resolve_appeal', {
      p_appeal_id: appeal.id,
      p_outcome: outcome,
      p_note: note,
    });
    setBusy(null);
    if (err) {
      setError(appealErrorMessage(err.message));
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {open.length === 0 ? (
        <div className="border rounded-lg p-8 text-center space-y-1.5">
          <p className="font-medium">No open appeals</p>
          <p className="text-sm text-muted-foreground">
            When a rejected applicant appeals, it lands here and every staff reviewer gets an email.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {open.map((a) => {
            const age = waitAge(a.requestedAt, clock);
            const note = (notes[a.id] ?? '').trim();
            const ready = note.length >= MIN_NOTE && busy !== a.id;
            return (
              <li key={a.id} data-testid={`appeal-${a.id}`} className="border rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Appeal</span>
                  <Badge
                    data-testid="wait-badge"
                    data-tone={age.tone}
                    variant="outline"
                    className={TONE_CLASSES[age.tone]}
                  >
                    {age.label}
                  </Badge>
                  {a.communityName && (
                    <span className="text-sm text-muted-foreground">Invited by {a.communityName}</span>
                  )}
                </div>
                <dl className="space-y-1.5 text-sm">
                  <div className="grid grid-cols-[8.5rem_1fr] gap-3">
                    <dt className="text-muted-foreground">Rejected for</dt>
                    <dd>{rejectionReasonLabel(a.rejectionReason) || 'No category recorded'}</dd>
                  </div>
                  <div className="grid grid-cols-[8.5rem_1fr] gap-3">
                    <dt className="text-muted-foreground">Her appeal</dt>
                    <dd className="whitespace-pre-wrap">{a.appeal}</dd>
                  </div>
                  <div className="grid grid-cols-[8.5rem_1fr] gap-3">
                    <dt className="text-muted-foreground">Sent</dt>
                    <dd>{formatUtcDate(a.requestedAt)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Her full application and decision history are in the{' '}
                  <a className="underline" href="/applications">review tools</a> context for this
                  application; reviewer notes stay private.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor={`appeal-note-${a.id}`} className="text-xs font-medium">
                    Note for the decision log (required, at least 10 characters)
                  </Label>
                  <Textarea
                    id={`appeal-note-${a.id}`}
                    value={notes[a.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                    rows={3}
                    maxLength={2000}
                    placeholder="What did you check, and what decided it?"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void resolve(a, 'overturned')} disabled={!ready}>
                    Overturn and approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resolve(a, 'upheld')}
                    disabled={!ready}
                  >
                    Uphold rejection
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {resolved.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Resolved</h2>
          <ul className="divide-y border rounded-lg">
            {resolved.map((a) => (
              <li
                key={a.id}
                data-testid={`appeal-${a.id}`}
                className="p-3 text-sm flex items-center justify-between gap-3"
              >
                <span>
                  {a.outcome === 'overturned' ? 'Overturned (approved)' : 'Rejection upheld'}
                  {a.communityName ? ` · ${a.communityName}` : ''}
                </span>
                <time className="text-xs text-muted-foreground">
                  {a.resolvedAt ? formatUtcDate(a.resolvedAt) : ''}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Members who joined before the gate (G-23). 130 grandfathered them to
 * approved with a decision-log row each; reviewing them is optional. Keeping
 * records that someone looked; sending to the waiting room needs a note and
 * puts her back to pending, so she applies with a code like anyone else.
 */
export function GrandfatheredList({ members }: { members: GrandfatheredItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const review = async (m: GrandfatheredItem, keep: boolean) => {
    const note = (notes[m.userId] ?? '').trim();
    if (!keep) {
      if (note.length < MIN_NOTE) {
        setError('Sending someone to the waiting room needs a note of at least 10 characters.');
        return;
      }
      if (!window.confirm('Send her back to the waiting room? She loses member access until she is approved through an application.')) {
        return;
      }
    }
    setBusy(m.userId);
    setError(null);
    const { error: err } = await supabase.rpc('review_grandfathered_member', {
      p_user_id: m.userId,
      p_keep: keep,
      p_note: note || null,
    });
    setBusy(null);
    if (err) {
      setError(appealErrorMessage(err.message));
      return;
    }
    startTransition(() => router.refresh());
  };

  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody was grandfathered.</p>;
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      <ul className="space-y-2">
        {members.map((m) => {
          const note = (notes[m.userId] ?? '').trim();
          return (
            <li
              key={m.userId}
              data-testid={`grandfathered-${m.userId}`}
              className="border rounded-lg p-3 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.displayName ?? m.username ?? 'Member'}</span>
                  {m.username && <span className="text-xs text-muted-foreground">@{m.username}</span>}
                  {m.reviewed ? (
                    <Badge variant="secondary">Reviewed</Badge>
                  ) : (
                    <Badge variant="outline">Review optional</Badge>
                  )}
                </div>
                {m.joinedAt && (
                  <span className="text-xs text-muted-foreground">Joined {formatUtcDate(m.joinedAt)}</span>
                )}
              </div>
              {!m.reviewed && (
                <div className="space-y-2">
                  <Label htmlFor={`gf-note-${m.userId}`} className="sr-only">
                    Note (required to send to the waiting room)
                  </Label>
                  <Textarea
                    id={`gf-note-${m.userId}`}
                    value={notes[m.userId] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [m.userId]: e.target.value }))}
                    rows={2}
                    maxLength={2000}
                    placeholder="Note (optional to keep, required to send to the waiting room)"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void review(m, true)}
                      disabled={busy === m.userId}
                    >
                      Keep as member
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void review(m, false)}
                      disabled={busy === m.userId || note.length < MIN_NOTE}
                    >
                      Send to the waiting room
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
