'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { setMemberTag } from './actions';

const MAX_TAG = 24;

export interface TaggableMember {
  id: string;
  displayName: string | null;
  username: string | null;
  points: number;
  tag: string | null;
  setAt: string | null;
}

/**
 * One row per member on the leaderboard, with the tag inline.
 *
 * Editing in the row rather than behind a modal: a tag is two words, and the
 * job is comparing the ten of them against each other — which a dialog that
 * hides the other nine actively prevents.
 */
export function MemberTagClient({ members }: { members: TaggableMember[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (member: TaggableMember) => {
    const next = drafts[member.id] ?? member.tag ?? '';
    setSavingId(member.id);
    setErrors((e) => ({ ...e, [member.id]: '' }));
    startTransition(async () => {
      try {
        await setMemberTag(member.id, next);
        setDrafts((d) => {
          const rest = { ...d };
          delete rest[member.id];
          return rest;
        });
        router.refresh();
      } catch (e) {
        // The action's own sentences, which are written for a person. A
        // Postgres constraint message is not.
        setErrors((prev) => ({
          ...prev,
          [member.id]: e instanceof Error ? e.message : 'That did not save.',
        }));
      } finally {
        setSavingId(null);
      }
    });
  };

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No members on the board yet. Tags appear on Discover’s Top 10.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
      {members.map((member, i) => {
        const draft = drafts[member.id] ?? member.tag ?? '';
        const dirty = draft.trim() !== (member.tag ?? '').trim();
        const busy = pending && savingId === member.id;
        const error = errors[member.id];

        return (
          <li key={member.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="w-6 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {member.displayName ?? member.username ?? 'A member'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {member.username ? `@${member.username} · ` : ''}
                {member.points} {member.points === 1 ? 'point' : 'points'}
                {member.tag && member.setAt ? ' · tagged' : ''}
              </p>
            </div>

            {member.tag ? <Badge variant="secondary">{member.tag}</Badge> : null}

            <div className="flex items-center gap-2">
              <Input
                value={draft}
                maxLength={MAX_TAG}
                onChange={(e) => setDrafts((d) => ({ ...d, [member.id]: e.target.value }))}
                placeholder="Archivist"
                aria-label={`Tag for ${member.displayName ?? member.username ?? 'this member'}`}
                className="h-9 w-40"
                disabled={busy}
              />
              <Button
                size="sm"
                onClick={() => save(member)}
                disabled={!dirty || busy}
                aria-label={draft.trim() ? 'Save tag' : 'Clear tag'}
              >
                {busy ? 'Saving…' : draft.trim() ? 'Save' : 'Clear'}
              </Button>
            </div>

            {error ? (
              <p className="w-full text-xs text-destructive" role="alert">{error}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
