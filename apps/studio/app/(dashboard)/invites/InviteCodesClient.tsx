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
import { endOfUtcDayInDays, formatUtcDate } from '@/lib/dates';
import {
  ADMIN_OPEN_CODE_CAP,
  codeState,
  memberStatusLabel,
  openCodeCount,
  type LedgerCode,
  type LedgerCodeState,
  type LedgerPerson,
} from '@/lib/inviteLedger';

export interface CommunityOption {
  id: string;
  name: string;
}

interface IssuedCode {
  code: string;
  communityName: string;
  forWhom: string | null;
  expiresAt: string | null;
}

interface InviteCodesClientProps {
  userId: string;
  /** Roxy staff: uncapped, and see every code. */
  isStaff: boolean;
  /** invite_code_quota_ok(): false once an admin has her cap of unused codes. */
  quotaOk: boolean;
  communities: CommunityOption[];
  codes: LedgerCode[];
  codesFailedToLoad: boolean;
  truncated: boolean;
  /** Fixed on the server so "expired" reads the same in the HTML and after hydration. */
  nowIso: string;
  /** Hide the create form (the community area lists codes; /invites mints). */
  readOnly?: boolean;
}

const LABEL_MAX = 80;

const STATE_TEXT: Record<LedgerCodeState, string> = {
  active: 'Active',
  locked: 'Locked',
  revoked: 'Revoked',
  expired: 'Expired',
  used: 'Used',
};

/** When a code stopped working, for the states where that is a specific moment. */
function stampFor(item: LedgerCode, state: LedgerCodeState): string | null {
  if (state === 'revoked') return item.revokedAt;
  if (state === 'locked') return item.lockedAt;
  return null;
}

/** Postgres speaks in constraint names. An admin should not have to. */
export function createErrorMessage(error: PostgrestError): string {
  if (error.code === '42501' || error.message.includes('row-level security')) {
    return 'Roxy refused that. Only Roxy staff, or an approved, active admin of this community, can create its codes.';
  }
  if (error.code === '23514') {
    // 134's cap trigger says it in words already ("You already have 10 unused codes…").
    if (/unused codes/i.test(error.message)) return error.message;
    return 'That did not fit what a code allows — check the note is under 80 characters.';
  }
  if (error.code === '23505') {
    return 'That code collided with an existing one. Try again — each attempt generates a fresh code.';
  }
  return 'Could not create that code. Please try again.';
}

function PersonLine({ person }: { person: LedgerPerson }) {
  return (
    <p className="text-foreground font-medium leading-tight">
      <span>{person.displayName ?? 'Unnamed'}</span>
      {person.username ? (
        <>
          {' '}
          <span className="text-muted-foreground font-normal">@{person.username}</span>
        </>
      ) : null}
    </p>
  );
}

