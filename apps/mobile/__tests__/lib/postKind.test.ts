import { isThought, isMediaPost } from '../../lib/postKind';
import type { PostType } from '../../types';

/**
 * The profile splits Posts from Thoughts on this predicate. If the two
 * surfaces ever disagree about which posts are text, a post is either shown
 * twice or vanishes from both tabs.
 */

const ALL: PostType[] = [
  'standard', 'event', 'poll', 'resource', 'photo', 'gallery', 'video', 'roxy_link',
];

describe('isThought', () => {
  it('is true for the text-first types', () => {
    expect(isThought('standard')).toBe(true);
    expect(isThought('roxy_link')).toBe(true);
  });

  it('is false for anything that leads with a picture', () => {
    for (const t of ['photo', 'gallery', 'video'] as PostType[]) {
      expect(isThought(t)).toBe(false);
    }
  });

  it('does not sweep in a type nobody has classified', () => {
    // Built from the types that ARE text, never by excluding photo — so a
    // `poll` added later lands in Posts and not silently in Thoughts.
    expect(isThought('poll')).toBe(false);
    expect(isThought('event')).toBe(false);
    expect(isThought('resource')).toBe(false);
  });

  it('puts every post in exactly one of the two tabs', () => {
    // No post may appear twice, and none may fall through both.
    for (const t of ALL) {
      expect(isThought(t)).toBe(!isMediaPost(t));
    }
  });
});
