import { appendComment, nestComments } from '../../lib/comments';
import type { Comment } from '../../types';

function row(id: string, parentId: string | null = null): Comment {
  return {
    id,
    post_id: 'p1',
    author_id: 'u1',
    parent_id: parentId,
    content: id,
    media_url: null,
    gif_url: null,
    like_count: 0,
    deleted_at: null,
    created_at: '',
    profiles: { display_name: 'Maya', avatar_url: null },
  };
}

describe('nestComments', () => {
  it('keeps top-level comments in order and hangs replies under the parent', () => {
    const nested = nestComments([
      row('c1'),
      row('c2'),
      row('r1', 'c1'),
      row('r2', 'c1'),
    ]);
    expect(nested.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(nested[0].replies?.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(nested[1].replies).toEqual([]);
  });

  it('ignores a reply whose parent is missing rather than inventing a thread', () => {
    const nested = nestComments([row('orphan', 'missing')]);
    expect(nested).toEqual([]);
  });
});

describe('appendComment', () => {
  it('adds a top-level comment at the end', () => {
    const next = appendComment([row('c1')], row('c2'));
    expect(next.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('hangs a reply under its parent', () => {
    const next = appendComment([row('c1')], row('r1', 'c1'));
    expect(next[0].replies?.map((r) => r.id)).toEqual(['r1']);
  });
});
