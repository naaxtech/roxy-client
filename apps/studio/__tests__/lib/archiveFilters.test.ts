import {
  EMPTY_ARCHIVE_FILTERS,
  archiveFilterCount,
  archiveFilterHref,
  parseArchiveEntryFilters,
  parseYearBound,
} from '@/lib/archiveFilters';

describe('parseArchiveEntryFilters', () => {
  it('reads known query keys and drops unknown values', () => {
    expect(
      parseArchiveEntryFilters({
        q: '  portrait  ',
        status: 'published',
        type: 'film',
        score: 'below',
        cover: 'no',
        year_from: '2010',
        year_to: '2024xx',
        sort: 'votes',
      }),
    ).toEqual({
      q: 'portrait',
      status: 'published',
      type: 'film',
      score: 'below',
      cover: 'no',
      yearFrom: '2010',
      yearTo: '2024',
      sort: 'votes',
    });

    expect(parseArchiveEntryFilters({ status: 'draft', type: 'podcast', score: 'hot', sort: 'random' })).toEqual({
      ...EMPTY_ARCHIVE_FILTERS,
    });
  });
});

describe('archiveFilterHref', () => {
  it('omits defaults so the list URL stays short', () => {
    expect(archiveFilterHref(EMPTY_ARCHIVE_FILTERS)).toBe('/staff/archive/entries');
    expect(
      archiveFilterHref({
        ...EMPTY_ARCHIVE_FILTERS,
        q: 'portrait',
        status: 'published',
        type: 'film',
        score: 'below',
        cover: 'no',
        yearFrom: '2010',
        yearTo: '2024',
        sort: 'votes',
      }),
    ).toBe(
      '/staff/archive/entries?q=portrait&status=published&type=film&score=below&cover=no&year_from=2010&year_to=2024&sort=votes',
    );
  });
});

describe('archiveFilterCount', () => {
  it('counts chips and sort, not the search box', () => {
    expect(archiveFilterCount({ ...EMPTY_ARCHIVE_FILTERS, q: 'portrait' })).toBe(0);
    expect(
      archiveFilterCount({
        ...EMPTY_ARCHIVE_FILTERS,
        status: 'hidden',
        type: 'book',
        score: 'scored',
        cover: 'yes',
        yearFrom: '1990',
        yearTo: '2000',
        sort: 'title',
      }),
    ).toBe(7);
  });
});

describe('parseYearBound', () => {
  it('accepts a four-digit year in range', () => {
    expect(parseYearBound('')).toBeNull();
    expect(parseYearBound('1799')).toBeNull();
    expect(parseYearBound('2019')).toBe(2019);
  });
});
