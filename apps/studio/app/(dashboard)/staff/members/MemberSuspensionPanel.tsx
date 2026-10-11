'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LIFT_NOTE_MAX, SUSPEND_REASON_MAX, validateSuspension } from '@/lib/members';
import { todayUtcInputValue } from '@/lib/dates';
import { suspendMember, unsuspendMember } from './actions';

export function MemberSuspensionPanel({
  userId,
  name,
  suspended,
  viewerIsCore,
  isSelf,
}: {
  userId: string;
  name: string;
  suspended: boolean;
  viewerIsCore: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (result: { ok: true; message: string } | { ok: false; error: string }) => {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus(result.message);
    setReason('');
    setUntil('');
    setNote('');
    startTransition(() => router.refresh());
  };

  const onSuspend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const check = validateSuspension(reason, until);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      finish(await suspendMember(userId, reason, until));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onLift = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      finish(await unsuspendMember(userId, note));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || isRefreshing;

  return (
    <section aria-label="Suspension" className="border rounded-lg p-4 space-y-3">
      <h2 className="font-semibold">Suspension</h2>
      <div role="status" aria-live="polite" className="text-sm min-h-5">
        {status}
      </div>

      {isSelf ? (
        <p className="text-sm text-muted-foreground">This is your own account.</p>
      ) : suspended ? (
        viewerIsCore ? (
          <form onSubmit={(e) => void onLift(e)} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lift-note">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="lift-note"
                rows={2}
                maxLength={LIFT_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why it is lifted — appeal upheld, mistaken report…"
              />
            </div>
            <Button type="submit" size="sm" disabled={disabled}>
              {busy ? 'Lifting…' : 'Lift suspension'}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only core staff can lift a suspension — a second, senior pair of eyes.
          </p>
        )
      ) : (
        <form onSubmit={(e) => void onSuspend(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="suspend-reason">Reason</Label>
            <Textarea
              id="suspend-reason"
              rows={3}
              maxLength={SUSPEND_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What she did. Staff and the audit log see this, she does not."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suspend-until">
              End date <span className="font-normal text-muted-foreground">(optional, UTC)</span>
            </Label>
            <Input
              id="suspend-until"
              type="date"
              min={todayUtcInputValue()}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="max-w-48"
            />
            <p className="text-xs text-muted-foreground">Leave blank to suspend until core staff lift it.</p>
          </div>
          <Button type="submit" variant="destructive" size="sm" disabled={disabled} aria-label={`Suspend ${name}`}>
            {busy ? 'Suspending…' : 'Suspend'}
          </Button>
          <p className="text-xs text-muted-foreground max-w-prose">
            She is signed out on every device at once and cannot sign back in.
          </p>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
