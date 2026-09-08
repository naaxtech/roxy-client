import { buildRevisionDiff, formatDiffValue } from '@/lib/archiveRevisionDiff';

describe('formatDiffValue', () => {
  it('renders null and undefined as an em dash', () => {
    expect(formatDiffValue(null)).toBe('—');
    expect(formatDiffValue(undefined)).toBe('—');
  });

  it('renders booleans as Yes/No', () => {
    expect(formatDiffValue(true)).toBe('Yes');
    expect(formatDiffValue(false)).toBe('No');
  });

  it('renders objects and arrays as JSON', () => {
    expect(formatDiffValue({ imdb: 'tt123' })).toBe('{"imdb":"tt123"}');
    expect(formatDiffValue(['a', 'b'])).toBe('["a","b"]');
  });

  it('renders numbers and strings as themselves', () => {
    expect(formatDiffValue(2019)).toBe('2019');
    expect(formatDiffValue('Portrait of a Lady on Fire')).toBe('Portrait of a Lady on Fire');
  });
});

describe('buildRevisionDiff', () => {
  it('only surfaces fields present in the patch — never unrelated prev columns', () => {
    // prev is a wider row snapshot than what was proposed (e.g. it also carries
    // vote_count, id, created_at). Only the patched fields must appear: a
    // revision that changed the summary must never look like it also touched
    // vote_count just because prev happened to carry it.
    const patch = { summary: 'A new summary.' };
    const prev = {
      id: 'entry-1',
      summary: 'Old summary.',
      vote_count: 42,
      created_at: '2026-01-01T00:00:00Z',
    };
    const rows = buildRevisionDiff(patch, prev, 'edit');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'summary',
      before: 'Old summary.',
      after: 'A new summary.',
      changed: true,
    });
  });

  it('marks a field unchanged when patch and prev agree', () => {
    const patch = { title: 'Same Title', release_year: 2020 };
    const prev = { title: 'Same Title', release_year: 2019 };
    const rows = buildRevisionDiff(patch, prev, 'edit');
    const title = rows.find((r) => r.key === 'title');
    const year = rows.find((r) => r.key === 'release_year');
    expect(title?.changed).toBe(false);
    expect(year?.changed).toBe(true);
  });

  it('treats every field as new and changed for a create revision, ignoring prev', () => {
    const patch = { title: 'Brand New Film', media_type: 'film' };
    // A create has no prior row per the 095 CHECK constraint, but even if a
    // stray prev value showed up, a create must never render it as "before".
    const prev = { title: 'Should be ignored' };
    const rows = buildRevisionDiff(patch, prev, 'create');
    expect(rows.every((r) => r.before === '—')).toBe(true);
    expect(rows.every((r) => r.changed)).toBe(true);
  });

  it('handles a null prev on an edit (defensive — should not throw)', () => {
    const rows = buildRevisionDiff({ creator: 'Céline Sciamma' }, null, 'edit');
    expect(rows).toEqual([
      { key: 'creator', label: 'Creator', before: '—', after: 'Céline Sciamma', changed: true },
    ]);
  });

  it('returns an empty array for an empty or null patch', () => {
    expect(buildRevisionDiff({}, {}, 'edit')).toEqual([]);
    expect(buildRevisionDiff(null, null, 'edit')).toEqual([]);
  });

  it('humanizes snake_case keys into readable labels', () => {
    const rows = buildRevisionDiff({ length_label: '2h 2m', release_year: 2019 }, {}, 'edit');
    const labels = Object.fromEntries(rows.map((r) => [r.key, r.label]));
    expect(labels.length_label).toBe('Length label');
    expect(labels.release_year).toBe('Release year');
  });

  it('sorts rows by key for a stable, predictable render order', () => {
    const rows = buildRevisionDiff({ title: 'T', creator: 'C', release_year: 2020 }, {}, 'edit');
    expect(rows.map((r) => r.key)).toEqual(['creator', 'release_year', 'title']);
  });
});
