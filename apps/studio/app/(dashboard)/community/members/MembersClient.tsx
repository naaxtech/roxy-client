'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PostgrestError } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { isMissingFunction } from '@/lib/schema-availability';

export interface ManagedCommunity {
  id: string;
  name: string;
  /** The signed-in admin's own role here. Only 'admin' may change roles. */
  callerRole: string;
}

export interface MemberItem {
  communityId: string;
  userId: string;
  role: string;
  displayName: string | null;
  username: string | null;
  vettingStatus: string | null;
  joinedLabel: string;
}

interface MembersClientProps {
  currentUserId: string;
  communities: ManagedCommunity[];
  members: MemberItem[];
  roleManagementAvailable: boolean;
  truncated: boolean;
}

interface RoleOption {
  value: string;
  label: string;
  description: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  { value: 'member', label: 'Member', description: 'Takes part in the community. Nothing more.' },
  {
    value: 'moderator',
    label: 'Moderator',
    description: 'Keeps the community in order — posts, events, rooms.',
  },
  {
    value: 'border_patrol',
    label: 'Border patrol',
    description: 'Reviews applicants, including their legal names.',
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Everything: invite codes, roles, the community itself.',
  },
];

const ROLE_LABELS: Record<string, string> = {
  member: 'Member',
  moderator: 'Moderator',
  border_patrol: 'Border patrol',
  admin: 'Admin',
};

function memberKey(member: MemberItem): string {
  return `${member.communityId}:${member.userId}`;
}

function memberName(member: MemberItem): string {
  return member.displayName ?? member.username ?? 'Member with a hidden profile';
}

/**
 * set_community_role raises in Postgres English. An admin gets a sentence that
 * tells her what to do next instead.
 */
function roleErrorMessage(error: PostgrestError, name: string): string {
  if (isMissingFunction(error)) {
    return 'Changing roles is not switched on for Roxy yet, so nothing was changed. This page will start working as soon as it is.';
  }
  const message = error.message.toLowerCase();
  if (message.includes('at least one admin')) {
    return 'A community has to keep one admin, and that is currently the only one. Promote someone else to admin first, then change this role.';
  }
  if (message.includes('border patrol')) {
    return `Border patrol reads applicants' legal names, so ${name} has to finish her own verification in the Roxy app before she can take it.`;
  }
  if (message.includes('cannot be made an admin')) {
    return `${name} cannot be made an admin while her own account is unverified.`;
  }
  if (message.includes('only a community admin')) {
    return 'Only an admin of this community can change roles. Border patrol reviews applicants — it does not decide who else reviews them.';
  }
  if (message.includes('not a member of this community')) {
    return `${name} is not in this community any more. Reload the page to see who is.`;
  }
  if (message.includes('invalid role')) {
    return 'That is not a role this community has.';
  }
  return `Could not change ${name}'s role. Please try again.`;
}

