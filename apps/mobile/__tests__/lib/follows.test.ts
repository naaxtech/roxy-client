const mockOps: [string, unknown[]][] = [];
const mockResult: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockOps.push(['from', [table]]);
      const chain: Record<string, unknown> = {};
      ['select', 'eq', 'delete', 'upsert'].forEach((m) => {
        chain[m] = (...args: unknown[]) => {
          mockOps.push([m, args]);
          return chain;
        };
      });
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mockResult.data, error: mockResult.error }).then(resolve);
      return chain;
    },
  },
}));

import { followPair, fetchFollowingIds, followUser, unfollowUser } from '../../lib/follows';

beforeEach(() => {
  mockOps.length = 0;
  mockResult.data = [];
  mockResult.error = null;
});

describe('followPair', () => {
  it('refuses a self-follow and an empty id', () => {
    expect(followPair('u1', 'u1')).toBeNull();
    expect(followPair('', 'u2')).toBeNull();
    expect(followPair('u1', 'u2')).toEqual({ follower_id: 'u1', followed_id: 'u2' });
  });
});

describe('follows writes', () => {
  it('upserts the pair and never asks the server to follow herself', async () => {
    expect(await followUser('u1', 'u1')).toBe(false);
    expect(mockOps).toEqual([]);

    expect(await followUser('u1', 'u2')).toBe(true);
    expect(mockOps).toContainEqual(['from', ['follows']]);
    expect(mockOps).toContainEqual(['upsert', [
      { follower_id: 'u1', followed_id: 'u2' },
      { onConflict: 'follower_id,followed_id', ignoreDuplicates: true },
    ]]);
  });

  it('deletes the pair she wrote', async () => {
    expect(await unfollowUser('u1', 'u2')).toBe(true);
    expect(mockOps.map(([m]) => m)).toEqual(['from', 'delete', 'eq', 'eq']);
  });

  it('loads the ids she follows', async () => {
    mockResult.data = [{ followed_id: 'a' }, { followed_id: 'b' }];
    await expect(fetchFollowingIds('u1')).resolves.toEqual(['a', 'b']);
  });
});
