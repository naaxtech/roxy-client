import { toRankRows, orderByRank, oldestCreatedAt } from '../../lib/announcements';
import type { AnnouncementRankRow } from '../../lib/announcements';

const rank = (
  post_id: string,
  created_at: string,
  rankValue = 0,
): AnnouncementRankRow => ({ post_id, community_id: 'c1', rank: rankValue, created_at });

describe('toRankRows', () => {
  it('reads the RPC shape', () => {
    const rows = toRankRows([
      { post_id: 'p1', community_id: 'c1', rank: 12.5, created_at: '2026-07-31T10:00:00+00:00' },
    ]);
    expect(rows).toEqual([
      { post_id: 'p1', community_id: 'c1', rank: 12.5, created_at: '2026-07-31T10:00:00+00:00' },
    ]);
  });

  it('returns empty for anything that is not an array', () => {
    expect(toRankRows(null)).toEqual([]);
    expect(toRankRows(undefined)).toEqual([]);
    expect(toRankRows({ post_id: 'p1' })).toEqual([]);
  });

  // A row with no id cannot be hydrated, and a row with no timestamp cannot be
  // paginated from. Either one silently poisons the cursor, so both are dropped
  // rather than defaulted.
  it('drops rows missing an id or a timestamp', () => {
    const rows = toRankRows([
      { post_id: 'p1', created_at: '2026-07-31T10:00:00+00:00' },
      { post_id: 'p2' },
      { created_at: '2026-07-30T10:00:00+00:00' },
      null,
      'nope',
    ]);
    expect(rows.map((r) => r.post_id)).toEqual(['p1']);
  });

  it('defaults a missing rank and community rather than dropping the post', () => {
    const [row] = toRankRows([{ post_id: 'p1', created_at: '2026-07-31T10:00:00+00:00' }]);
    expect(row.rank).toBe(0);
    expect(row.community_id).toBe('');
  });
});

describe('orderByRank', () => {
  const ranked = [
    rank('p1', '2026-07-31T10:00:00+00:00', 30),
    rank('p2', '2026-07-30T10:00:00+00:00', 20),
    rank('p3', '2026-07-29T10:00:00+00:00', 10),
  ];

  // `in('id', ids)` answers in storage order, which throws away the whole
  // point of the ranking RPC.
  it('restores the RPC order regardless of how the hydrate query answered', () => {
    const hydrated = [{ id: 'p3' }, { id: 'p1' }, { id: 'p2' }];
    expect(orderByRank(hydrated, ranked).map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('drops ranked ids the hydrate query filtered out', () => {
    const videoOnly = [{ id: 'p2' }];
    expect(orderByRank(videoOnly, ranked).map((r) => r.id)).toEqual(['p2']);
  });

  it('returns empty when nothing hydrated', () => {
    expect(orderByRank([], ranked)).toEqual([]);
  });
});

describe('oldestCreatedAt', () => {
  // The page is ordered by rank, not by time, so the last row is rarely the
  // oldest — taking it as the cursor would skip everything between.
  it('finds the oldest timestamp, not the last row', () => {
    const ranked = [
      rank('p1', '2026-07-29T10:00:00+00:00'),
      rank('p2', '2026-07-31T10:00:00+00:00'),
      rank('p3', '2026-07-30T10:00:00+00:00'),
    ];
    expect(oldestCreatedAt(ranked)).toBe('2026-07-29T10:00:00+00:00');
  });

  it('is null for an empty page', () => {
    expect(oldestCreatedAt([])).toBeNull();
  });

  it('ignores unparseable timestamps', () => {
    const ranked = [rank('p1', 'not-a-date'), rank('p2', '2026-07-30T10:00:00+00:00')];
    expect(oldestCreatedAt(ranked)).toBe('2026-07-30T10:00:00+00:00');
  });
});
