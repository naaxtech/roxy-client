import { Analytics } from '../../lib/analytics';

/**
 * The Archive's events, and the funnel Jo will be asked for.
 *
 * The brief names ten events and one funnel: pending → first vote → approved →
 * first review. That funnel is the whole investment case for letting a pending
 * member into the Archive at all — it is how anyone finds out whether the
 * waiting room converts — so the events it is built from are pinned by name
 * here rather than left to whatever a screen happened to call them.
 *
 * The second thing these tests hold is that none of them carries PII. An
 * archive event is about a work, not about a woman: entry slugs and membership
 * status are safe, a display name or an entry title typed into search is not.
 */

const mockPh = jest.fn();
const mockLogEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/posthog', () => ({
  posthog: { capture: (...a: unknown[]) => mockPh(...a) },
}));

jest.mock('@react-native-firebase/analytics', () => () => ({
  logEvent: (...a: unknown[]) => mockLogEvent(...a),
  logScreenView: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockPh.mockClear();
  mockLogEvent.mockClear();
});

const captured = () => mockPh.mock.calls.map((c) => c[0] as string);
const props = () => (mockPh.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;

describe('archive analytics', () => {
  it('emits every event the brief names', () => {
    Analytics.archiveViewed();
    Analytics.archiveSearch(3);
    Analytics.archiveEntryViewed('carol');
    Analytics.archiveVoteCast('carol', true, 'pending');
    Analytics.archiveReviewPublished('carol');
    Analytics.archiveEntrySubmitted();
    Analytics.archiveEditSubmitted('carol');
    Analytics.archiveNoteAgreed('carol');
    Analytics.archiveWatchlistAdded('carol');
    Analytics.membershipApproved();

    expect(captured()).toEqual([
      'archive_viewed',
      'archive_search',
      'archive_entry_viewed',
      'archive_vote_cast',
      'archive_review_published',
      'archive_entry_submitted',
      'archive_edit_submitted',
      'archive_note_agreed',
      'archive_watchlist_added',
      'membership_approved',
    ]);
  });

  it('carries what the vote funnel needs, and only that: her membership state', () => {
    // This assertion used to demand `{ entry, value, membership_status }` — it
    // pinned the disclosure in place rather than catching it. The funnel is
    // about a membership state, never about which title she picked.
    Analytics.archiveVoteCast('carol', true, 'pending');
    expect(props()).toEqual({ membership_status: 'pending' });
  });

  it('counts search results instead of recording what she typed', () => {
    // A search query is free text a woman entered. It can hold a person's name,
    // a place, or something she would not want attached to her session.
    Analytics.archiveSearch(7);
    expect(props()).toEqual({ result_count: 7 });
    expect(JSON.stringify(props())).not.toMatch(/query|term|text/i);
  });

  it('identifies an entry by slug, never by title', () => {
    // A slug is a stable public identifier; a title is content, and titles are
    // how free text creeps into an event stream.
    Analytics.archiveEntryViewed('portrait-of-a-lady-on-fire');
    expect(props()).toEqual({ entry: 'portrait-of-a-lady-on-fire' });
  });

  it('never throws when the analytics backends are unavailable', () => {
    mockPh.mockImplementation(() => { throw new Error('posthog down'); });
    // Telemetry failing must never take a screen down with it. This module
    // already swallows for that reason; the test pins it.
    expect(() => Analytics.archiveViewed()).not.toThrow();
  });

  /**
   * An analytics event must not carry, against a stable identity, anything the
   * app's own schema keeps private to that person.
   *
   * Three of these did. `archive_votes`, `archive_watchlist` and
   * `archive_note_agreements` all carry `SELECT ... USING (profile_id =
   * auth.uid())` — the database will not disclose an individual row to anyone,
   * not even to a moderator of the community she is in — and the entry screen
   * promises her in as many words: "Your score is public as a number only."
   *
   * Meanwhile `Analytics.setUserId(hashUserId(id))` gives Firebase and PostHog
   * a STABLE per-woman identity, and these three events attached an entry slug
   * to it. The result was a per-person record, held by two vendors, of which
   * queer works she endorsed, which she meant to watch, and which content
   * warnings she agreed applied — a finer-grained record than Roxy's own
   * database will hand to anybody, on a WLW app where that inference is the
   * sensitive one.
   *
   * Nothing is lost by removing it. Per-entry popularity is already aggregated
   * in Postgres as `archive_entries.vote_count` / `up_count`, so the per-person
   * copy bought no answer the product did not already have.
   */
  const PRIVATE_TO_HER = ['archive_vote_cast', 'archive_watchlist_added', 'archive_note_agreed'];

  it.each(PRIVATE_TO_HER)('%s names no entry — the schema keeps that row private', (event) => {
    mockPh.mockClear();
    if (event === 'archive_vote_cast') Analytics.archiveVoteCast('carol', true, 'approved');
    if (event === 'archive_watchlist_added') Analytics.archiveWatchlistAdded('carol');
    if (event === 'archive_note_agreed') Analytics.archiveNoteAgreed('carol');

    const [name, payload] = mockPh.mock.calls[0] as [string, Record<string, unknown> | undefined];
    expect(name).toBe(event);
    expect(JSON.stringify(payload ?? {})).not.toContain('carol');
  });

  it('archive_vote_cast never says which way she voted', () => {
    mockPh.mockClear();
    Analytics.archiveVoteCast('carol', true, 'approved');
    const payload = (mockPh.mock.calls[0][1] ?? {}) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('value');
  });

  it('but archive_vote_cast KEEPS membership_status, which is the whole funnel', () => {
    // pending -> first vote -> approved -> first review is the investment case
    // for letting a pending member into the Archive at all. Stripping this
    // would answer the privacy question by deleting the product question.
    mockPh.mockClear();
    Analytics.archiveVoteCast('carol', true, 'pending');
    expect((mockPh.mock.calls[0][1] as Record<string, unknown>).membership_status).toBe('pending');
  });

  it('sends no more to Firebase than it sends to PostHog', () => {
    // Two vendors, one payload. A slug stripped from one and left in the other
    // is the same disclosure with half the evidence.
    mockPh.mockClear();
    mockLogEvent.mockClear();
    Analytics.archiveVoteCast('carol', true, 'approved');
    expect(JSON.stringify(mockLogEvent.mock.calls)).not.toContain('carol');
  });

  it('still names the entry on a review, which carries her name in public anyway', () => {
    // archive_reviews is readable by every member and the UI says so. Removing
    // the slug here would cost a real answer and protect nothing.
    mockPh.mockClear();
    Analytics.archiveReviewPublished('carol');
    expect((mockPh.mock.calls[0][1] as Record<string, unknown>).entry).toBe('carol');
  });
});
