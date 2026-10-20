/**
 * "Your first post is live" — once per member, and only when it is true.
 *
 * Keyed by user id, so a second account on the same phone gets her own moment
 * and a sign-out does not replay it. The server count is the truth about
 * "first": a woman who posted before this shipped is never told her tenth
 * post is her first.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockCount: { value: number | null; error: { message: string } | null; calls: string[] } = {
  value: 1, error: null, calls: [],
};

jest.mock('../../lib/supabase', () => {
  const q: Record<string, unknown> = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn((_col: string, val: string) => { mockCount.calls.push(val); return q; });
  q.is = jest.fn(() => q);
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({
    count: mockCount.error ? null : mockCount.value,
    error: mockCount.error,
    data: null,
  }).then(resolve);
  return { supabase: { from: jest.fn(() => q) } };
});
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { claimFirstPostCelebration, firstPostKey } from '../../lib/firstPost';

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCount.value = 1;
  mockCount.error = null;
  mockCount.calls.length = 0;
});

describe('claimFirstPostCelebration', () => {
  it('celebrates her first post, once', async () => {
    expect(await claimFirstPostCelebration('u1')).toBe(true);
    expect(await AsyncStorage.getItem(firstPostKey('u1'))).not.toBeNull();

    expect(await claimFirstPostCelebration('u1')).toBe(false);
  });

  it('keys by user, so another account on the phone gets her own moment', async () => {
    expect(await claimFirstPostCelebration('u1')).toBe(true);
    expect(await claimFirstPostCelebration('u2')).toBe(true);
    expect(firstPostKey('u1')).not.toBe(firstPostKey('u2'));
  });

  it('counts only her own live posts', async () => {
    await claimFirstPostCelebration('u1');
    expect(mockCount.calls).toEqual(['u1']);
  });

  it('never calls her tenth post her first, and stops asking', async () => {
    mockCount.value = 10;
    expect(await claimFirstPostCelebration('u1')).toBe(false);
    expect(await AsyncStorage.getItem(firstPostKey('u1'))).not.toBeNull();

    mockCount.calls.length = 0;
    expect(await claimFirstPostCelebration('u1')).toBe(false);
    expect(mockCount.calls).toEqual([]);
  });

  it('stays quiet and asks again next time when the count fails', async () => {
    mockCount.error = { message: 'offline' };
    expect(await claimFirstPostCelebration('u1')).toBe(false);
    expect(await AsyncStorage.getItem(firstPostKey('u1'))).toBeNull();
  });

  it('never throws into the publish flow when storage fails', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(claimFirstPostCelebration('u1')).resolves.toBe(false);
    spy.mockRestore();
  });

  it('does nothing without a user id', async () => {
    expect(await claimFirstPostCelebration('')).toBe(false);
    expect(mockCount.calls).toEqual([]);
  });
});
