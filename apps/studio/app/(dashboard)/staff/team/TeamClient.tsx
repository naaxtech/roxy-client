'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QuickSearch } from '@/components/QuickSearch';
import { isMissingFunction } from '@/lib/schema-availability';
import { useDebouncedValue } from '@/lib/useDebouncedValue';

export type StaffKind = 'staff' | 'core';

export interface TeamMember {
  id: string;
  displayName: string | null;
  username: string | null;
  staffRole: StaffKind | null;
  isCommunityOwner?: boolean;
  vettingStatus?: string | null;
  createdLabel: string;
}

interface TeamClientProps {
  members: TeamMember[];
  roster: TeamMember[];
  truncated: boolean;
  initialQuery?: string;
}

export function setStaffRoleErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not authorised') || m.includes('not authorized')) {
    return 'You are not authorised to change staff. Only a Roxy core account can do that.';
  }
  if (m.includes('cannot change your own')) {
    return 'You cannot change your own staff role.';
  }
  if (m.includes('cannot change a core')) {
    return 'Roxy core accounts cannot be changed from Studio.';
  }
  if (m.includes('invalid staff role')) {
    return 'Staff is staff or none. Core is seeded, not assigned here.';
  }
  if (m.includes('profile not found')) {
    return 'That account no longer has a profile. Reload the page.';
  }
  return 'Could not change that member’s staff role. Please try again.';
}

export function setCommunityOwnerErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not authorised') || m.includes('not authorized')) {
    return 'You are not authorised to tag community owners. Only a Roxy core account can do that.';
  }
  if (m.includes('cannot tag a core')) {
    return 'Roxy core accounts cannot be tagged as community owners.';
  }
  if (m.includes('cannot tag staff')) {
    return 'Staff cannot be tagged as community owners. Remove staff first.';
  }
  if (m.includes('only approved members')) {
    return 'Only an approved member can be a community owner. Pending accounts stay pending.';
  }
  if (m.includes('profile not found')) {
    return 'That account no longer has a profile. Reload the page.';
  }
  return 'Could not change that community owner tag. Please try again.';
}

function memberName(member: TeamMember): string {
  return member.displayName ?? member.username ?? 'Member with a hidden profile';
}

