import { contentDetailPath } from '../lib/contentNavigation';

describe('contentDetailPath', () => {
  it('routes video to community video player', () => {
    expect(contentDetailPath('abc', 'video')).toBe('/community/video/abc');
  });

  it('routes other types to community post detail', () => {
    expect(contentDetailPath('abc', 'photo')).toBe('/community/post/abc');
    expect(contentDetailPath('abc', 'standard')).toBe('/community/post/abc');
  });
});
