import {
  ARCHIVE_TYPE_FILTERS,
  archiveTypeLabel,
  archiveTypeIcon,
  countByType,
  filterCount,
} from '../../lib/archiveTypes';

/**
 * What the Archive calls its media types, and how many of each there are.
 *
 * The chips said "Film", "TV" and "Comic" — the raw enum values, capitalised.
 * Nobody browsing a catalogue at eleven at night thinks "I'll have a Film"; she
 * thinks movies, series, manga. The enum stays as it is because it is a column
 * in a live table with 45 rows in it; only what she reads changes.
 */

describe('the filter set', () => {
  it('offers All first, then every media type the schema has', () => {
    expect(ARCHIVE_TYPE_FILTERS.map((f) => f.value)).toEqual([
      null, 'film', 'tv', 'book', 'comic', 'music',
    ]);
  });

  it('names them the way a person browsing would', () => {
    expect(archiveTypeLabel('film')).toBe('Movies');
    expect(archiveTypeLabel('tv')).toBe('Series');
    expect(archiveTypeLabel('book')).toBe('Books');
    // "Comic" excluded manga by implication, which is most of what this
    // category holds for a wlw audience.
    expect(archiveTypeLabel('comic')).toBe('Comics & Manga');
    expect(archiveTypeLabel('music')).toBe('Music');
  });

  it('gives All a name too, so the chip is not a special case at render time', () => {
    expect(archiveTypeLabel(null)).toBe('Everything');
  });

  it('has an icon per type, so the row is scannable without reading it', () => {
    for (const f of ARCHIVE_TYPE_FILTERS) {
      expect(archiveTypeIcon(f.value).length).toBeGreaterThan(0);
    }
  });
});

describe('countByType', () => {
  it('counts each type and leaves the rest at zero', () => {
    const counts = countByType([
      { media_type: 'film' }, { media_type: 'film' }, { media_type: 'book' },
    ]);
    expect(counts.film).toBe(2);
    expect(counts.book).toBe(1);
    // Present and zero, not absent — a chip that renders `undefined` reads as
    // a loading state rather than as an empty category.
    expect(counts.music).toBe(0);
    expect(counts.tv).toBe(0);
    expect(counts.comic).toBe(0);
  });

  it('ignores a type the client does not know about', () => {
    // The enum could gain a value before the app ships support for it. An
    // unknown type must not crash the filter row or land in someone else's count.
    const counts = countByType([{ media_type: 'podcast' }, { media_type: 'film' }]);
    expect(counts.film).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('handles an empty catalogue', () => {
    const counts = countByType([]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});

describe('filterCount', () => {
  const counts = { film: 12, tv: 10, book: 11, comic: 6, music: 6 };

  it('gives All the total across every type', () => {
    expect(filterCount(null, counts)).toBe(45);
  });

  it('gives a type its own count', () => {
    expect(filterCount('film', counts)).toBe(12);
  });
});
