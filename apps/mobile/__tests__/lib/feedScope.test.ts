import { followingAuthorIds } from '../../lib/feedScope';

/**
 * "I post and it never shows in the feed."
 *
 * The Following segment filtered on `followingIds` alone, so the one author
 * whose posts she is guaranteed to care about — herself — was the only author
 * the feed could never return. She published, landed on a screen that did not
 * show it, opened Following, and found nothing there either. Every social feed
 * that has ever shipped includes your own posts in the list of people you
 * follow; this is that line.
 */
describe('followingAuthorIds', () => {
  it('includes her own id, so her own post appears in Following', () => {
    expect(followingAuthorIds(['a', 'b'], 'me')).toEqual(expect.arrayContaining(['me']));
  });

  it('keeps everyone she follows', () => {
    const out = followingAuthorIds(['a', 'b'], 'me');
    expect(out).toEqual(expect.arrayContaining(['a', 'b']));
    expect(out).toHaveLength(3);
  });

  it('does not duplicate her id when the follow graph already contains it', () => {
    // A self-follow row is not supposed to exist, but a duplicate in an
    // `in()` filter is a wasted index probe and an easy thing to leave behind.
    expect(followingAuthorIds(['me', 'a'], 'me').filter((id) => id === 'me')).toHaveLength(1);
  });

  it('returns just her when she follows nobody — a new member still sees herself', () => {
    // The empty case is the one that matters most: a brand-new member follows
    // no one, and an empty author list makes ReelsFeed bail before it queries.
    expect(followingAuthorIds([], 'me')).toEqual(['me']);
  });

  it('returns the follow list unchanged when there is no viewer yet', () => {
    expect(followingAuthorIds(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('returns empty for a signed-out viewer following nobody', () => {
    expect(followingAuthorIds([], null)).toEqual([]);
  });

  it('accepts a Set, which is what the follow store actually holds', () => {
    expect(followingAuthorIds(new Set(['a']), 'me')).toEqual(expect.arrayContaining(['a', 'me']));
  });
});
