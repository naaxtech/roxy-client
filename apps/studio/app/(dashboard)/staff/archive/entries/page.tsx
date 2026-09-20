import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/schema-availability';
import { ilikePattern } from '@/lib/ilikePattern';
import {
  parseArchiveEntryFilters,
  parseYearBound,
} from '@/lib/archiveFilters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArchiveEntriesFilters } from './ArchiveEntriesFilters';

export const dynamic = 'force-dynamic';

const LIMIT = 200;

interface EntryRow {
  id: string;
  slug: string;
  title: string;
  media_type: string;
  status: string;
  release_year: number | null;
  vote_count: number;
  creator: string | null;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Archive entries</h1>
          <p className="text-muted-foreground mt-1 max-w-prose">
            Add, edit and hide every work in the catalogue. Deleting one is possible and
            deliberately slow.
          </p>
        </div>
        <Button asChild>
          <Link href="/staff/archive/entries/new">Add entry</Link>
        </Button>
      </div>
      {children}
    </div>
  );
}

export default async function ArchiveEntriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  const params = await searchParams;
  const filters = parseArchiveEntryFilters(params);
  const pattern = ilikePattern(filters.q);
  const yearFrom = parseYearBound(filters.yearFrom);
  const yearTo = parseYearBound(filters.yearTo);

  let query = supabase
    .from('archive_entries')
    .select('id, slug, title, media_type, status, release_year, vote_count, creator')
    .limit(LIMIT);

  if (pattern) {
    query = query.or(
      `title.ilike.${pattern},creator.ilike.${pattern},slug.ilike.${pattern},summary.ilike.${pattern}`,
    );
  }
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.type) query = query.eq('media_type', filters.type);
  if (filters.score === 'scored') query = query.eq('has_score', true);
  if (filters.score === 'below') query = query.eq('has_score', false);
  if (filters.score === 'none') query = query.eq('vote_count', 0);
  if (filters.cover === 'yes') query = query.not('cover_url', 'is', null);
  if (filters.cover === 'no') query = query.is('cover_url', null);
  if (yearFrom != null) query = query.gte('release_year', yearFrom);
  if (yearTo != null) query = query.lte('release_year', yearTo);

  if (filters.sort === 'title') query = query.order('title', { ascending: true });
  else if (filters.sort === 'year') query = query.order('release_year', { ascending: false, nullsFirst: false });
  else if (filters.sort === 'votes') query = query.order('vote_count', { ascending: false });
  else query = query.order('updated_at', { ascending: false });

  const { data, error } = await query;
  if (isMissingTable(error)) {
    return (
      <PageShell>
        <p className="text-sm text-muted-foreground">
          The Archive is not switched on for this project yet.
        </p>
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell>
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 max-w-prose">
          <p className="text-sm text-destructive">
            We could not load the catalogue. Reload the page — if it keeps failing, your session
            may have expired.
          </p>
        </div>
      </PageShell>
    );
  }

  const rows = (data ?? []) as EntryRow[];

  return (
    <PageShell>
      <ArchiveEntriesFilters initial={filters} resultCount={rows.length} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entries match that.</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="text-left px-4 py-2.5 font-medium">Entry</th>
                <th className="text-left px-4 py-2.5 font-medium">Type</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">Votes</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/staff/archive/entries/${row.id}`}
                      className="font-medium hover:underline"
                    >
                      {row.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {row.release_year ?? '—'}
                      {row.creator ? ` · ${row.creator}` : ''}
                      {' · '}
                      {row.slug}
                    </p>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{row.media_type}</td>
                  <td className="px-4 py-3">
                    <Badge variant={row.status === 'published' ? 'default' : 'secondary'}>
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.vote_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
