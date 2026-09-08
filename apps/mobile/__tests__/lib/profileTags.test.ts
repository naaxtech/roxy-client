import {
  clampCustomTags,
  collapseProfileTags,
  MAX_CUSTOM_TAGS,
  profileDisplayTags,
} from '../../lib/profileTags';

describe('profileDisplayTags', () => {
  it('shows orientation, then interests, then custom labels', () => {
    expect(profileDisplayTags({
      identityLabels: ['Lesbian'],
      interests: ['Music', 'Film'],
      customTags: ['night owl'],
    })).toEqual([
      { kind: 'identity', label: 'Lesbian' },
      { kind: 'interest', label: 'Music' },
      { kind: 'interest', label: 'Film' },
      { kind: 'custom', label: 'night owl' },
    ]);
  });

  it('drops retired chips and empty strings', () => {
    expect(profileDisplayTags({
      identityLabels: ['Lesbian', 'Prefer not to say', ''],
      interests: ['other'],
      customTags: ['  '],
    })).toEqual([{ kind: 'identity', label: 'Lesbian' }]);
  });
});

describe('clampCustomTags', () => {
  it(`keeps at most ${MAX_CUSTOM_TAGS} custom tags`, () => {
    expect(clampCustomTags(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('collapseProfileTags', () => {
  const tags = profileDisplayTags({
    identityLabels: ['Lesbian'],
    interests: ['Music', 'Film', 'Art', 'Travel', 'Food'],
    customTags: ['night owl', 'cats'],
  });

  it('hides the overflow until she expands', () => {
    const collapsed = collapseProfileTags(tags, false, 4);
    expect(collapsed.visible).toHaveLength(4);
    expect(collapsed.hidden).toBe(tags.length - 4);
  });

  it('shows every tag once expanded', () => {
    const open = collapseProfileTags(tags, true, 4);
    expect(open.visible).toHaveLength(tags.length);
    expect(open.hidden).toBe(0);
  });
});
