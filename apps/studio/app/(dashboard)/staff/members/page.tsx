import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/staff-guard';
import { isMissingFunction } from '@/lib/schema-availability';
import { formatUtcDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SEARCH_MAX,
  SEARCH_MIN,
  displayNameOf,
  vettingLabel,
  type MemberSearchRow,
} from '@/lib/members';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Members — Roxy Studio' };

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Find a member by name, @username, email or id. You see her standing, how often she has
          been reported, and whether she is suspended. Suspending signs her out everywhere; only
          core staff can lift it.
        </p>
      </div>
      {children}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose">
      <p className="text-sm text-destructive">{children}</p>
    </div>
  );
}

export default async function StaffMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireStaffPage();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';

  const form = (
    <form role="search" action="/staff/members" className="flex gap-2 max-w-xl">
      <label htmlFor="member-search" className="sr-only">
        Search members
      </label>
      <Input
        id="member-search"
        name="q"
        defaultValue={q}
        minLength={SEARCH_MIN}
        maxLength={SEARCH_MAX}
        placeholder="Name, @username, email or id"
        autoComplete="off"
      />
      <Button type="submit">Search</Button>
    </form>
  );

  if (q.length < SEARCH_MIN) {
    return (
      <PageShell>
        {form}
        <p className="text-sm text-muted-foreground">
          {q.length === 0 ? 'Type at least two characters to search.' : 'Type at least two characters.'}
        </p>
      </PageShell>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('staff_search_members', {
    p_query: q.replace(/^@/, '').slice(0, SEARCH_MAX),
    p_limit: 25,
  });

  if (error) {
    return (
      <PageShell>
        {form}
        <ErrorBox>
          {isMissingFunction(error)
            ? 'Member search needs migration 131 on this database. It has not been applied yet.'
            : 'The search failed, so this is not "no one found" — it is unknown. Reload and try again.'}
        </ErrorBox>
      </PageShell>
    );
  }

  const rows = (data ?? []) as MemberSearchRow[];

  return (
    <PageShell>
      {form}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {rows.length === 0
          ? `No one matches “${q}”.`
          : `${rows.length}${rows.length >= 25 ? '+' : ''} match${rows.length === 1 ? '' : 'es'}`}
      </p>
      {rows.length > 0 && (
        <ul className="divide-y border rounded-lg overflow-hidden">
          {rows.map((m) => (
            <li key={m.id}>
              <Link
                href={`/staff/members/${m.id}`}
                className="flex items-center gap-3 p-3 hover:bg-muted/40"
                aria-label={`Open ${displayNameOf(m)}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {displayNameOf(m)}
                    {m.username && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">@{m.username}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {vettingLabel(m.vetting_status)} · joined {formatUtcDate(m.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {m.suspended && <Badge variant="destructive">Suspended</Badge>}
                  {m.is_deleted && <Badge variant="outline">Deleted</Badge>}
                  {m.is_staff && <Badge variant="secondary">{m.staff_role === 'core' ? 'Core' : 'Staff'}</Badge>}
                  {Number(m.reports_pending) > 0 && (
                    <Badge variant="destructive">{Number(m.reports_pending)} pending reports</Badge>
                  )}
                  {Number(m.reports_total) > 0 && Number(m.reports_pending) === 0 && (
                    <Badge variant="outline">{Number(m.reports_total)} reports</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