export function TeamClient({
  members,
  roster,
  truncated,
  initialQuery = '',
}: TeamClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const supabase = createClient();

  const [query, setQuery] = useState(initialQuery);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const applySearch = (nextQuery = query) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set('q', nextQuery.trim());
    const qs = params.toString();
    router.replace(qs ? `/staff/team?${qs}` : '/staff/team');
  };
  const debouncedQuery = useDebouncedValue(query, 220);

  useEffect(() => {
    if (debouncedQuery.trim() === initialQuery.trim()) return;
    applySearch(debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const staff = useMemo(
    () => members.filter((m) => m.staffRole === 'staff' || m.staffRole === 'core'),
    [members],
  );

  const addable = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return roster.filter((m) => {
      if (m.staffRole) return false;
      const haystack = `${m.displayName ?? ''} ${m.username ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [roster, query]);

  const owners = useMemo(
    () => members.filter((m) => m.isCommunityOwner && !m.staffRole),
    [members],
  );

  const setRole = async (member: TeamMember, next: 'staff' | 'none') => {
    const name = memberName(member);
    setBusyId(member.id);
    setError(null);
    setStatus(null);

    const { error: rpcError } = await supabase.rpc('set_staff_role', {
      p_user_id: member.id,
      p_role: next,
    });
    setBusyId(null);

    if (rpcError) {
      if (isMissingFunction(rpcError)) {
        setError('Staff roles are not switched on in this database yet.');
        return;
      }
      setError(setStaffRoleErrorMessage(rpcError.message));
      return;
    }

    setStatus(
      next === 'staff'
        ? `${name} can now use Studio as staff.`
        : `${name} is no longer staff.`,
    );
    startTransition(() => router.refresh());
  };

  const setOwner = async (member: TeamMember, next: boolean) => {
    const name = memberName(member);
    setBusyId(member.id);
    setError(null);
    setStatus(null);

    const { error: rpcError } = await supabase.rpc('set_community_owner', {
      p_user_id: member.id,
      p_owner: next,
    });
    setBusyId(null);

    if (rpcError) {
      if (isMissingFunction(rpcError)) {
        setError('Community owner tags are not switched on in this database yet.');
        return;
      }
      setError(setCommunityOwnerErrorMessage(rpcError.message));
      return;
    }

    setStatus(
      next
        ? `${name} is now an official community — chat, members and Discover placement are on.`
        : `${name} is no longer an official community.`,
    );
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-6">
      <QuickSearch
        id="team-search"
        label="Find a member to make staff or a community owner"
        value={query}
        placeholder="Name or username"
        onChange={setQuery}
        onSubmit={applySearch}
      />

      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div role="status" aria-live="polite">
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </div>

      {query.trim() && addable.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Add staff</h2>
          <ul className="border rounded-lg divide-y">
            {addable.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{memberName(member)}</p>
                  {member.username && (
                    <p className="text-xs text-muted-foreground">@{member.username}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === member.id}
                    onClick={() => void setRole(member, 'staff')}
                    aria-label={`Make ${memberName(member)} staff`}
                  >
                    Make staff
                  </Button>
                  {!member.isCommunityOwner && (!member.vettingStatus || member.vettingStatus === 'approved') ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === member.id}
                      onClick={() => void setOwner(member, true)}
                      aria-label={`Make ${memberName(member)} a community owner`}
                    >
                      Make community owner
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {query.trim() && addable.length === 0 && roster.length > 0 && (
        <p className="text-sm text-muted-foreground">
          No member without a staff role matches that search.
        </p>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Everyone on the Roxy team</h2>
        {staff.length === 0 ? (
          <div className="border rounded-lg p-6 text-center space-y-1">
            <p className="font-medium">No staff tagged yet</p>
            <p className="text-sm text-muted-foreground">
              Search a member and make her staff. Core accounts are seeded, not assigned here.
            </p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Roxy core and staff accounts</caption>
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th scope="col" className="text-left px-4 py-2.5 font-medium">Member</th>
                  <th scope="col" className="text-left px-4 py-2.5 font-medium">Joined</th>
                  <th scope="col" className="text-left px-4 py-2.5 font-medium">Role</th>
                  <th scope="col" className="text-left px-4 py-2.5 font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {staff.map((member) => {
                  const name = memberName(member);
                  const busy = busyId === member.id;
                  return (
                    <tr key={member.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{name}</p>
                        {member.username && (
                          <p className="text-xs text-muted-foreground">@{member.username}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {member.createdLabel}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={member.staffRole === 'core' ? 'secondary' : 'outline'}>
                          {member.staffRole === 'core' ? 'Roxy core' : 'Staff'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {member.staffRole === 'core' ? (
                          <span className="text-xs text-muted-foreground">Seeded</span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void setRole(member, 'none')}
                            aria-label={`Remove staff from ${name}`}
                          >
                            Remove staff
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Community owners</h2>
        <p className="text-xs text-muted-foreground max-w-prose">
          Only chosen approved members. This opens community chat for them.
          It is never self-serve and staff or core cannot hold the tag.
        </p>
        {owners.length === 0 ? (
          <div className="border rounded-lg p-6 text-center space-y-1">
            <p className="font-medium">No community owners tagged</p>
            <p className="text-sm text-muted-foreground">
              Search an approved member and make her a community owner.
            </p>
          </div>
        ) : (
          <ul className="border rounded-lg divide-y">
            {owners.map((member) => {
              const name = memberName(member);
              return (
                <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-medium">{name}</p>
                    {member.username && (
                      <p className="text-xs text-muted-foreground">@{member.username}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId === member.id}
                    onClick={() => void setOwner(member, false)}
                    aria-label={`Remove community owner from ${name}`}
                  >
                    Remove owner
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the first 500 matches. Search to find someone who is not listed.
        </p>
      )}
    </div>
  );
}
