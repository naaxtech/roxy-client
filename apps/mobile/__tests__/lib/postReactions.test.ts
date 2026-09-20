import {
  POST_REACTIONS, isPostReaction, reactionCount, reactionsOn, withLocalReaction,
} from '../../lib/postReactions';

describe('the reaction vocabulary', () => {
  it('is the same set the chat bar offers', () => {
    // A woman who has learned what 💜 means in a DM should not meet a
    // different set on a post.
    expect([...POST_REACTIONS]).toEqual(['❤️', '😂', '😮', '😢', '😡', '💜']);
  });

  it('refuses anything outside it', () => {
    // The column is free-form text, so the client is the only thing standing
    // between the tally and arbitrary strings.
    expect(isPostReaction('❤️')).toBe(true);
    expect(isPostReaction('🍕')).toBe(false);
    expect(isPostReaction('<script>')).toBe(false);
    expect(isPostReaction('')).toBe(false);
  });
});

describe('reactionCount', () => {
  it('reads a tally, and treats anything unusable as none', () => {
    expect(reactionCount({ '❤️': 3 }, '❤️')).toBe(3);
    expect(reactionCount({}, '❤️')).toBe(0);
    expect(reactionCount(null, '❤️')).toBe(0);
    expect(reactionCount(undefined, '❤️')).toBe(0);
  });

  it('never renders a negative or fractional count', () => {
    // reaction_counts is jsonb: nothing constrains what is in it.
    expect(reactionCount({ '❤️': -4 }, '❤️')).toBe(0);
    expect(reactionCount({ '❤️': 2.7 }, '❤️')).toBe(2);
    expect(reactionCount({ '❤️': Number.NaN }, '❤️')).toBe(0);
  });
});

describe('reactionsOn', () => {
  it('shows only what is actually there, in the app’s own order', () => {
    const out = reactionsOn({ '💜': 2, '❤️': 5 });
    expect(out.map((r) => r.emoji)).toEqual(['❤️', '💜']);
    expect(out.map((r) => r.count)).toEqual([5, 2]);
  });

  it('ignores emoji the app does not offer, however they got in there', () => {
    expect(reactionsOn({ '🍕': 9 })).toEqual([]);
  });

  it('is empty for a post nobody has reacted to', () => {
    expect(reactionsOn(null)).toEqual([]);
    expect(reactionsOn({ '❤️': 0 })).toEqual([]);
  });
});

describe('withLocalReaction', () => {
  it('adds her tap without disturbing the others', () => {
    expect(withLocalReaction({ '❤️': 1, '💜': 4 }, '❤️')).toEqual({ '❤️': 2, '💜': 4 });
  });

  it('starts a tally that did not exist', () => {
    expect(withLocalReaction(null, '😂')).toEqual({ '😂': 1 });
  });
});
