'use client';

import { useMemo, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { PostgrestError } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CopyButton } from '@/components/CopyButton';
import {
  endOfUtcDayInDays,
  endOfUtcDayIso,
  formatUtcDate,
  todayUtcInputValue,
} from '@/lib/dates';
import { accountKindLabel, type AccountKind } from '@/lib/accountKind';

export type InviteRedeemerView = {
  displayName: string;
  username: string | null;
  accountKind: AccountKind;
  usedAt: string;
};

export interface InviteCodeItem {
  id: string;
  code: string;
  communityName: string;
  label: string | null;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  redeemers: InviteRedeemerView[];
}

export interface CommunityOption {
  id: string;
  name: string;
}

interface IssuedCode {
  code: string;
  communityName: string;
  forWhom: string | null;
  singleUse: boolean;
  expiresAt: string | null;
}

interface InviteCodesClientProps {
  userId: string;
  communities: CommunityOption[];
  codes: InviteCodeItem[];
  codesFailedToLoad: boolean;
  truncated: boolean;
  /** Fixed on the server so "expired" reads the same in the HTML and after hydration. */
  nowIso: string;
}

type CodeState = 'active' | 'locked' | 'revoked' | 'expired' | 'used_up';

const LABEL_MAX = 80;

const STATE_TEXT: Record<CodeState, string> = {
  active: 'Active',
  locked: 'Locked',
  revoked: 'Revoked',
  expired: 'Expired',
  used_up: 'All used',
};

function codeState(item: InviteCodeItem, now: number): CodeState {
  if (item.revokedAt) return 'revoked';
  if (item.lockedAt) return 'locked';
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= now) return 'expired';
  if (item.maxUses !== null && item.usesCount >= item.maxUses) return 'used_up';
  return 'active';
}

/** When a code stopped working, for the states where that is a specific moment. */
function stampFor(item: InviteCodeItem, state: CodeState): string | null {
  if (state === 'revoked') return item.revokedAt;
  if (state === 'locked') return item.lockedAt;
  return null;
}

function usesText(item: InviteCodeItem): string {
  return item.maxUses === null
    ? `${item.usesCount} used, no limit`
    : `${item.usesCount} of ${item.maxUses} used`;
}

/** Postgres speaks in constraint names. An admin should not have to. */
function createErrorMessage(error: PostgrestError): string {
  if (error.code === '42501' || error.message.includes('row-level security')) {
    return 'Roxy refused that. You can only create codes for a community you administer.';
  }
  if (error.code === '23514') {
    return 'That did not fit what a code allows — check the note is under 80 characters and the number of uses is a whole number.';
  }
  if (error.code === '23505') {
    return 'That code collided with an existing one. Try again — each attempt generates a fresh code.';
  }
  return 'Could not create that code. Please try again.';
}

