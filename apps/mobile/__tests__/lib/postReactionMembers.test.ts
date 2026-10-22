/**
 * Her own reaction, per post (migration 136), and the rail's numbers.
 *
 * Written before the code (TDD): the lib half — counts compact by locale, the
 * rail total that folds legacy likes in as ❤️, and the two calls that must
 * keep working whether or not 136 has reached the database yet.
 */
import {
  HEART, POST_REACTIONS, fetchMyReactions, formatReactionCount, isMissingSchema,
  reactionTotal, setMyReaction, shiftReaction, talliesWithLikes,
} from '../../lib/postReactions';

const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

/** A PostgREST query that records its filters and resolves to `result`. */
function query(result: { data: unknown; error: unknown }) {
  const calls: { op: string; args: unknown[] }[] = [];
  const q = {
    calls,
    select: (...a: unknown[]) => { calls.push({ op: 'select', args: a }); return q; },
    eq: (...a: unknown[]) => { calls.push({ op: 'eq', args: a }); return q; },
    in: (...a: unknown[]) => { calls.push({ op: 'in', args: a }); return q; },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return q;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('HEART', () => {
  it('is the first of the set, the one a double tap gives', () => {
    expect(HEART).toBe(POST_REACTIONS[0]);
    expect(HEART).toBe('❤️');
  });
});

describe('formatReactionCount', () => {
  it('writes small counts in full, grouped the way her language groups them', () => {
    expect(formatReactionCount(0, 'en')).toBe('0');
    expect(formatReactionCount(48, 'en')).toBe('48');
    expect(formatReactionCount(1205, 'en')).toBe('1,205');
  });

  it('goes compact from ten thousand, still in her language', () => {
    expect(formatReactionCount(12500, 'en')).toBe('12.5K');
    expect(formatReactionCount(1_200_000, 'en')).toBe('1.2M');
  });

  it('never shows a negative or fractional count', () => {
    expect(formatReactionCount(-3, 'en')).toBe('0');
    expect(formatReactionCount(Number.NaN, 'en')).toBe('0');
    expect(formatReactionCount(7.8, 'en')).toBe('7');
  });
});

describe('reactionTotal', () => {
  it('adds the six tallies and the legacy likes, which were hearts', () => {
    expect(reactionTotal({ '❤️': 3, '😂': 2, '💜': 1 }, 10)).toBe(16);
  });

  it('ignores poll keys and anything outside the set', () => {
    expect(reactionTotal({ 'poll:1': 40, '🍕': 9, '😮': 1 }, 0)).toBe(1);
  });

  it('survives an empty or broken row', () => {
    expect(reactionTotal(null, -2)).toBe(0);
    expect(reactionTotal(undefined, Number.NaN)).toBe(0);
  });
});

describe('talliesWithLikes', () => {
  it('folds legacy likes into the heart for the breakdown', () => {
    expect(talliesWithLikes({ '❤️': 2, '😢': 1 }, 5)).toEqual({ '❤️': 7, '😢': 1 });
  });
});

describe('shiftReaction', () => {
  it('moves her one count from the old emoji to the new one', () => {
    expect(shiftReaction({ '❤️': 1 }, '❤️', '😂')).toEqual({ '❤️': 0, '😂': 1 });
  });

  it('only adds when she had none, only removes when she clears', () => {
    expect(shiftReaction({}, null, '💜')).toEqual({ '💜': 1 });
    expect(shiftReaction({ '😡': 1 }, '😡', null)).toEqual({ '😡': 0 });
  });

  it('changes nothing when she picks what she already has', () => {
    expect(shiftReaction({ '❤️': 4 }, '❤️', '❤️')).toEqual({ '❤️': 4 });
  });
});

describe('isMissingSchema', () => {
  it('recognises a database that does not have 136 yet', () => {
    expect(isMissingSchema({ code: '42P01' })).toBe(true);
    expect(isMissingSchema({ code: 'PGRST205' })).toBe(true);
    expect(isMissingSchema({ code: 'PGRST202' })).toBe(true);
    expect(isMissingSchema({ code: '42883' })).toBe(true);
  });

  it('does not mistake a real failure for a missing table', () => {
    expect(isMissingSchema({ code: '42501' })).toBe(false);
    expect(isMissingSchema(new Error('network down'))).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });
});

describe('fetchMyReactions', () => {
  it('reads only her rows for the posts on screen', async () => {
    const q = query({ data: [{ post_id: 'p1', emoji: '😂' }, { post_id: 'p2', emoji: '🍕' }], error: null });
    mockFrom.mockReturnValue(q);

    const out = await fetchMyReactions('me', ['p1', 'p2', 'p3']);

    expect(mockFrom).toHaveBeenCalledWith('post_reaction_members');
    expect(q.calls).toEqual(expect.arrayContaining([
      { op: 'eq', args: ['user_id', 'me'] },
      { op: 'in', args: ['post_id', ['p1', 'p2', 'p3']] },
    ]));
    // An emoji outside the set is dropped, not drawn.
    expect(out).toEqual({ status: 'ok', mine: { p1: '😂' } });
  });

  it('answers "unsupported" instead of throwing before 136 is applied', async () => {
    mockFrom.mockReturnValue(query({
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.post_reaction_members'" },
    }));

    await expect(fetchMyReactions('me', ['p1'])).resolves.toEqual({ status: 'unsupported', mine: {} });
  });

  it('reports a real failure as an error, keeping what she sees', async () => {
    mockFrom.mockReturnValue(query({ data: null, error: { code: '500', message: 'boom' } }));

    await expect(fetchMyReactions('me', ['p1'])).resolves.toEqual({ status: 'error', mine: {} });
  });

  it('asks nothing when there is nothing on screen', async () => {
    await expect(fetchMyReactions('me', [])).resolves.toEqual({ status: 'ok', mine: {} });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('setMyReaction', () => {
  it('sets, switches or clears through the one RPC', async () => {
    mockRpc.mockResolvedValue({ data: { mine: '😮', counts: { '😮': 1 }, like_count: 3 }, error: null });

    const out = await setMyReaction('p1', '😮');

    expect(mockRpc).toHaveBeenCalledWith('set_post_reaction', { p_post_id: 'p1', p_emoji: '😮' });
    expect(out).toEqual({ status: 'ok', counts: { '😮': 1 }, likeCount: 3 });
  });

  it('sends null to clear', async () => {
    mockRpc.mockResolvedValue({ data: { mine: null, counts: {}, like_count: 0 }, error: null });

    await setMyReaction('p1', null);

    expect(mockRpc).toHaveBeenCalledWith('set_post_reaction', { p_post_id: 'p1', p_emoji: null });
  });

  it('refuses an emoji outside the set before asking the server', async () => {
    await expect(setMyReaction('p1', '🍕' as never)).rejects.toThrow('That is not a reaction.');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('answers "unsupported" when the RPC is not there yet', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });

    await expect(setMyReaction('p1', '❤️')).resolves.toEqual({ status: 'unsupported' });
  });

  it('throws a real failure so the rail can roll back', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Post not found' } });

    await expect(setMyReaction('p1', '❤️')).rejects.toEqual({ code: '42501', message: 'Post not found' });
  });
});
