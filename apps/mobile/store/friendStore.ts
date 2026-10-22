import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { Analytics } from '../lib/analytics';
import { fetchOnlineIds, presenceStamp } from '../lib/memberPresence';

export type ProfileSnippet = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  last_seen_at: string | null;
};

export type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  profile: ProfileSnippet;
};

export function isOnline(last_seen_at: string | null): boolean {
  if (!last_seen_at) return false;
  return Date.now() - new Date(last_seen_at).getTime() < 5 * 60 * 1000;
}

export function sortByPresence(friends: FriendshipRow[]): FriendshipRow[] {
  return [...friends].sort((a, b) => {
    const aTime = a.profile.last_seen_at ? new Date(a.profile.last_seen_at).getTime() : 0;
    const bTime = b.profile.last_seen_at ? new Date(b.profile.last_seen_at).getTime() : 0;
    return bTime - aTime;
  });
}

type FriendStore = {
  friends: FriendshipRow[];
  pendingReceived: FriendshipRow[];
  pendingSent: FriendshipRow[];
  pendingCount: number;
  _userId: string | null;
  _lastHeartbeat: number;
  fetchAll: (userId: string) => Promise<void>;
  /** `who` (optional) names her in the provisional row until the refetch lands. */
  sendRequest: (targetId: string, who?: Partial<ProfileSnippet>) => Promise<void>;
  acceptRequest: (friendshipId: string) => Promise<void>;
  rejectRequest: (friendshipId: string) => Promise<void>;
  cancelRequest: (friendshipId: string) => Promise<void>;
  unfriend: (friendshipId: string) => Promise<void>;
};