export function InviteCodesClient({
  userId,
  communities,
  codes,
  codesFailedToLoad,
  truncated,
  nowIso,
}: InviteCodesClientProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const supabase = createClient();

  const [mode, setMode] = useState<'person' | 'shareable'>('person');
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [personExpiryDays, setPersonExpiryDays] = useState('14');
  const [maxUsesInput, setMaxUsesInput] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const now = useMemo(() => new Date(nowIso).getTime(), [nowIso]);
  const withState = useMemo(
    () => codes.map((item) => ({ item, state: codeState(item, now) })),
    [codes, now],
  );
  const visible = showInactive ? withState : withState.filter((row) => row.state === 'active');
  const activeCount = withState.filter((row) => row.state === 'active').length;
  const inactiveCount = withState.length - activeCount;

  const resetForm = () => {
    setNote('');
    setMaxUsesInput('');
    setExpiryDate('');
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const community = communities.find((c) => c.id === communityId);
    if (!community) {
      setError('Choose which community this code invites her into.');
      return;
    }

    const trimmedNote = note.trim();
    if (trimmedNote.length > LABEL_MAX) {
      setError(`Keep the note under ${LABEL_MAX} characters.`);
      return;
    }

    let maxUses: number | null = 1;
    let expiresAt: string | null = endOfUtcDayInDays(Number(personExpiryDays));

    if (mode === 'shareable') {
      if (maxUsesInput.trim() === '') {
        maxUses = null;
      } else {
        const parsed = Number(maxUsesInput);
        if (!Number.isInteger(parsed) || parsed < 1) {
          setError('Number of uses has to be a whole number of 1 or more, or blank for no limit.');
          return;
        }
        maxUses = parsed;
      }

      if (expiryDate === '') {
        expiresAt = null;
      } else {
        expiresAt = endOfUtcDayIso(expiryDate);
        if (expiresAt === null) {
          setError('That expiry date could not be read. Pick it again.');
          return;
        }
      }
    }

    setCreating(true);
    // `code` is left out on purpose: the column DEFAULT is generate_invite_code()
    // (migration 070), which is where the entropy that makes the public
    // validation endpoint safe comes from. `is_review_code` is left out too —
    // only staff mint those, and RLS refuses the row if a client sends it true.
    const { data, error: insertError } = await supabase
      .from('invite_codes')
      .insert({
        community_id: community.id,
        created_by: userId,
        label: trimmedNote === '' ? null : trimmedNote,
        max_uses: maxUses,
        expires_at: expiresAt,
      })
      .select('code, max_uses, expires_at')
      .single();
    setCreating(false);

    if (insertError) {
      setError(createErrorMessage(insertError));
      return;
    }

    const row = data as unknown as {
      code: string;
      max_uses: number | null;
      expires_at: string | null;
    };

    setIssued({
      code: row.code,
      communityName: community.name,
      forWhom: trimmedNote === '' ? null : trimmedNote,
      singleUse: row.max_uses === 1,
      expiresAt: row.expires_at,
    });
    setStatus(`New code ${row.code} created for ${community.name}. Copy it before you leave this page.`);
    resetForm();
    startTransition(() => router.refresh());
  };

  const revoke = async (item: InviteCodeItem) => {
    setBusyId(item.id);
    setError(null);
    setStatus(null);
    const { error: updateError } = await supabase
      .from('invite_codes')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', item.id);
    setBusyId(null);

    if (updateError) {
      setError('Could not revoke that code. Please try again — it is still working until this succeeds.');
      return;
    }

    setConfirmingId(null);
    if (issued?.code === item.code) setIssued(null);
    setStatus(`Code ${item.code} is revoked. It will not let anyone in again.`);
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-8">
      {/* ── Create ─────────────────────────────────────────────────────── */}
      <section className="border rounded-lg p-5 space-y-5" aria-labelledby="create-heading">
        <div>
          <h2 id="create-heading" className="text-lg font-semibold">
            Create a code
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-prose">
            She enters it when she signs up. It puts her application in front of your community,
            where a human still decides — a code opens the door to the queue, not to Roxy.
          </p>
        </div>

        <form onSubmit={(event) => void create(event)} className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What kind of code?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label
                htmlFor="mode-person"
                className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${
                  mode === 'person' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                }`}
              >
                <input
                  type="radio"
                  id="mode-person"
                  name="code-mode"
                  value="person"
                  checked={mode === 'person'}
                  onChange={() => setMode('person')}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Invite one person</span>
                  <span className="block text-xs text-muted-foreground">
                    Single use. It stops working the moment she signs up, so it is worthless to
                    anyone she forwards it to.
                  </span>
                </span>
              </label>

              <label
                htmlFor="mode-shareable"
                className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${
                  mode === 'shareable' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                }`}
              >
                <input
                  type="radio"
                  id="mode-shareable"
                  name="code-mode"
                  value="shareable"
                  checked={mode === 'shareable'}
                  onChange={() => setMode('shareable')}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Shareable code</span>
                  <span className="block text-xs text-muted-foreground">
                    For a room you trust — an event, a group chat. Anyone holding it can use it
                    until it runs out.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="community">Community</Label>
              <Select
                id="community"
                value={communityId}
                onChange={(event) => setCommunityId(event.target.value)}
              >
                {communities.map((community) => (
                  <option key={community.id} value={community.id}>
                    {community.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Her application goes to this community, and she joins it when approved.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="note">
                {mode === 'person' ? 'Who is it for?' : 'What is it for?'}{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={LABEL_MAX}
                placeholder={mode === 'person' ? 'Maya from book club' : 'Pride picnic, June'}
              />
              <p className="text-xs text-muted-foreground">
                Only your admins see this. It is how you tell your codes apart later.
              </p>
            </div>

            {mode === 'person' ? (
              <div className="space-y-1.5">
                <Label htmlFor="person-expiry">Expires</Label>
                <Select
                  id="person-expiry"
                  value={personExpiryDays}
                  onChange={(event) => setPersonExpiryDays(event.target.value)}
                >
                  <option value="7">In 7 days</option>
                  <option value="14">In 14 days</option>
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A code that never expires is a key left under the mat. Short is safer — you can
                  always issue another.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="max-uses">
                    Number of uses{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="max-uses"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={maxUsesInput}
                    onChange={(event) => setMaxUsesInput(event.target.value)}
                    placeholder="Leave blank for no limit"
                  />
                  <p className="text-xs text-muted-foreground">
                    A cap is your undo button if a code travels further than you meant.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="expiry-date">
                    Expiry date{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="expiry-date"
                    type="date"
                    min={todayUtcInputValue()}
                    value={expiryDate}
                    onChange={(event) => setExpiryDate(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Works until the end of that day, UTC. Blank means it never expires.
                  </p>
                </div>
              </>
            )}
          </div>

          <Button type="submit" disabled={creating}>
            {creating ? 'Creating…' : mode === 'person' ? 'Create a code for her' : 'Create shareable code'}
          </Button>
        </form>

        {error && (
          <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div role="status" aria-live="polite">
          {status && !issued && <p className="text-sm text-muted-foreground">{status}</p>}
          {issued && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3">
              <p className="text-sm font-medium">
                Code created{issued.forWhom ? ` for ${issued.forWhom}` : ''} — send it to her
                yourself
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <code className="rounded-md bg-background border px-3 py-2 font-mono text-lg tracking-[0.35em]">
                  {issued.code}
                </code>
                <CopyButton value={issued.code} ariaLabel={`Copy invite code ${issued.code}`} />
              </div>
              <p className="text-xs text-muted-foreground max-w-prose">
                {issued.singleUse
                  ? 'One person, one use.'
                  : 'Anyone holding this can use it until it runs out.'}{' '}
                Joins {issued.communityName}.{' '}
                {issued.expiresAt
                  ? `Expires ${formatUtcDate(issued.expiresAt)}.`
                  : 'It does not expire, so revoke it when you are done with it.'}{' '}
                Treat it like a key: send it directly to her, never post it in public.
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIssued(null)}>
                I have sent it — hide the code
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* ── Existing codes ─────────────────────────────────────────────── */}
      <section className="space-y-3" aria-labelledby="codes-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="codes-heading" className="text-lg font-semibold">
            Your codes{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({activeCount} active)
            </span>
          </h2>
          {inactiveCount > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="show-inactive"
                checked={showInactive}
                onCheckedChange={(value) => setShowInactive(value === true)}
              />
              <Label htmlFor="show-inactive" className="text-sm font-normal">
                Show the {inactiveCount} revoked, expired and used-up
              </Label>
            </div>
          )}
        </div>

        {codesFailedToLoad ? (
          <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
            <p className="text-sm text-destructive">
              Your codes did not load, so nothing is listed here. This is a loading failure, not an
              empty list — reload the page before you assume a code is gone.
            </p>
          </div>
        ) : isRefreshing && visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Updating…</p>
        ) : visible.length === 0 ? (
          <div className="border rounded-lg p-8 text-center space-y-1.5">
            <p className="font-medium">
              {withState.length === 0 ? 'No codes yet' : 'No active codes'}
            </p>
            <p className="text-sm text-muted-foreground">
              {withState.length === 0
                ? 'Nobody can join your community until you create one. It takes about ten seconds.'
                : 'Every code you have made is revoked, expired or used up. Create another above.'}
            </p>
          </div>
        ) : (
          <>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Invite codes for the communities you administer, newest first.
                </caption>
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Code</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">For</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Community</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Used by</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Expires</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Created</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th scope="col" className="text-right px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map(({ item, state }) => {
                    const stoppedAt = stampFor(item, state);
                    return (
                    <tr key={item.id} className={state === 'active' ? '' : 'text-muted-foreground'}>
                      <td className="px-4 py-3">
                        <code className="font-mono tracking-widest">{item.code}</code>
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        {item.label ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">{item.communityName}</td>
                      <td className="px-4 py-3">
                        <p className="whitespace-nowrap">{usesText(item)}</p>
                        {item.redeemers.length === 0 ? (
                          <p className="text-xs text-muted-foreground mt-1">Nobody yet</p>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {item.redeemers.map((person) => (
                              <li key={`${item.id}-${person.username ?? person.displayName}-${person.usedAt}`}>
                                <p className="text-foreground font-medium leading-tight">
                                  {person.displayName}
                                  {person.username ? (
                                    <span className="text-muted-foreground font-normal">
                                      {' '}
                                      @{person.username}
                                    </span>
                                  ) : null}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {accountKindLabel(person.accountKind)}
                                  {' · '}
                                  {formatUtcDate(person.usedAt)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {item.expiresAt ? formatUtcDate(item.expiresAt) : 'Never'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatUtcDate(item.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            state === 'active'
                              ? 'secondary'
                              : state === 'locked'
                                ? 'destructive'
                                : 'outline'
                          }
                        >
                          {STATE_TEXT[state]}
                        </Badge>
                        {stoppedAt && (
                          <p className="text-xs text-muted-foreground mt-1 whitespace-nowrap">
                            {formatUtcDate(stoppedAt)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <CopyButton
                            value={item.code}
                            ariaLabel={`Copy invite code ${item.code}`}
                          />
                          {!item.revokedAt &&
                            (confirmingId === item.id ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => void revoke(item)}
                                  disabled={busyId === item.id}
                                >
                                  {busyId === item.id ? 'Revoking…' : 'Confirm'}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setConfirmingId(null)}
                                  disabled={busyId === item.id}
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirmingId(item.id)}
                                aria-label={`Revoke invite code ${item.code}`}
                              >
                                Revoke
                              </Button>
                            ))}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground max-w-prose">
              Revoking is immediate and permanent — anyone still holding that code is locked out,
              and members who already joined with it stay. <strong>Locked</strong> means Roxy
              suspended the code after too many wrong guesses; revoke it and issue a fresh one.
              {truncated && ' Only your most recent 200 codes are shown.'}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
