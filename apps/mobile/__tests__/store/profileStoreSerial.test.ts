/**
 * PRO-04 / PRO-05: profile rules, and pronoun taps that cannot race.
 */
type Call = { patch: Record<string, unknown>; resolve: (v: { error: unknown }) => void };
const mockCalls: Call[] = [];
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: () => new Promise((resolve) => { mockCalls.push({ patch, resolve }); }),
      }),
    }),
  },
  callEdgeFunction: jest.fn(),
}));

import { act } from '@testing-library/react-native';
import { useProfileStore } from '../../store/profileStore';
import {
  BIO_MAX, RESERVED_DISPLAY_NAMES, avatarFileError, validateDisplayName, withCacheBust,
} from '../../lib/profileRules';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockCalls.length = 0;
  useProfileStore.setState({ profile: { id: 'u1', display_name: 'Alice', pronouns: [] } as never });
});

describe('profileStore serialized, optimistic writes (PRO-05)', () => {
  it('two quick pronoun taps both land — the second write starts from the first', async () => {
    const s = useProfileStore.getState();
    let p1: Promise<void> = Promise.resolve();
    let p2: Promise<void> = Promise.resolve();
    act(() => { p1 = s.togglePronoun('she/her'); });
    act(() => { p2 = useProfileStore.getState().togglePronoun('they/them'); });
    // Optimistic: both chips are on immediately.
    expect(useProfileStore.getState().profile?.pronouns).toEqual(['she/her', 'they/them']);
    await act(async () => { await flush(); });
    expect(mockCalls).toHaveLength(1); // serialized: the second waits
    await act(async () => { mockCalls[0].resolve({ error: null }); await p1; await flush(); });
    expect(mockCalls).toHaveLength(2);
    expect(mockCalls[1].patch.pronouns).toEqual(['she/her', 'they/them']);
    await act(async () => { mockCalls[1].resolve({ error: null }); await p2; });
    expect(useProfileStore.getState().profile?.pronouns).toEqual(['she/her', 'they/them']);
  });

  it('a failed write rolls the field back to what the server last confirmed', async () => {
    let p: Promise<void> = Promise.resolve();
    act(() => { p = useProfileStore.getState().togglePronoun('she/her'); });
    expect(useProfileStore.getState().profile?.pronouns).toEqual(['she/her']);
    await act(async () => { await flush(); });
    await act(async () => {
      mockCalls[0].resolve({ error: { message: 'offline' } });
      await p.catch(() => undefined);
    });
    expect(useProfileStore.getState().profile?.pronouns).toEqual([]);
    await expect(p).rejects.toThrow();
  });
});

describe('profileRules (PRO-04)', () => {
  it('bio cap is 160 (the DB allows 300 for older clients)', () => {
    expect(BIO_MAX).toBe(160);
  });

  it('display names: trimmed 2..50, reserved names refused however spelled', () => {
    expect(validateDisplayName('  Mia ')).toEqual({ value: 'Mia', error: null });
    expect(validateDisplayName('M').error).toMatch(/2/);
    expect(validateDisplayName('x'.repeat(51)).error).toMatch(/50/);
    expect(validateDisplayName('Roxy Team').error).toMatch(/reserved/i);
    expect(validateDisplayName('r.o.x.y').error).toMatch(/reserved/i);
    expect(validateDisplayName('Roxanne').error).toBeNull();
    // Mirrors the 133 trigger list exactly.
    expect(RESERVED_DISPLAY_NAMES).toContain('naaxtech');
    expect(RESERVED_DISPLAY_NAMES).toHaveLength(17);
  });

  it('a new avatar URL is cache-busted so the old photo does not linger', () => {
    const a = withCacheBust('https://x.supabase.co/storage/v1/object/public/avatars/u1/avatar.jpg', 111);
    expect(a).toBe('https://x.supabase.co/storage/v1/object/public/avatars/u1/avatar.jpg?v=111');
    expect(withCacheBust(`${a}`, 222)).toBe('https://x.supabase.co/storage/v1/object/public/avatars/u1/avatar.jpg?v=222');
  });

  it('refuses non-images and files over 10 MB', () => {
    expect(avatarFileError({ mimeType: 'image/jpeg', fileSize: 1_000 })).toBeNull();
    expect(avatarFileError({ mimeType: 'video/mp4', fileSize: 1_000 })).toMatch(/photo/i);
    expect(avatarFileError({ mimeType: 'image/png', fileSize: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(avatarFileError({ mimeType: undefined, fileSize: undefined })).toBeNull();
  });
});
