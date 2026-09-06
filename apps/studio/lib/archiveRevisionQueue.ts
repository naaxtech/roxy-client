import type { RevisionItem } from '@/app/(dashboard)/staff/archive/revisions/RevisionQueueClient';

/**
 * The queue select. `archive_revisions` has two FKs onto profiles
 * (`submitted_by`, `reviewed_by`). An unhinted `profiles(...)` embed is
 * PGRST201 and the page used to render a generic load failure.
 *
 * The hint is the same one the mobile catalogue already uses
 * (`apps/mobile/lib/archive.ts`).
 */
export const ARCHIVE_REVISION_QUEUE_SELECT =
  'id, entry_id, submitted_by, patch, prev, kind, status, review_note, created_at, archive_entries(title, slug), submitter:profiles!archive_revisions_submitted_by_fkey(display_name)';

export type ArchiveRevisionQueueRow = {
  id: string;
  entry_id: string | null;
  submitted_by: string;
  patch: Record<string, unknown>;
  prev: Record<string, unknown> | null;
  kind: 'create' | 'edit';
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  created_at: string;
  archive_entries: { title: string; slug: string } | { title: string; slug: string }[] | null;
  submitter: { display_name: string | null } | { display_name: string | null }[] | null;
};

function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function revisionRowToItem(row: ArchiveRevisionQueueRow): RevisionItem {
  const entry = embedOne(row.archive_entries);
  const submitter = embedOne(row.submitter);
  return {
    id: row.id,
    entryId: row.entry_id,
    entryTitle: entry?.title ?? null,
    entrySlug: entry?.slug ?? null,
    submittedByName: submitter?.display_name ?? 'A member',
    patch: row.patch ?? {},
    prev: row.prev,
    kind: row.kind,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}