export const useFriendStore = create<FriendStore>((set, get) => ({
  friends: [],
  pendingReceived: [],
  pendingSent: [],
  pendingCount: 0,
  _userId: null,
  _lastHeartbeat: 0,

  fetchAll: async (userId) => {
    // Rate-capped heartbeat: update last_seen_at at most once per 5 minutes
    const now = Date.now();
    if (now - get()._lastHeartbeat > 5 * 60 * 1000) {
      const { error } = await supabase
        .from('profiles')
        .update({ last_seen_at: new Date(now).toISOString() })
        .eq('id', userId);
      if (!error) {
        set({ _lastHeartbeat: now });
      }
    }
    set({ _userId: userId });
    const { data } = await supabase
      .from('friendships')
      .select(`
        id, requester_id, addressee_id, status, created_at,
        requester:profiles!requester_id(id, display_name, username, avatar_url),
        addressee:profiles!addressee_id(id, display_name, username, avatar_url)
      `)
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

    const fetched = (data ?? []) as any[];
    // last_seen_at is no longer readable on another member's row (130 /
    // PRO-01). member_presence() answers "online now" for accepted friends
    // only; the stamp keeps isOnline/sortByPresence working and is not a time.
    const friendIds = fetched
      .filter((r) => r.status === 'accepted')
      .map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id) as string);
    const online = await fetchOnlineIds(friendIds);
    const stamp = (p: any) => (p ? { ...p, last_seen_at: presenceStamp(online.has(p.id)) } : p);
    const rows = fetched.map((r) => ({ ...r, requester: stamp(r.requester), addressee: stamp(r.addressee) }));

    const friends: FriendshipRow[] = rows
      .filter((r) => r.status === 'accepted')
      .map((r) => ({
        ...r,
        profile: (r.requester_id === userId ? r.addressee : r.requester) as ProfileSnippet,
      }));

    const pendingReceived: FriendshipRow[] = rows
      .filter((r) => r.status === 'pending' && r.addressee_id === userId)
      .map((r) => ({ ...r, profile: r.requester as ProfileSnippet }));

    const pendingSent: FriendshipRow[] = rows
      .filter((r) => r.status === 'pending' && r.requester_id === userId)
      .map((r) => ({ ...r, profile: r.addressee as ProfileSnippet }));

    set({ friends, pendingReceived, pendingSent, pendingCount: pendingReceived.length });
  },

  // Every action below is optimistic (motion spec F10): the lists change
  // before the first `await`, so the button she tapped answers in the same
  // frame. A refused write undoes ONLY the row it touched (a refetch may have
  // changed the rest meanwhile) and rethrows, so the screen can say so and
  // offer Retry. A successful write still refetches, which replaces the
  // provisional row with the server's.

  sendRequest: async (targetId, who) => {
    // She already asked first: accept hers rather than file a second request in
    // the other direction (friendships is UNIQUE per direction, not per pair).
    const theirs = get().pendingReceived.find((r) => r.requester_id === targetId);
    if (theirs) {
      await get().acceptRequest(theirs.id);
      return;
    }

    const known = get()._userId;
    const provisional: FriendshipRow = {
      id: `${OPTIMISTIC_PREFIX}${targetId}`,
      requester_id: known ?? '',
      addressee_id: targetId,
      status: 'pending',
      created_at: new Date().toISOString(),
      profile: {
        display_name: '', username: '', avatar_url: null, last_seen_at: null, ...who, id: targetId,
      },
    };
    if (!get().pendingSent.some((r) => r.profile.id === targetId)) {
      set((st) => ({ pendingSent: [...st.pendingSent, provisional] }));
    }
    const undo = () => set((st) => ({ pendingSent: st.pendingSent.filter((r) => r.id !== provisional.id) }));

    // The id comes from the session when this store has not been loaded yet.
    // `_userId` used to be the only source, and only fetchAll() set it — so on
    // any screen that never called fetchAll (a profile opened from the feed,
    // search or a link) "Add friend" returned here and did nothing, silently.
    let userId: string | null = known;
    try {
      userId = known ?? (await supabase.auth.getUser()).data.user?.id ?? null;
    } catch (e) {
      undo();
      throw e;
    }
    if (!userId) {
      undo();
      throw new Error('You need to be signed in to add a friend.');
    }
    if (userId !== get()._userId) set({ _userId: userId });

    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: userId, addressee_id: targetId });
    if (error && error.code !== '23505') {
      undo();
      throw error;
    }
    Analytics.friendRequestSent(targetId);
    await get().fetchAll(userId);
  },

  acceptRequest: async (friendshipId) => {
    const { _userId } = get();
    const row = get().pendingReceived.find((r) => r.id === friendshipId);
    if (row) {
      set((st) => {
        const pendingReceived = st.pendingReceived.filter((r) => r.id !== friendshipId);
        return {
          pendingReceived,
          pendingCount: pendingReceived.length,
          friends: [...st.friends, { ...row, status: 'accepted' }],
        };
      });
    }
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);
    if (error) {
      if (row) {
        set((st) => {
          const pendingReceived = st.pendingReceived.some((r) => r.id === friendshipId)
            ? st.pendingReceived
            : [...st.pendingReceived, row];
          return {
            friends: st.friends.filter((f) => f.id !== friendshipId),
            pendingReceived,
            pendingCount: pendingReceived.length,
          };
        });
      }
      throw error;
    }
    Analytics.friendRequestAccepted(friendshipId);
    if (_userId) await get().fetchAll(_userId);
  },

  rejectRequest: async (friendshipId) => {
    await removeRow(set, get, 'pendingReceived', friendshipId);
    Analytics.friendRequestDeclined(friendshipId);
    const { _userId } = get();
    if (_userId) await get().fetchAll(_userId);
  },

  cancelRequest: async (friendshipId) => {
    await removeRow(set, get, 'pendingSent', friendshipId);
    Analytics.friendRequestCancelled(friendshipId);
    const { _userId } = get();
    if (_userId) await get().fetchAll(_userId);
  },

  unfriend: async (friendshipId) => {
    await removeRow(set, get, 'friends', friendshipId);
    Analytics.friendRemoved(friendshipId);
    const { _userId } = get();
    if (_userId) await get().fetchAll(_userId);
  },
}));

/** Id prefix of a request drawn before the server has answered. */
export const OPTIMISTIC_PREFIX = 'optimistic:';

type ListKey = 'friends' | 'pendingReceived' | 'pendingSent';
type SetFn = (fn: (st: FriendStore) => Partial<FriendStore>) => void;

/**
 * Delete one friendship row optimistically: it leaves `list` now, comes back
 * (and the error is rethrown) if the server refuses. Decline, cancel and
 * unfriend are the same write with a different list.
 */
async function removeRow(set: SetFn, get: () => FriendStore, list: ListKey, friendshipId: string): Promise<void> {
  const before = get()[list];
  const index = before.findIndex((r) => r.id === friendshipId);
  const row = index >= 0 ? before[index] : null;
  if (row) {
    set((st) => {
      const next = st[list].filter((r) => r.id !== friendshipId);
      return list === 'pendingReceived' ? { [list]: next, pendingCount: next.length } : { [list]: next };
    });
  }
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', friendshipId);
  if (error) {
    if (row) {
      set((st) => {
        if (st[list].some((r) => r.id === friendshipId)) return {};
        const next = [...st[list]];
        next.splice(Math.min(index, next.length), 0, row);
        return list === 'pendingReceived' ? { [list]: next, pendingCount: next.length } : { [list]: next };
      });
    }
    throw error;
  }
}
