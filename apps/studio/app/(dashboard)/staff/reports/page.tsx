import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaffPage } from '@/lib/staff-guard';
import { isMissingColumn } from '@/lib/schema-availability';
import { formatUtcDateTime } from '@/lib/dates';
import {
  REPORT_CONTENT_TYPES,
  REPORT_STATUSES,
  contentTypeLabel,
  parseReportFilters,
  type ReportFilters,
} from '@/lib/reports';
import { ReportsClient, type ReportView } from './ReportsClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports — Roxy Studio' };

const LIMIT = 100;
const PREVIEW_MAX = 280;

const BASE_COLUMNS =
  'id, reporter_id, reported_user_id, content_type, content_id, reason, detail, status, created_at';
const RESOLUTION_COLUMNS = ', resolved_at, resolved_by, resolution_note, resolution_action';

interface ReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  content_type: string;
  content_id: string | null;
  reason: string;
  detail: string | null;
  status: string;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  resolution_action?: string | null;
}

interface NameRow {
  id: string;
  display_name: string | null;
  username: string | null;
}

function nameOf(row: NameRow | undefined): string {
  if (!row) return 'Unknown member';
  const display = row.display_name?.trim();
  if (display) return display;
  return row.username ? `@${row.username}` : 'Unnamed member';
}

