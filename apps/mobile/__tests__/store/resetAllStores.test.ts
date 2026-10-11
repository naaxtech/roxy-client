/**
 * resetAllStores (ARC-08) — signing out must leave nothing of hers behind.
 *
 * The defect: sign out as A, sign in as B on the same phone, open the Archive,
 * and B sees A's votes, A's review list and A's shelf (archiveStore was never
 * reset; neither were feed likes/saves, follows, friends, blocked ids...).
 *
 * The rule this test enforces is structural, not a hand-kept list: EVERY
 * zustand store under store/ is either reset by resetAllStores() or named in
 * DEVICE_STORES with a reason. A new store that holds her data and is not
 * registered fails this test the day it is added.
 */
import fs from 'fs';
import path from 'path';
import { DEVICE_STORES, PER_USER_STORES, resetAllStores } from '../../store/resetAllStores';
import { useArchiveStore } from '../../store/archiveStore';
import { useFeedStore } from '../../store/feedStore';
import { useFollowStore } from '../../store/followStore';
import { useSafetyStore } from '../../store/safetyStore';
import { useProfileStore } from '../../store/profileStore';
import { useGateStore } from '../../store/gateStore';
import { useThemeStore } from '../../store/themeStore';

jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn(), auth: {} } }));

const STORE_DIR = path.join(__dirname, '../../store');

function storeExportsOnDisk(): string[] {
  const names: string[] = [];
  for (const f of fs.readdirSync(STORE_DIR)) {
    if (!f.endsWith('.ts') || f === 'resetAllStores.ts') continue;
    const src = fs.readFileSync(path.join(STORE_DIR, f), 'utf8');
    for (const m of src.matchAll(/export const (use\w+Store) = create/g)) names.push(m[1]);
  }
  return names.sort();
}

describe('resetAllStores', () => {
  it('every zustand store is either reset on sign-out or declared device-level with a reason', () => {
    const registered = [...Object.keys(PER_USER_STORES), ...Object.keys(DEVICE_STORES)].sort();
    expect(registered).toEqual(storeExportsOnDisk());
    for (const reason of Object.values(DEVICE_STORES)) expect(reason.length).toBeGreaterThan(20);
  });

  it('wipes her Archive votes, feed likes, follows, blocks and profile', () => {
    useArchiveStore.setState({ myVotes: { e1: 5 }, watchlist: ['e2'], noteAgreements: ['n1'] });
    useFeedStore.setState({ likedPostIds: new Set(['p1']), savedPostIds: new Set(['p2']) });
    useFollowStore.setState({ followingIds: new Set(['u2']), hydrated: true });
    useSafetyStore.setState({ blockedUserIds: ['u9'], mutedUserIds: ['u8'] });
    useProfileStore.setState({ profile: { id: 'a' } as never });

    resetAllStores();

    expect(useArchiveStore.getState().myVotes).toEqual({});
    expect(useArchiveStore.getState().watchlist).toEqual([]);
    expect(useArchiveStore.getState().noteAgreements).toEqual([]);
    expect([...useFeedStore.getState().likedPostIds]).toEqual([]);
    expect([...useFeedStore.getState().savedPostIds]).toEqual([]);
    expect([...useFollowStore.getState().followingIds]).toEqual([]);
    expect(useFollowStore.getState().hydrated).toBe(false);
    expect(useSafetyStore.getState().blockedUserIds).toEqual([]);
    expect(useSafetyStore.getState().mutedUserIds).toEqual([]);
    expect(useProfileStore.getState().profile).toBeNull();
  });

  it('keeps the actions working after a reset (the store is reset, not emptied)', () => {
    resetAllStores();
    expect(typeof useFollowStore.getState().follow).toBe('function');
    expect(typeof useArchiveStore.getState().vote).toBe('function');
    expect(typeof useFeedStore.getState().toggleLike).toBe('function');
  });

  it("forgets her chat settings, so the next woman on this phone loads her own (chat2 x ARC-08)", () => {
    const { useChatSettingsStore } = jest.requireActual('../../store/chatSettingsStore');
    const initial = useChatSettingsStore.getInitialState().settings;
    useChatSettingsStore.setState({ settings: { ...initial, read_receipts: !initial.read_receipts }, loaded: true });
    resetAllStores();
    expect(useChatSettingsStore.getState().loaded).toBe(false);
    expect(useChatSettingsStore.getState().settings).toEqual(initial);
  });

  it('a failing store does not stop the others from resetting', () => {
    const spy = jest.spyOn(useGateStore, 'setState').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    useFollowStore.setState({ followingIds: new Set(['u2']) });
    expect(() => resetAllStores()).not.toThrow();
    expect([...useFollowStore.getState().followingIds]).toEqual([]);
    spy.mockRestore();
  });

  it('leaves the device theme alone', () => {
    const before = useThemeStore.getState();
    resetAllStores();
    expect(useThemeStore.getState()).toBe(before);
  });
});
