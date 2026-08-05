import {
  excludeSeenReels, displayedLikeCount, activeIndexFromScroll, initialReelIndex,
} from '../../lib/reels';
import type { Post } from '../../types';

const makeReel = (id: string, overrides: Partial<Post> = {}): Post => ({
  id,
  author_id: 'user-1',
  community_id: 'comm-1',
  content: '',
  media_urls: [],
  post_type: 'video',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 0,
  like_count: 0,
  save_count: 0,
  feed_score: 0,
  blurhash: null,
  posted_as_community: false,
  post_tags: [],
  deleted_at: null,
  video_url: 'clip.mp4',
  video_thumbnail_url: null,
  video_duration_secs: null,
  video_aspect_ratio: null,
  link_type: null,
  link_entity_id: null,
  link_community_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('excludeSeenReels', () => {
  it('returns every row when nothing has been seen', () => {
    const rows = [makeReel('a'), makeReel('b')];
    expect(excludeSeenReels(rows, new Set())).toEqual(rows);
  });

  it('drops rows the viewer has already watched', () => {
    const rows = [makeReel('a'), makeReel('b'), makeReel('c')];
    const kept = excludeSeenReels(rows, new Set(['b']));
    expect(kept.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('keeps the page when every row is seen, so the feed never falsely reads empty', () => {
    const rows = [makeReel('a'), makeReel('b')];
    const kept = excludeSeenReels(rows, new Set(['a', 'b']));
    expect(kept.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array for an empty page', () => {
    expect(excludeSeenReels([], new Set(['a']))).toEqual([]);
  });
});

describe('displayedLikeCount', () => {
  it('returns the row count when no like has been toggled this session', () => {
    expect(displayedLikeCount(makeReel('a', { like_count: 7 }), {})).toBe(7);
  });

  it('applies a like toggled after the row was fetched', () => {
    expect(displayedLikeCount(makeReel('a', { like_count: 7 }), { a: 1 })).toBe(8);
  });

  it('applies an unlike toggled after the row was fetched', () => {
    expect(displayedLikeCount(makeReel('a', { like_count: 7 }), { a: -1 })).toBe(7 - 1);
  });

  it('never renders a negative count', () => {
    expect(displayedLikeCount(makeReel('a', { like_count: 0 }), { a: -1 })).toBe(0);
  });

  it('ignores deltas belonging to other posts', () => {
    expect(displayedLikeCount(makeReel('a', { like_count: 3 }), { b: 5 })).toBe(3);
  });
});

describe('activeIndexFromScroll', () => {
  it('reports the first page at rest', () => {
    expect(activeIndexFromScroll(0, 800, 5)).toBe(0);
  });

  it('reports the page whose top the list has snapped to', () => {
    expect(activeIndexFromScroll(1600, 800, 5)).toBe(2);
  });

  it('rounds to the nearer page mid-swipe, so the video swaps at the halfway point', () => {
    expect(activeIndexFromScroll(1100, 800, 5)).toBe(1);
    expect(activeIndexFromScroll(1300, 800, 5)).toBe(2);
  });

  it('clamps an over-scroll past the last page to the last index', () => {
    expect(activeIndexFromScroll(99999, 800, 3)).toBe(2);
  });

  it('clamps a rubber-band bounce above the top to zero', () => {
    expect(activeIndexFromScroll(-240, 800, 3)).toBe(0);
  });

  // The list renders before onLayout has measured it; dividing by that zero
  // would put NaN into setState and blank every cell.
  it('returns 0 rather than NaN before the page has been measured', () => {
    expect(activeIndexFromScroll(500, 0, 4)).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(activeIndexFromScroll(500, 800, 0)).toBe(0);
  });
});

describe('initialReelIndex', () => {
  it('opens at the top when no post was requested', () => {
    expect(initialReelIndex([makeReel('a'), makeReel('b')], null)).toBe(0);
  });

  it('opens at the requested post', () => {
    const rows = [makeReel('a'), makeReel('b'), makeReel('c')];
    expect(initialReelIndex(rows, 'c')).toBe(2);
  });

  it('falls back to the top when the requested post is not in the page', () => {
    expect(initialReelIndex([makeReel('a')], 'missing')).toBe(0);
  });

  it('falls back to the top for an empty page', () => {
    expect(initialReelIndex([], 'a')).toBe(0);
  });
});
