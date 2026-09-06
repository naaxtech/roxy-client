import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/schema-availability';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatUtcDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/** archive_media_type (095_archive_core.sql). */
const MEDIA_TYPES = ['film', 'tv', 'book', 'comic', 'music'] as const;

const MEDIA_LABELS: Record<(typeof MEDIA_TYPES)[number], string> = {
  film: 'Film',
  tv: 'TV',
  book: 'Book',
  comic: 'Comic',
  music: 'Music',
};

/**
 * The >= 10 rule, restated here for the "below the gate" section's copy only.
 * The gate itself lives in the schema as `has_score` (095) — this constant
 * never decides anything, it only labels what the database already decided.
 */
const VOTE_GATE = 10;

interface EntrySummary {
  id: string;
  slug: string;
  title: string;
  media_type: string;
  vote_count: number;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">WLW Archive</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          What is in the Archive, what has not earned a public score yet, and what the
          community is voting on this week.
        </p>
        <div className="mt-3">
          <Button asChild variant="outline" size="sm">
            <Link href="/staff/archive/entries">Manage entries</Link>
          </Button>
        </div>
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

export default async function StaffArchiveDashboardPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) notFound();

  // Probe first. 095_archive_core.sql may not be applied to this project yet
  // (this branch's own progress ledger, .superpowers/sdd/wlw-archive/progress.md,
  // flags the migration as unverified against a live database) — a page that
  // queries archive_entries straight away would show every mod a blank "no
  // entries" dashboard indistinguishable from an Archive that is simply empty.
  const probe = await supabase.from('archive_entries').select('id').limit(1);
  if (isMissingTable(probe.error)) {
    return (
      <PageShell>
        <div className="border rounded-lg p-6 space-y-1.5">
          <p className="font-medium">The Archive is not switched on for Roxy yet</p>
          <p className="text-sm text-muted-foreground max-w-prose">
            This dashboard is ready. The database migration that creates it has not been
            applied to this project, so there is nothing to read yet — that is different from
            the Archive being empty. It will start working the moment the migration lands.
          </p>
        </div>
      </PageShell>
    );
  }
  if (probe.error) {
    return (
      <PageShell>
        <ErrorBox>
          We could not load the Archive. Reload the page — if it keeps failing, your session
          may have expired.
        </ErrorBox>
      </PageShell>
    );
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [typeCounts, belowGate, recentVotes] = await Promise.all([
    Promise.all(
      MEDIA_TYPES.map((type) =>
        supabase
          .from('archive_entries')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'published')
          .eq('media_type', type),
      ),
    ),
    supabase
      .from('archive_entries')
      .select('id, slug, title, media_type, vote_count')
      .eq('status', 'published')
      .eq('has_score', false)
      .order('vote_count', { ascending: false })
      .limit(20),
    // Capped: this only needs to identify which entries are trending, not
    // carry every vote cast this week for a large Archive.
    supabase.from('archive_votes').select('entry_id').gte('created_at', weekAgo).limit(5000),
  ]);

  const typeCountError = typeCounts.find((r) => r.error)?.error;
  if (typeCountError || belowGate.error || recentVotes.error) {
    return (
      <PageShell>
        <ErrorBox>
          We could not load the Archive dashboard. Reload the page — if it keeps failing, your
          session may have expired.
        </ErrorBox>
      </PageShell>
    );
  }

  const belowGateRows = (belowGate.data ?? []) as EntrySummary[];

  const voteTally = new Map<string, number>();
  for (const row of recentVotes.data ?? []) {
    const id = (row as { entry_id: string }).entry_id;
    voteTally.set(id, (voteTally.get(id) ?? 0) + 1);
  }
  const topEntryIds = [...voteTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  let topThisWeek: (EntrySummary & { weekVotes: number })[] = [];
  if (topEntryIds.length > 0) {
    const { data: topEntries, error: topError } = await supabase
      .from('archive_entries')
      .select('id, slug, title, media_type, vote_count')
      .in('id', topEntryIds)
      .eq('status', 'published');
    if (topError) {
      return (
        <PageShell>
          <ErrorBox>
            We could not load this week&apos;s top-voted entries. Reload the page — if it keeps
            failing, your session may have expired.
          </ErrorBox>
        </PageShell>
      );
    }
    const byId = new Map((topEntries ?? []).map((e) => [e.id, e as EntrySummary]));
    topThisWeek = topEntryIds
      .map((id) => byId.get(id))
      .filter((e): e is EntrySummary => Boolean(e))
      .map((e) => ({ ...e, weekVotes: voteTally.get(e.id) ?? 0 }));
  }

  return (
    <PageShell>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Entries by media type</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {MEDIA_TYPES.map((type, i) => (
            <div key={type} className="border rounded-lg p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">{typeCounts[i].count ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">{MEDIA_LABELS[type]}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Below the {VOTE_GATE}-vote gate
          {belowGateRows.length > 0 && <Badge variant="secondary">{belowGateRows.length}</Badge>}
        </h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Published entries that have not yet earned a public score. One person&apos;s opinion
          must never render as a percentage.
        </p>
        {belowGateRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every published entry has reached {VOTE_GATE} votes.
          </p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="text-left px-4 py-2.5 font-medium">Entry</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-right px-4 py-2.5 font-medium">Votes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {belowGateRows.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/staff/archive/entries/${entry.id}`} className="hover:underline">
                        {entry.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">
                      {entry.media_type}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {entry.vote_count} / {VOTE_GATE}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Top-voted this week</h2>
        {topThisWeek.length === 0 ? (
          <p className="text-sm text-muted-foreground">No votes cast in the last 7 days.</p>
        ) : (
          <ul className="space-y-2">
            {topThisWeek.map((entry, i) => (
              <li
                key={entry.id}
                className="border rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground w-5 text-right">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium">{entry.title}</p>
                    <p className="text-xs text-muted-foreground capitalize">{entry.media_type}</p>
                  </div>
                </div>
                <Badge variant="secondary">
                  {entry.weekVotes} vote{entry.weekVotes === 1 ? '' : 's'} this week
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Last refreshed {formatUtcDate(new Date().toISOString())}. Reload the page for current
        numbers.
      </p>
    </PageShell>
  );
}
