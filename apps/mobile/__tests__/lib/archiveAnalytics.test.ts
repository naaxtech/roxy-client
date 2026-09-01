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

  it('carries what the vote funnel needs: the value, the entry and her membership state', () => {
    Analytics.archiveVoteCast('carol', true, 'pending');
    expect(props()).toEqual({ entry: 'carol', value: true, membership_status: 'pending' });
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
});
