'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const MIN_NOTE = 10;

interface QueueItem {
  id: string;
  communityName: string;
  submittedAt: string;
  score: number;
}

/**
 * The confidentiality undertaking.
 *
 * Not decoration: `can_review_application` returns false until
 * reviewer_agreement_at is set, so without this the queue is empty at the
 * database level, not just hidden in the UI.
 */
export function ReviewerAgreement({ userId }: { userId: string }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sign = async () => {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase
      .from('reviewer_settings')
      .upsert(
        { user_id: userId, reviewer_agreement_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    setSaving(false);
    if (err) {
      setError('Could not save that. Please try again.');
      return;
    }
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Before you review</h1>
      <div className="border rounded-lg p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Applications contain other women&apos;s legal names and identity check results. On a
          WLW platform that information can put someone in real danger if it leaves this
          screen.
        </p>
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1.5">
          <li>Every time you reveal a legal name, it is logged against your account.</li>
          <li>You may not screenshot, copy, forward or discuss an applicant&apos;s details
            outside this tool.</li>
          <li>You may not use anything you read here to contact someone outside Roxy.</li>
          <li>Decisions need a reason. So does a watchlist flag.</li>
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={sign} disabled={!accepted || saving}>
          {saving ? 'Saving…' : 'Start reviewing'}
        </Button>
      </div>
    </div>
  );
}

export function ReviewQueueClient({
  userId,
  applications,
  acceptsOverflow,
}: {
  userId: string;
  applications: QueueItem[];
  acceptsOverflow: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [overflow, setOverflow] = useState(acceptsOverflow);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const toggleOverflow = async (next: boolean) => {
    setOverflow(next);
    const { error: err } = await supabase
      .from('reviewer_settings')
      .upsert({ user_id: userId, accepts_overflow: next }, { onConflict: 'user_id' });
    if (err) {
      setOverflow(!next);
      setError('Could not change that setting.');
      return;
    }
    startTransition(() => router.refresh());
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
    if (decision === 'rejected' && note.length < MIN_NOTE) {
      setError('A rejection needs a reason of at least 10 characters.');
      return;
    }
    setBusy(applicationId);
    setError(null);
    const { error: err } = await supabase.rpc('decide_application', {
      p_application_id: applicationId,
      p_decision: decision,
      p_note: note || null,
    });
    setBusy(null);
    if (err) {
      setError(err.message.includes('already decided')
        ? 'Someone else has already decided this one.'
        : 'Could not save that decision. Please try again.');
      return;
    }
    startTransition(() => router.refresh());
  };

  const flagWatchlist = async (applicationId: string) => {
    const reason = (notes[applicationId] ?? '').trim();
    if (reason.length < MIN_NOTE) {
      setError('A watchlist flag needs a reason of at least 10 characters.');
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
      <div className="flex items-start gap-2.5 border rounded-lg p-4">
        <Checkbox
          id="overflow"
          checked={overflow}
          onCheckedChange={(v) => void toggleOverflow(v === true)}
        />
        <div className="space-y-1">
          <Label htmlFor="overflow" className="text-sm font-medium">
            Also review applications other communities haven&apos;t got to
          </Label>
          <p className="text-xs text-muted-foreground">
            Adds applications that have been waiting longer than the platform&apos;s overflow
            window. Nobody should sit in a queue because the admins who invited her went quiet.
          </p>
        </div>
      </div>

      {error && (
        <div className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {applications.length === 0 ? (
        <div className="border rounded-lg p-8 text-center space-y-1.5">
          <p className="font-medium">Nothing waiting</p>
          <p className="text-sm text-muted-foreground">
            {overflow
              ? 'No applications from your community, and nothing aged into the shared pool.'
              : 'No applications from your community right now.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => {
            const isOpen = openId === app.id;
            const revealed = names[app.id];
            return (
              <div key={app.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Application</span>
                      <Badge variant="secondary">Score {app.score}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Invited by {app.communityName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Waiting since {new Date(app.submittedAt).toLocaleDateString('en-US', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
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

                {isOpen && (
                  <div className="space-y-3 pt-1">
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

                    <div className="space-y-1.5">
                      <Label htmlFor={`note-${app.id}`} className="text-xs font-medium">
                        Reason — required to reject or flag
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
                        disabled={busy === app.id}
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
                      Approving joins her to {app.communityName} and sends her an email.
                      Rejecting starts a cooldown before she can apply again.
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
