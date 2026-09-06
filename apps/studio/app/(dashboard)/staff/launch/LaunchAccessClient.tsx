'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isMissingFunction } from '@/lib/schema-availability';

export type AccessTier = 'public' | 'beta';

export interface LaunchMember {
  id: string;
  displayName: string | null;
  username: string | null;
  accessTier: AccessTier;
  vettingStatus: string | null;
  createdLabel: string;
}

interface LaunchAccessClientProps {
  members: LaunchMember[];
  truncated: boolean;
  initialQuery?: string;
  initialFilter?: 'all' | AccessTier;
}

/**
 * `set_access_tier` raises in Postgres English. Staff get a sentence that
 * says what to do next, the same way MembersClient maps `set_community_role`.
 */
export function setAccessTierErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not authorised') || m.includes('not authorized')) {
    return 'You are not authorised to change launch access. Reload the page — your staff status may have changed.';
  }
  if (m.includes('invalid access tier') || m.includes('invalid tier')) {
    return 'Launch access is public or beta. Nothing else can be saved.';
  }
  if (m.includes('profile not found')) {
    return 'That account no longer has a profile. Reload the page.';
  }
  return 'Could not change that member’s access. Please try again.';
}

function memberName(member: LaunchMember): string {
  return member.displayName ?? member.username ?? 'Member with a hidden profile';
}

export function LaunchAccessClient({
  members,
  truncated,
  initialQuery = '',
  initialFilter = 'all',
}: LaunchAccessClientProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const supabase = createClient();

  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<'all' | AccessTier>(initialFilter);

  const applySearch = (nextQuery = query, nextFilter = filter) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set('q', nextQuery.trim());
    if (nextFilter !== 'all') params.set('tier', nextFilter);
    const qs = params.toString();
    router.push(qs ? `/staff/launch?${qs}` : '/staff/launch');
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter((member) => {
      if (filter !== 'all' && member.accessTier !== filter) return false;
      if (needle === '') return true;
      const haystack = `${member.displayName ?? ''} ${member.username ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [members, query, filter]);

  const publicCount = members.filter((m) => m.accessTier === 'public').length;
  const betaCount = members.filter((m) => m.accessTier === 'beta').length;

  const setTier = async (member: LaunchMember, next: AccessTier) => {
    if (member.accessTier === next) return;
    const name = memberName(member);
    setBusyId(member.id);
    setError(null);
    setStatus(null);

    const { error: rpcError } = await supabase.rpc('set_access_tier', {
      p_user_id: member.id,
      p_tier: next,
    });
    setBusyId(null);

    if (rpcError) {
      if (isMissingFunction(rpcError)) {
        setError(
          'Launch access is not switched on for this project yet, so nothing was changed. This page will start working as soon as it is.',
        );
        return;
      }
      setError(setAccessTierErrorMessage(rpcError.message));
      return;
    }

    setStatus(
      next === 'beta'
        ? `${name} can now use the full app.`
        : `${name} is back on Archive and Roxy Official chat.`,
    );
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{publicCount} public</Badge>
        <Badge variant="secondary">{betaCount} beta</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="max-w-sm space-y-1.5 flex-1 min-w-[12rem]">
          <Label htmlFor="launch-search">Search members</Label>
          <Input
            id="launch-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applySearch();
            }}
            placeholder="Name or username"
          />
          <Button type="button" size="sm" variant="outline" onClick={() => applySearch()}>
            Search
          </Button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by launch access">
          {(['all', 'public', 'beta'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? 'default' : 'outline'}
              onClick={() => {
                setFilter(value);
                applySearch(query, value);
              }}
            >
              {value === 'all' ? 'All' : value === 'public' ? 'Public' : 'Beta'}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div role="status" aria-live="polite">
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </div>

      {filtered.length === 0 ? (
        <div className="border rounded-lg p-6 text-center space-y-1">
          <p className="font-medium">
            {members.length === 0 ? 'Nobody to tag' : 'No one matches that search'}
          </p>
          <p className="text-sm text-muted-foreground">
            {members.length === 0
              ? 'Members appear here once they have a profile. New accounts start as public.'
              : 'Try part of a name or username, or clear the filter.'}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Members and whether they can use the full app or the limited launch.
            </caption>
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th scope="col" className="text-left px-4 py-2.5 font-medium">Member</th>
                <th scope="col" className="text-left px-4 py-2.5 font-medium">Joined</th>
                <th scope="col" className="text-left px-4 py-2.5 font-medium">Verification</th>
                <th scope="col" className="text-left px-4 py-2.5 font-medium">Launch access</th>
                <th scope="col" className="text-left px-4 py-2.5 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((member) => {
                const busy = busyId === member.id;
                const name = memberName(member);
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
                    <td className="px-4 py-3 text-muted-foreground">
                      {member.vettingStatus === 'approved'
                        ? 'Verified'
                        : member.vettingStatus === 'pending'
                          ? 'Pending'
                          : member.vettingStatus === 'rejected'
                            ? 'Refused'
                            : 'Joined before verification'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={member.accessTier === 'beta' ? 'secondary' : 'outline'}>
                        {member.accessTier === 'beta' ? 'Beta' : 'Public'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {member.accessTier === 'public' ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          aria-label={`Open full app for ${name}`}
                          onClick={() => void setTier(member, 'beta')}
                        >
                          {busy ? 'Saving…' : 'Open full app'}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label={`Limit ${name} to Archive and Official chat`}
                          onClick={() => void setTier(member, 'public')}
                        >
                          {busy ? 'Saving…' : 'Limit to launch'}
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

      {truncated && (
        <p className="text-xs text-muted-foreground">
          Showing the first 500 members. Use the search box to find someone who is not listed.
        </p>
      )}
    </div>
  );
}