export function MembersClient({
  currentUserId,
  communities,
  members,
  roleManagementAvailable,
  truncated,
}: MembersClientProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const supabase = createClient();

  const [query, setQuery] = useState('');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return members;
    return members.filter((member) => {
      const haystack = `${member.displayName ?? ''} ${member.username ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [members, query]);

  const changeRole = async (member: MemberItem, nextRole: string) => {
    const key = memberKey(member);
    const name = memberName(member);
    setBusyKey(key);
    setError(null);
    setStatus(null);

    // SECURITY DEFINER on purpose: community_members.role has no client UPDATE
    // path, so this RPC is the whole of role management and it does its own
    // authorisation. The UI below mirrors those rules; the database enforces them.
    const { error: rpcError } = await supabase.rpc('set_community_role', {
      p_community_id: member.communityId,
      p_user_id: member.userId,
      p_role: nextRole,
    });
    setBusyKey(null);

    if (rpcError) {
      setError(roleErrorMessage(rpcError, name));
      return;
    }

    setSelections((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setStatus(
      member.userId === currentUserId
        ? `You are now ${ROLE_LABELS[nextRole] ?? nextRole} in this community.`
        : `${name} is now ${ROLE_LABELS[nextRole] ?? nextRole}.`,
    );
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-6">
      {!roleManagementAvailable && (
        <div className="border rounded-lg p-4 space-y-1.5 bg-muted/30">
          <p className="text-sm font-medium">Changing roles is not available yet</p>
          <p className="text-sm text-muted-foreground max-w-prose">
            The screen is ready; Roxy has not switched role management on for this project. You
            can see everyone and what they hold right now, and the moment it is enabled the
            controls here start working. Nothing you do on this page will fail silently in the
            meantime.
          </p>
        </div>
      )}

      <div className="border rounded-lg p-4 space-y-1.5">
        <p className="text-sm font-medium">What border patrol means</p>
        <p className="text-sm text-muted-foreground max-w-prose">
          Border patrol is the only role besides admin that reviews the women applying to your
          community — which means reading an applicant&apos;s legal name and the result of her
          identity check. Every reveal is logged against the reviewer. Because of that, a member
          can only hold it once she has completed her own verification, and Roxy will refuse the
          change until she has.
        </p>
      </div>

      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="member-search">Search members</Label>
        <Input
          id="member-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or username"
        />
      </div>

      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div role="status" aria-live="polite">
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </div>

      {communities.map((community) => {
        const roster = filtered.filter((member) => member.communityId === community.id);
        const canManage = community.callerRole === 'admin' && roleManagementAvailable;

        return (
          <section key={community.id} className="space-y-3" aria-labelledby={`c-${community.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`c-${community.id}`} className="text-lg font-semibold">
                {community.name}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  ({roster.length} {roster.length === 1 ? 'member' : 'members'}
                  {query.trim() !== '' ? ' matching' : ''})
                </span>
              </h2>
              {community.callerRole !== 'admin' && (
                <p className="text-xs text-muted-foreground">
                  You are border patrol here — you can see roles, an admin changes them.
                </p>
              )}
            </div>

            {isRefreshing && roster.length === 0 ? (
              <p className="text-sm text-muted-foreground">Updating…</p>
            ) : roster.length === 0 ? (
              <div className="border rounded-lg p-6 text-center space-y-1">
                <p className="font-medium">
                  {query.trim() === '' ? 'Nobody here yet' : 'No one matches that search'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {query.trim() === ''
                    ? 'Invite someone with a code and she will appear here once her application is approved.'
                    : 'Try part of a name or username.'}
                </p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Members of {community.name} and the role each of them holds.
                  </caption>
                  <thead className="bg-muted/50">
                    <tr className="border-b">
                      <th scope="col" className="text-left px-4 py-2.5 font-medium">Member</th>
                      <th scope="col" className="text-left px-4 py-2.5 font-medium">Role now</th>
                      <th scope="col" className="text-left px-4 py-2.5 font-medium">Joined</th>
                      <th scope="col" className="text-left px-4 py-2.5 font-medium">
                        {canManage ? 'Change role' : 'Verification'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {roster.map((member) => {
                      const key = memberKey(member);
                      const selected = selections[key] ?? member.role;
                      const isSelf = member.userId === currentUserId;
                      const busy = busyKey === key;
                      const blockedFromPatrol =
                        selected === 'border_patrol' && member.vettingStatus !== 'approved';

                      return (
                        <tr key={key}>
                          <td className="px-4 py-3">
                            <p className="font-medium">
                              {memberName(member)}
                              {isSelf && (
                                <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                              )}
                            </p>
                            {member.username && (
                              <p className="text-xs text-muted-foreground">@{member.username}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={member.role === 'member' ? 'outline' : 'secondary'}>
                              {ROLE_LABELS[member.role] ?? member.role}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                            {member.joinedLabel}
                          </td>
                          <td className="px-4 py-3">
                            {canManage ? (
                              <div className="space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Label htmlFor={`role-${key}`} className="sr-only">
                                    Role for {memberName(member)}
                                  </Label>
                                  <Select
                                    id={`role-${key}`}
                                    className="w-44"
                                    value={selected}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setSelections((current) => ({
                                        ...current,
                                        [key]: event.target.value,
                                      }))
                                    }
                                  >
                                    {ROLE_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </Select>
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={selected === member.role || busy}
                                    onClick={() => void changeRole(member, selected)}
                                  >
                                    {busy ? 'Saving…' : 'Update role'}
                                  </Button>
                                </div>
                                {selected !== member.role && (
                                  <p className="text-xs text-muted-foreground max-w-xs">
                                    {ROLE_OPTIONS.find((o) => o.value === selected)?.description}
                                  </p>
                                )}
                                {blockedFromPatrol && (
                                  <p className="text-xs text-destructive max-w-xs">
                                    She has not completed her own verification, so Roxy will
                                    refuse border patrol for her.
                                  </p>
                                )}
                                {isSelf && selected !== member.role && (
                                  <p className="text-xs text-destructive max-w-xs">
                                    This changes your own role. Anything but admin and you lose
                                    this page.
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">
                                {member.vettingStatus === 'approved'
                                  ? 'Verified'
                                  : member.vettingStatus === 'pending'
                                    ? 'Verification in progress'
                                    : member.vettingStatus === 'rejected'
                                      ? 'Verification refused'
                                      : 'Joined before verification existed'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the first 500 members. Use the search box to find someone who is not listed.
        </p>
      )}
    </div>
  );
}
