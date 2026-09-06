import {
  isOfficialAccount,
  officialCommunityIdsFromProfiles,
  officialFirst,
} from '../../lib/officialGrant';

describe('isOfficialAccount', () => {
  it('is the FK, not the older owner flag', () => {
    expect(isOfficialAccount({ official_community_id: 'c1' })).toBe(true);
    expect(isOfficialAccount({ official_community_id: null })).toBe(false);
    expect(isOfficialAccount({ official_community_id: '' })).toBe(false);
    expect(isOfficialAccount(null)).toBe(false);
  });
});

describe('officialCommunityIdsFromProfiles', () => {
  it('dedupes and drops nulls', () => {
    expect(officialCommunityIdsFromProfiles([
      { official_community_id: 'c1' },
      { official_community_id: null },
      { official_community_id: 'c1' },
      { official_community_id: 'c2' },
    ])).toEqual(['c1', 'c2']);
  });
});

describe('officialFirst', () => {
  it('keeps official communities at the front without scrambling the rest', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(officialFirst(rows, new Set(['c', 'a'])).map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('is a copy when nothing is official', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(officialFirst(rows, new Set())).toEqual(rows);
    expect(officialFirst(rows, new Set())).not.toBe(rows);
  });
});