export function InviteCodesClient({
  userId,
  isStaff,
  quotaOk,
  communities,
  codes,
  codesFailedToLoad,
  truncated,
  nowIso,
  readOnly = false,
}: InviteCodesClientProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const supabase = createClient();

  const [communityId, setCommunityId] = useState(communities[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [expiryDays, setExpiryDays] = useState('14');

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
  const myOpen = openCodeCount(codes, userId, now);
  const capReached = !isStaff && !quotaOk;

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    if (capReached) return;

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

    setCreating(true);
    // `code` is left out on purpose: the column DEFAULT is generate_invite_code()
    // (migration 070), where the entropy that makes the public validation
    // endpoint safe comes from. Every code is single use (134 refuses any other
    // max_uses), and the database enforces who may mint and the admin cap.
    const { data, error: insertError } = await supabase
      .from('invite_codes')
      .insert({
        community_id: community.id,
        created_by: userId,
        label: trimmedNote === '' ? null : trimmedNote,
        max_uses: 1,
        expires_at: endOfUtcDayInDays(Number(expiryDays)),
      })
      .select('code, expires_at')
      .single();
    setCreating(false);

    if (insertError) {
      setError(createErrorMessage(insertError));
      return;
    }

    const row = data as unknown as { code: string; expires_at: string | null };
    setIssued({
      code: row.code,
      communityName: community.name,
      forWhom: trimmedNote === '' ? null : trimmedNote,
      expiresAt: row.expires_at,
    });
    setStatus(`New code ${row.code} created for ${community.name}. Copy it before you leave this page.`);
    setNote('');
    startTransition(() => router.refresh());
  };

  const revoke = async (item: LedgerCode) => {
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
    setStatus(`Code ${item.code} is revoked. It will not let anyone in.`);
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-8">
      {/* ── Create ─────────────────────────────────────────────────────── */}
      {!readOnly && (
        <section className="border rounded-lg p-5 space-y-5" aria-labelledby="create-heading">
          <div>
            <h2 id="create-heading" className="text-lg font-semibold">
              Create a code
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">
              One code admits one woman, once. It puts her application in front of review, where a
              human still decides: a code opens the door to the queue, not to Roxy. Your name stays
              on the code, and hers joins it when she uses it.
            </p>
          </div>

          {isStaff ? (
            <p className="text-xs text-muted-foreground">Staff codes are not capped.</p>
          ) : capReached ? (
            <div
              role="alert"
              data-testid="invite-cap-reached"
              className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose"
            >
              <p className="text-sm text-destructive">
                You have {myOpen || ADMIN_OPEN_CODE_CAP} unused codes, the most an admin can hold
                at once. Revoke one you no longer need, or wait until one is used.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              You have {myOpen} unused {myOpen === 1 ? 'code' : 'codes'}. Admins can hold up to{' '}
              {ADMIN_OPEN_CODE_CAP} at once.
            </p>
          )}

          <form onSubmit={(event) => void create(event)} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
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
                  Who is it for?{' '}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={LABEL_MAX}
                  placeholder="Maya from book club"
                />
                <p className="text-xs text-muted-foreground">
                  Only you and Roxy staff see this. It is how you tell your codes apart.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="person-expiry">Expires</Label>
                <Select
                  id="person-expiry"
                  value={expiryDays}
                  onChange={(event) => setExpiryDays(event.target.value)}
                >
                  <option value="7">In 7 days</option>
                  <option value="14">In 14 days</option>
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Short is safer. You can always issue another.
                </p>
              </div>
            </div>

            <Button type="submit" disabled={creating || capReached}>
              {creating ? 'Creating…' : 'Create a code for her'}
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
                  One person, one use. Joins {issued.communityName}.{' '}
                  {issued.expiresAt ? `Expires ${formatUtcDate(issued.expiresAt)}.` : ''} Treat it
                  like a key: send it directly to her, never post it in public.
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setIssued(null)}>
                  I have sent it — hide the code
                </Button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Existing codes ─────────────────────────────────────────────── */}
      <section className="space-y-3" aria-labelledby="codes-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="codes-heading" className="text-lg font-semibold">
            {isStaff ? 'All codes' : 'Your codes'}{' '}
            <span className="text-sm font-normal text-muted-foreground">({activeCount} active)</span>
          </h2>
          {inactiveCount > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="show-inactive"
                checked={showInactive}
                onCheckedChange={(value) => setShowInactive(value === true)}
              />
              <Label htmlFor="show-inactive" className="text-sm font-normal">
                Show the {inactiveCount} revoked, expired and used
              </Label>
            </div>
          )}
        </div>

        {error && readOnly && (
          <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {codesFailedToLoad ? (
          <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
            <p className="text-sm text-destructive">
              The codes did not load, so nothing is listed here. This is a loading failure, not an
              empty list — reload the page before you assume a code is gone.
            </p>
          </div>
        ) : isRefreshing && visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Updating…</p>
        ) : visible.length === 0 ? (
          <div className="border rounded-lg p-8 text-center space-y-1.5">
            <p className="font-medium">{withState.length === 0 ? 'No codes yet' : 'No active codes'}</p>
            <p className="text-sm text-muted-foreground">
              {withState.length === 0
                ? 'Nobody can join through you until you create one. It takes about ten seconds.'
                : 'Every code here is revoked, expired or used.'}
            </p>
          </div>
        ) : (
          <>
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Invite codes, newest first, with who created each one and who used it.
                </caption>
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Code</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">For</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Community</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Created by</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Used by</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Expires</th>
                    <th scope="col" className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th scope="col" className="text-right px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map(({ item, state }) => {
                    const stoppedAt = stampFor(item, state);
                    const r = item.redeemer;
                    return (
                      <tr
                        key={item.id}
                        data-testid={`invite-row-${item.id}`}
                        className={state === 'active' ? '' : 'text-muted-foreground'}
                      >
                        <td className="px-4 py-3">
                          <code className="font-mono tracking-widest">{item.code}</code>
                          {item.kind !== 'invite' && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {item.kind === 'review' ? 'Store review' : 'Member code'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-[160px]">
                          {item.label ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">{item.communityName}</td>
                        <td className="px-4 py-3">
                          {item.minter ? (
                            <>
                              <PersonLine person={item.minter} />
                              <p className="text-xs text-muted-foreground">
                                {formatUtcDate(item.createdAt)}
                              </p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">Account erased</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r === null ? (
                            <p className="text-xs text-muted-foreground">Nobody yet</p>
                          ) : (
                            <>
                              {r.id ? (
                                <PersonLine person={r} />
                              ) : (
                                <p className="text-muted-foreground">Account erased</p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                {r.redeemedAt ? `Used ${formatUtcDate(r.redeemedAt)}` : 'Used'}
                              </p>
                              <p className="text-xs">{memberStatusLabel(r.status)}</p>
                              {r.lastSignInAt && (
                                <p className="text-xs text-muted-foreground">
                                  Last signed in {formatUtcDate(r.lastSignInAt)}
                                </p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {item.expiresAt ? formatUtcDate(item.expiresAt) : 'Never'}
                        </td>
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
                            {state === 'active' && (
                              <CopyButton value={item.code} ariaLabel={`Copy invite code ${item.code}`} />
                            )}
                            {!item.revokedAt &&
                              !item.used &&
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
              Revoking is immediate and permanent. A used code stays on this list with her name, so
              every member is traceable to the code and the person that brought her in.{' '}
              <strong>Locked</strong> means Roxy suspended the code after too many wrong guesses;
              revoke it and issue a fresh one.
              {!isStaff && ' Last sign-in is shown to the day.'}
              {truncated && ' Only the most recent 200 codes are shown.'}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