function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX)}…` : t;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Everything members report — posts, messages, profiles, rooms, speed dates and the
          Archive — in one queue. Resolving a report closes every other pending report about the
          same thing, and every decision is written to the audit log.
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

function filterHref(filters: ReportFilters, patch: Partial<ReportFilters>): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.status !== 'pending') params.set('status', next.status);
  if (next.type !== 'all') params.set('type', next.type);
  const qs = params.toString();
  return qs ? `/staff/reports?${qs}` : '/staff/reports';
}

function FilterBar({ filters }: { filters: ReportFilters }) {
  const statuses = [...REPORT_STATUSES, 'all'] as const;
  const types = ['all', ...REPORT_CONTENT_TYPES] as const;
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${
      active ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted/50'
    }`;
  return (
    <nav aria-label="Report filters" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground w-12">Status</span>
        {statuses.map((s) => (
          <Link
            key={s}
            href={filterHref(filters, { status: s })}
            className={chip(filters.status === s)}
            aria-current={filters.status === s ? 'page' : undefined}
          >
            {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground w-12">Type</span>
        {types.map((t) => (
          <Link
            key={t}
            href={filterHref(filters, { type: t })}
            className={chip(filters.type === t)}
            aria-current={filters.type === t ? 'page' : undefined}
          >
            {t === 'all' ? 'All types' : contentTypeLabel(t)}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export default async function StaffReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaffPage();
  const filters = parseReportFilters(await searchParams);
  const supabase = await createClient();

  const runQuery = (columns: string) => {
    let q = supabase
      .from('reports')
      .select(columns)
      .order('created_at', { ascending: filters.status === 'pending' })
      .limit(LIMIT);
    if (filters.status !== 'all') q = q.eq('status', filters.status);
    if (filters.type !== 'all') q = q.eq('content_type', filters.type);
    return q;
  };

  // Resolution columns arrive with migration 131. Before it, the queue still
  // reads (staff can see what is waiting) but cannot resolve.
  let resolutionLive = true;
  let res = await runQuery(BASE_COLUMNS + RESOLUTION_COLUMNS);
  if (isMissingColumn(res.error)) {
    resolutionLive = false;
    res = await runQuery(BASE_COLUMNS);
  }

  if (res.error) {
    return (
      <PageShell>
        <FilterBar filters={filters} />
        <ErrorBox>
          We could not load reports, so this is not an empty queue — it is an unknown one. Reload
          the page; if it keeps failing, your session may have expired.
        </ErrorBox>
      </PageShell>
    );
  }

  const rows = (res.data ?? []) as unknown as ReportRow[];

  const peopleIds = [
    ...new Set(rows.flatMap((r) => [r.reporter_id, r.reported_user_id, r.resolved_by ?? null]).filter(Boolean)),
  ] as string[];
  const idsOf = (type: string) =>
    [...new Set(rows.filter((r) => r.content_type === type && r.content_id).map((r) => r.content_id as string))];
  const postIds = idsOf('post');
  const entryIds = idsOf('archive_entry');
  const reviewIds = idsOf('archive_review');
  const roomIds = idsOf('room');
  const empty = Promise.resolve({ data: [] as unknown[], error: null });

  // Pending reports per target, across the whole table, so "3 reports on this
  // post" is true even when the list is filtered or truncated.
  const targetKeys = rows.filter((r) => r.content_id).map((r) => r.content_id as string);

  const [people, posts, entries, reviews, rooms, siblings] = await Promise.all([
    peopleIds.length
      ? supabase.from('profiles').select('id, display_name, username').in('id', peopleIds)
      : empty,
    postIds.length ? supabase.from('posts').select('id, content, deleted_at').in('id', postIds) : empty,
    entryIds.length ? supabase.from('archive_entries').select('id, title, status').in('id', entryIds) : empty,
    reviewIds.length ? supabase.from('archive_reviews').select('id, body, status').in('id', reviewIds) : empty,
    roomIds.length ? supabase.from('community_rooms').select('id, name, status').in('id', roomIds) : empty,
    targetKeys.length
      ? supabase
          .from('reports')
          .select('content_type, content_id')
          .eq('status', 'pending')
          .in('content_id', [...new Set(targetKeys)])
      : empty,
  ]);

  const names = new Map(((people.data ?? []) as NameRow[]).map((p) => [p.id, p]));
  const byId = <T extends { id: string }>(data: unknown) =>
    new Map(((data ?? []) as T[]).map((row) => [row.id, row]));
  const postMap = byId<{ id: string; content: string | null; deleted_at: string | null }>(posts.data);
  const entryMap = byId<{ id: string; title: string | null; status: string | null }>(entries.data);
  const reviewMap = byId<{ id: string; body: string | null; status: string | null }>(reviews.data);
  const roomMap = byId<{ id: string; name: string | null; status: string | null }>(rooms.data);
  const siblingCount = new Map<string, number>();
  for (const s of (siblings.data ?? []) as { content_type: string; content_id: string }[]) {
    const key = `${s.content_type}:${s.content_id}`;
    siblingCount.set(key, (siblingCount.get(key) ?? 0) + 1);
  }

  const items: ReportView[] = rows.map((r) => {
    let preview: string | null = null;
    let contentGone = false;
    const cid = r.content_id ?? '';
    if (r.content_type === 'post') {
      const p = postMap.get(cid);
      preview = clip(p?.content);
      contentGone = Boolean(p?.deleted_at);
    } else if (r.content_type === 'archive_entry') {
      const e = entryMap.get(cid);
      preview = clip(e?.title);
      contentGone = e?.status === 'hidden';
    } else if (r.content_type === 'archive_review') {
      const v = reviewMap.get(cid);
      preview = clip(v?.body);
      contentGone = v?.status === 'removed';
    } else if (r.content_type === 'room') {
      const m = roomMap.get(cid);
      preview = clip(m?.name);
      contentGone = m?.status === 'closed';
    }
    return {
      id: r.id,
      contentType: r.content_type,
      contentId: r.content_id,
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      createdLabel: formatUtcDateTime(r.created_at),
      reporterName: nameOf(names.get(r.reporter_id)),
      reportedName: nameOf(names.get(r.reported_user_id)),
      reportedUserId: r.reported_user_id,
      preview,
      contentGone,
      sameTargetPending: r.content_id ? (siblingCount.get(`${r.content_type}:${r.content_id}`) ?? 1) : 1,
      resolvedLabel: r.resolved_at ? formatUtcDateTime(r.resolved_at) : null,
      resolvedByName: r.resolved_by ? nameOf(names.get(r.resolved_by)) : null,
      resolutionNote: r.resolution_note ?? null,
      resolutionAction: r.resolution_action ?? null,
    };
  });

  const pendingShown = items.filter((i) => i.status === 'pending').length;

  return (
    <PageShell>
      <FilterBar filters={filters} />
      {!resolutionLive && (
        <ErrorBox>
          Resolving reports needs migration 131 on this database. You can read the queue, but the
          actions are switched off until it is applied.
        </ErrorBox>
      )}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {items.length === 0
          ? filters.status === 'pending'
            ? 'Nothing waiting. Every report has been dealt with.'
            : 'No reports match these filters.'
          : `${items.length}${items.length >= LIMIT ? '+' : ''} report${items.length === 1 ? '' : 's'}` +
            (pendingShown && filters.status !== 'pending' ? ` · ${pendingShown} pending` : '')}
      </p>
      {items.length > 0 && <ReportsClient reports={items} resolutionLive={resolutionLive} />}
    </PageShell>
  );
}
