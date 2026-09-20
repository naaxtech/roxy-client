import {
  ARCHIVE_REVISION_QUEUE_SELECT,
  revisionRowToItem,
} from '@/lib/archiveRevisionQueue';

/**
 * archive_revisions has two FKs onto profiles (submitted_by and reviewed_by).
 * An unhinted `profiles(...)` embed is PGRST201 and the Studio page renders
 * "We could not load the revision queue" — the same failure the mobile
 * catalogue already avoided with `profiles!archive_revisions_submitted_by_fkey`.
 */
describe('ARCHIVE_REVISION_QUEUE_SELECT', () => {
  it('names the submitted_by FK so PostgREST can embed the proposer', () => {
    expect(ARCHIVE_REVISION_QUEUE_SELECT).toMatch(
      /profiles!archive_revisions_submitted_by_fkey/,
    );
    expect(ARCHIVE_REVISION_QUEUE_SELECT).not.toMatch(/(?<!!)profiles\(/);
  });
});

describe('revisionRowToItem', () => {
  it('reads the hinted submitter embed, not an ambiguous profiles key', () => {
    const item = revisionRowToItem({
      id: 'r1',
      entry_id: 'e1',
      submitted_by: 'u1',
      patch: { summary: 'new' },
      prev: { summary: 'old' },
      kind: 'edit',
      status: 'pending',
      review_note: null,
      created_at: '2026-01-01T00:00:00Z',
      archive_entries: { title: 'Carol', slug: 'carol' },
      submitter: { display_name: 'Her' },
    });
    expect(item.submittedByName).toBe('Her');
    expect(item.entryTitle).toBe('Carol');
    expect(item.entrySlug).toBe('carol');
  });

  it('falls back when the proposer has no display name', () => {
    const item = revisionRowToItem({
      id: 'r2',
      entry_id: null,
      submitted_by: 'u2',
      patch: {},
      prev: null,
      kind: 'create',
      status: 'pending',
      review_note: null,
      created_at: '2026-01-01T00:00:00Z',
      archive_entries: null,
      submitter: { display_name: null },
    });
    expect(item.submittedByName).toBe('A member');
    expect(item.entryTitle).toBeNull();
  });
});
