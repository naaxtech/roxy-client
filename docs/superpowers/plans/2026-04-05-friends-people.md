# Friends & People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full friends management system — dedicated People screen from Grow, pending-request badge on Grow tab icon, and a full-screen community members screen replacing the current modal.

**Architecture:** A Zustand `friendStore` holds all friendship state (friends, pendingReceived, pendingSent). Two new screens consume it: `grow/people.tsx` (3 sub-tabs: Friends / Requests / Sent) and `discover/community/members/[communityId].tsx` (stack page). The main tab layout reads `pendingCount` for a badge dot. Community detail loses its modal entirely.

**Tech Stack:** Expo Router v3, Zustand, Supabase JS v2, React Native, Jest + @testing-library/react-native

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `store/friendStore.ts` | Create | All friendship state + actions |
| `app/(tabs)/grow/people.tsx` | Create | Friends / Requests / Sent screen |
| `app/(tabs)/grow/index.tsx` | Modify | "My People" tap → navigate to people |
| `app/(tabs)/_layout.tsx` | Modify | Badge dot on Grow icon when pendingCount > 0 |
| `app/(tabs)/discover/community/members/[communityId].tsx` | Create | Full-screen members list |
| `app/(tabs)/discover/community/[id].tsx` | Modify | Remove modal, wire "N members" → members screen |
| `__tests__/store/friendStore.test.ts` | Create | Unit tests for store |
| `.maestro/flows/friends_request_accept.yaml` | Create | E2E: accept flow |
| `.maestro/flows/friends_request_decline.yaml` | Create | E2E: decline flow |
| `.maestro/flows/community_members_screen.yaml` | Create | E2E: members screen |

---

## Types (used throughout all tasks)

```ts
// store/friendStore.ts — top of file, exported
export type ProfileSnippet = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
};

export type FriendshipRow = {
  id: string;              // friendship row id — used for accept/reject/unfriend
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  profile: ProfileSnippet; // the OTHER person (not the current user)
};
```

`friends`, `pendingReceived`, and `pendingSent` are all `FriendshipRow[]`. Using one type for all three keeps the store uniform and avoids needing a separate "profile + friendshipId" type for unfriending.

---

## Task 1: friendStore — scaffold + initial test

**Files:**
- Create: `store/friendStore.ts`
- Create: `__tests__/store/friendStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/store/friendStore.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react-native';
import { useFriendStore } from '../../store/friendStore';

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const { supabase } = jest.requireMock('../../lib/supabase');

const mkProfile = (id: string, name: string) => ({
  id, display_name: name, username: name.toLowerCase().replace(' ', ''), avatar_url: null,
});

const mkRow = (
  id: string, requesterId: string, addresseeId: string, status: string,
  requesterProfile: any, addresseeProfile: any,
) => ({
  id, requester_id: requesterId, addressee_id: addresseeId, status,
  created_at: new Date().toISOString(),
  requester: requesterProfile,
  addressee: addresseeProfile,
});

describe('friendStore', () => {
  beforeEach(() => {
    useFriendStore.setState({
      friends: [], pendingReceived: [], pendingSent: [], _userId: null,
    });
    jest.clearAllMocks();
  });

  it('initialises with empty state', () => {
    const { result } = renderHook(() => useFriendStore());
    expect(result.current.friends).toEqual([]);
    expect(result.current.pendingReceived).toEqual([]);
    expect(result.current.pendingSent).toEqual([]);
    expect(result.current.pendingCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/mobile && npx jest __tests__/store/friendStore.test.ts --no-coverage
```
Expected: FAIL — "Cannot find module '../../store/friendStore'"

- [ ] **Step 3: Create the store scaffold**

Create `apps/mobile/store/friendStore.ts`:

```ts
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type ProfileSnippet = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
};

export type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  profile: ProfileSnippet;
};

type FriendStore = {
  friends: FriendshipRow[];
  pendingReceived: FriendshipRow[];
  pendingSent: FriendshipRow[];
  pendingCount: number;
  _userId: string | null;
  fetchAll: (userId: string) => Promise<void>;
  sendRequest: (targetId: string) => Promise<void>;
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

  fetchAll: async (userId) => { set({ _userId: userId }); },
  sendRequest: async (_targetId) => {},
  acceptRequest: async (_id) => {},
  rejectRequest: async (_id) => {},
  cancelRequest: async (_id) => {},
  unfriend: async (_id) => {},
}));
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd apps/mobile && npx jest __tests__/store/friendStore.test.ts --no-coverage
```
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
cd apps/mobile && git checkout -b session-9-friends
git add store/friendStore.ts __tests__/store/friendStore.test.ts
git commit -m "feat: friendStore scaffold + initial test"
```

---

## Task 2: friendStore — fetchAll

**Files:**
- Modify: `store/friendStore.ts`
- Modify: `__tests__/store/friendStore.test.ts`

- [ ] **Step 1: Add fetchAll tests**

Add inside the `describe` block in `__tests__/store/friendStore.test.ts`:

```ts
  it('fetchAll splits rows into friends / pendingReceived / pendingSent', async () => {
    const ME = 'user-me';
    const alice = mkProfile('user-alice', 'Alice');
    const bob   = mkProfile('user-bob',   'Bob');
    const carol = mkProfile('user-carol', 'Carol');
    const me    = mkProfile(ME, 'Me');

    const rows = [
      mkRow('f1', alice.id, ME, 'accepted', alice, me),  // accepted — Alice requested me
      mkRow('f2', bob.id,   ME, 'pending',  bob,   me),  // pending received — Bob requested me
      mkRow('f3', ME, carol.id, 'pending',  me,   carol), // pending sent — I requested Carol
    ];

    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      or: jest.fn().mockResolvedValue({ data: rows, error: null }),
    });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.fetchAll(ME); });

    // friends: Alice (addressee_id = ME so requester = Alice is the other person)
    expect(result.current.friends).toHaveLength(1);
    expect(result.current.friends[0].profile.id).toBe(alice.id);

    // pendingReceived: Bob
    expect(result.current.pendingReceived).toHaveLength(1);
    expect(result.current.pendingReceived[0].id).toBe('f2');
    expect(result.current.pendingReceived[0].profile.id).toBe(bob.id);

    // pendingSent: Carol
    expect(result.current.pendingSent).toHaveLength(1);
    expect(result.current.pendingSent[0].id).toBe('f3');
    expect(result.current.pendingSent[0].profile.id).toBe(carol.id);

    expect(result.current.pendingCount).toBe(1);
  });

  it('fetchAll handles null data gracefully', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      or: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.fetchAll('user-me'); });
    expect(result.current.friends).toEqual([]);
    expect(result.current.pendingCount).toBe(0);
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/mobile && npx jest __tests__/store/friendStore.test.ts --no-coverage
```
Expected: FAIL — fetchAll is a no-op

- [ ] **Step 3: Implement fetchAll**

Replace `fetchAll` stub in `store/friendStore.ts`:

```ts
  fetchAll: async (userId) => {
    set({ _userId: userId });
    const { data } = await supabase
      .from('friendships')
      .select(`
        id, requester_id, addressee_id, status, created_at,
        requester:profiles!requester_id(id, display_name, username, avatar_url),
        addressee:profiles!addressee_id(id, display_name, username, avatar_url)
      `)
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

    const rows = (data ?? []) as any[];

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
```

- [ ] **Step 4: Run to verify all pass**

```bash
cd apps/mobile && npx jest __tests__/store/friendStore.test.ts --no-coverage
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/store/friendStore.ts apps/mobile/__tests__/store/friendStore.test.ts
git commit -m "feat: friendStore fetchAll — splits friends/received/sent by status+direction"
```

---

## Task 3: friendStore — mutation actions

**Files:**
- Modify: `store/friendStore.ts`
- Modify: `__tests__/store/friendStore.test.ts`

- [ ] **Step 1: Add mutation tests**

Add inside the `describe` block:

```ts
  it('sendRequest inserts and refreshes state', async () => {
    const ME = 'user-me';
    const carol = mkProfile('user-carol', 'Carol');
    useFriendStore.setState({ _userId: ME });

    const insertMock = jest.fn().mockResolvedValue({ error: null });
    const orMock = jest.fn().mockResolvedValue({
      data: [mkRow('f-new', ME, carol.id, 'pending', mkProfile(ME, 'Me'), carol)],
      error: null,
    });
    supabase.from
      .mockReturnValueOnce({ insert: insertMock })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: orMock });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.sendRequest(carol.id); });

    expect(insertMock).toHaveBeenCalledWith({ requester_id: ME, addressee_id: carol.id });
    expect(result.current.pendingSent).toHaveLength(1);
    expect(result.current.pendingSent[0].profile.id).toBe(carol.id);
  });

  it('sendRequest swallows 23505 duplicate key error', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    supabase.from
      .mockReturnValueOnce({
        insert: jest.fn().mockResolvedValue({ error: { code: '23505', message: 'dup' } }),
      })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await expect(
      act(async () => { await result.current.sendRequest('user-other'); })
    ).resolves.not.toThrow();
  });

  it('acceptRequest updates status to accepted and refreshes', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from
      .mockReturnValueOnce({ update: jest.fn().mockReturnValue({ eq: eqMock }) })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.acceptRequest('friendship-1'); });

    expect(eqMock).toHaveBeenCalledWith('id', 'friendship-1');
  });

  it('rejectRequest deletes the row and refreshes', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from
      .mockReturnValueOnce({ delete: jest.fn().mockReturnValue({ eq: eqMock }) })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.rejectRequest('friendship-1'); });

    expect(eqMock).toHaveBeenCalledWith('id', 'friendship-1');
  });

  it('cancelRequest deletes the row and refreshes', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from
      .mockReturnValueOnce({ delete: jest.fn().mockReturnValue({ eq: eqMock }) })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.cancelRequest('friendship-1'); });

    expect(eqMock).toHaveBeenCalledWith('id', 'friendship-1');
  });

  it('unfriend deletes the row and refreshes', async () => {
    useFriendStore.setState({ _userId: 'user-me' });
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    supabase.from
      .mockReturnValueOnce({ delete: jest.fn().mockReturnValue({ eq: eqMock }) })
      .mockReturnValue({ select: jest.fn().mockReturnThis(), or: jest.fn().mockResolvedValue({ data: [], error: null }) });

    const { result } = renderHook(() => useFriendStore());
    await act(async () => { await result.current.unfriend('friendship-1'); });

    expect(eqMock).toHaveBeenCalledWith('id', 'friendship-1');
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/mobile && npx jest __tests__/store/friendStore.test.ts --no-coverage
```
Expected: FAIL (6 new failures)

- [ ] **Step 3: Implement all mutation actions**

Replace the five stub actions in `store/friendStore.ts`:

```ts
  sendRequest: async (targetId) => {
    const { _userId } = get();
    if (!_userId) return;
    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: _userId, addressee_id: targetId });
    if (error && error.code !== '23505') throw error;
    await get().fetchAll(_userId);
  },

  acceptRequest: async (friendshipId) => {
    const { _userId } = get();
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);
    if (error) throw error;
    if (_userId) await get().fetchAll(_userId);
  },

  rejectRequest: async (friendshipId) => {
    const { _userId } = get();
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) throw error;
    if (_userId) await get().fetchAll(_userId);
  },

  cancelRequest: async (friendshipId) => {
    const { _userId } = get();
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) throw error;
    if (_userId) await get().fetchAll(_userId);
  },

  unfriend: async (friendshipId) => {
    const { _userId } = get();
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) throw error;
    if (_userId) await get().fetchAll(_userId);
  },
```

- [ ] **Step 4: Run full suite to verify nothing broken**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```
Expected: All pass (91+ tests)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/store/friendStore.ts apps/mobile/__tests__/store/friendStore.test.ts
git commit -m "feat: friendStore — sendRequest, acceptRequest, rejectRequest, cancelRequest, unfriend"
```

---

## Task 4: grow/people.tsx — Friends screen

**Files:**
- Create: `app/(tabs)/grow/people.tsx`

- [ ] **Step 1: Create the screen**

Create `apps/mobile/app/(tabs)/grow/people.tsx`:

```tsx
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useFriendStore, FriendshipRow } from '../../../store/friendStore';
import { COLORS } from '../../../lib/constants';

type SubTab = 'friends' | 'requests' | 'sent';

function AvatarCircle({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{name?.[0]?.toUpperCase() ?? '?'}</Text>
    </View>
  );
}

export default function PeopleScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    friends, pendingReceived, pendingSent,
    fetchAll, acceptRequest, rejectRequest, cancelRequest, unfriend,
  } = useFriendStore();
  const [subTab, setSubTab] = useState<SubTab>('friends');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchAll(user.id).finally(() => setLoading(false));
  }, [user?.id]);

  const confirmUnfriend = (item: FriendshipRow) => {
    Alert.alert('Remove friend', `Remove ${item.profile.display_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try { await unfriend(item.id); }
          catch (e: any) { Alert.alert('Error', e?.message); }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My People</Text>
      </View>

      <View style={styles.subTabRow}>
        {(['friends', 'requests', 'sent'] as SubTab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.subTab, subTab === tab && styles.subTabActive]}
            onPress={() => setSubTab(tab)}
          >
            <Text style={[styles.subTabText, subTab === tab && styles.subTabTextActive]}>
              {tab === 'friends' ? 'Friends'
                : tab === 'requests'
                  ? `Requests${pendingReceived.length > 0 ? ` (${pendingReceived.length})` : ''}`
                  : 'Sent'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 40 }} />
      ) : (
        <>
          {subTab === 'friends' && (
            <FlatList
              data={friends}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No friends yet. Find people in communities! 💜</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <AvatarCircle name={item.profile.display_name} />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{item.profile.display_name}</Text>
                    <Text style={styles.rowSub}>@{item.profile.username}</Text>
                  </View>
                  <TouchableOpacity style={styles.mutedBtn} onPress={() => confirmUnfriend(item)}>
                    <Text style={styles.mutedBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}

          {subTab === 'requests' && (
            <FlatList
              data={pendingReceived}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No pending requests</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <AvatarCircle name={item.profile.display_name} />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{item.profile.display_name}</Text>
                    <Text style={styles.rowSub}>@{item.profile.username}</Text>
                  </View>
                  <View style={styles.actionBtns}>
                    <TouchableOpacity
                      style={styles.acceptBtn}
                      onPress={async () => {
                        try { await acceptRequest(item.id); }
                        catch (e: any) { Alert.alert('Error', e?.message); }
                      }}
                    >
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.mutedBtn}
                      onPress={async () => {
                        try { await rejectRequest(item.id); }
                        catch (e: any) { Alert.alert('Error', e?.message); }
                      }}
                    >
                      <Text style={styles.mutedBtnText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />
          )}

          {subTab === 'sent' && (
            <FlatList
              data={pendingSent}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No sent requests</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <AvatarCircle name={item.profile.display_name} />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{item.profile.display_name}</Text>
                    <Text style={styles.rowSub}>@{item.profile.username}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.mutedBtn}
                    onPress={async () => {
                      try { await cancelRequest(item.id); }
                      catch (e: any) { Alert.alert('Error', e?.message); }
                    }}
                  >
                    <Text style={styles.mutedBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  subTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  subTab: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  subTabActive: { borderBottomColor: COLORS.roxy },
  subTabText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  subTabTextActive: { color: COLORS.roxy, fontWeight: '700' },
  listContent: { paddingVertical: 4, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.primary + '40',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },
  rowInfo: { flex: 1 },
  rowName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  rowSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  actionBtns: { flexDirection: 'row', gap: 8 },
  acceptBtn: {
    backgroundColor: COLORS.roxy, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  mutedBtn: {
    borderWidth: 1, borderColor: COLORS.textMuted + '60', borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  mutedBtnText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
```

- [ ] **Step 2: Run full suite to confirm no regressions**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/grow/people.tsx
git commit -m "feat: grow/people.tsx — Friends/Requests/Sent screen"
```

---

## Task 5: Wire navigation + badge

**Files:**
- Modify: `app/(tabs)/grow/index.tsx`
- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Read current grow/index.tsx "My People" section**

Look for the section that renders friends count/avatars (around line 140-165). It renders a `TouchableOpacity` or `View` with friend emoji avatars.

- [ ] **Step 2: Update grow/index.tsx — navigate on "My People" tap**

In `grow/index.tsx`, add `useRouter` import and update the "My People" `TouchableOpacity` (or wrap the section in one) to navigate to the people screen:

```tsx
// At top — add router
import { useRouter } from 'expo-router';
// Inside component:
const router = useRouter();

// Wrap the entire "My People" section in a TouchableOpacity:
<TouchableOpacity onPress={() => router.push('/(tabs)/grow/people' as any)} activeOpacity={0.8}>
  {/* existing My People content */}
</TouchableOpacity>
```

Also add `fetchAll` call in `grow/index.tsx` when user mounts, so the badge updates:

```tsx
import { useFriendStore } from '../../../store/friendStore';
// In component:
const { fetchAll } = useFriendStore();
useEffect(() => {
  if (user?.id) fetchAll(user.id);
}, [user?.id]);
```

- [ ] **Step 3: Read app/(tabs)/_layout.tsx**

Read the file to see how tabs are defined — look for the Grow `<Tabs.Screen>` entry.

- [ ] **Step 4: Add badge to Grow tab in _layout.tsx**

Add `useFriendStore` import and `pendingCount` to the layout component, then set `tabBarBadge`:

```tsx
import { useFriendStore } from '../../store/friendStore';
// Inside the layout component function body:
const pendingCount = useFriendStore((s) => s.pendingCount);

// On the Grow Tabs.Screen, add to options:
tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
```

- [ ] **Step 5: Run full suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/app/(tabs)/grow/index.tsx" "apps/mobile/app/(tabs)/_layout.tsx"
git commit -m "feat: wire My People → people screen + badge on Grow tab"
```

---

## Task 6: discover/community/members/[communityId].tsx

**Files:**
- Create: `app/(tabs)/discover/community/members/[communityId].tsx`

- [ ] **Step 1: Create the members screen**

Create `apps/mobile/app/(tabs)/discover/community/members/[communityId].tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../../lib/supabase';
import { useAuthStore } from '../../../../../store/authStore';
import { useFriendStore } from '../../../../../store/friendStore';
import { COLORS } from '../../../../../lib/constants';

type MemberProfile = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
};

type FriendshipState = 'none' | 'sent' | 'received' | 'friends';

export default function MembersScreen() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { friends, pendingReceived, pendingSent, sendRequest, acceptRequest, fetchAll } = useFriendStore();

  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  // track locally who we just sent a request to this session
  const [justSent, setJustSent] = useState<Set<string>>(new Set());

  const loadMembers = useCallback(async () => {
    if (!communityId) return;
    const { data } = await supabase
      .from('community_members')
      .select('profiles(id, display_name, username, avatar_url)')
      .eq('community_id', communityId)
      .limit(100);
    if (data) {
      setMembers((data as any[]).map((r) => r.profiles).filter(Boolean) as MemberProfile[]);
    }
  }, [communityId]);

  useEffect(() => {
    (async () => {
      await loadMembers();
      if (user?.id) await fetchAll(user.id);
      setLoading(false);
    })();
  }, [communityId]);

  const friendIds = new Set(friends.map((f) => f.profile.id));
  const receivedMap = new Map(pendingReceived.map((f) => [f.profile.id, f.id]));
  const sentIds = new Set([...pendingSent.map((f) => f.profile.id), ...justSent]);

  const getFriendshipState = (memberId: string): FriendshipState => {
    if (friendIds.has(memberId)) return 'friends';
    if (receivedMap.has(memberId)) return 'received';
    if (sentIds.has(memberId)) return 'sent';
    return 'none';
  };

  const handleAddFriend = async (memberId: string) => {
    try {
      await sendRequest(memberId);
      setJustSent((prev) => new Set([...prev, memberId]));
    } catch (e: any) {
      Alert.alert('Error', e?.message);
    }
  };

  const handleAccept = async (memberId: string) => {
    const friendshipId = receivedMap.get(memberId);
    if (!friendshipId) return;
    try {
      await acceptRequest(friendshipId);
    } catch (e: any) {
      Alert.alert('Error', e?.message);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Members</Text>
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No members yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSelf = item.id === user?.id;
          const state = isSelf ? 'self' : getFriendshipState(item.id);
          return (
            <View style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{item.display_name}</Text>
                <Text style={styles.rowSub}>@{item.username}</Text>
              </View>
              {state === 'none' && (
                <TouchableOpacity style={styles.addBtn} onPress={() => handleAddFriend(item.id)}>
                  <Text style={styles.addBtnText}>Add Friend</Text>
                </TouchableOpacity>
              )}
              {state === 'sent' && (
                <View style={styles.requestedChip}>
                  <Text style={styles.requestedText}>Requested</Text>
                </View>
              )}
              {state === 'received' && (
                <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(item.id)}>
                  <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
              )}
              {state === 'friends' && (
                <Text style={styles.friendsLabel}>Friends 💜</Text>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  listContent: { paddingVertical: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 14 },
  rowInfo: { flex: 1 },
  rowName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  rowSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  addBtn: {
    borderWidth: 1, borderColor: COLORS.roxy, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  addBtnText: { color: COLORS.roxy, fontWeight: '700', fontSize: 12 },
  requestedChip: {
    borderWidth: 1, borderColor: COLORS.textMuted + '60', borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  requestedText: { color: COLORS.textMuted, fontSize: 12 },
  acceptBtn: {
    backgroundColor: COLORS.roxy, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  friendsLabel: { color: COLORS.roxy, fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: COLORS.textMuted, fontSize: 14 },
});
```

- [ ] **Step 2: Run full suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/app/(tabs)/discover/community/members/[communityId].tsx"
git commit -m "feat: community members full-screen stack page with friendship state buttons"
```

---

## Task 7: Remove modal from [id].tsx, wire to members screen

**Files:**
- Modify: `app/(tabs)/discover/community/[id].tsx`

- [ ] **Step 1: Read the file**

Read `apps/mobile/app/(tabs)/discover/community/[id].tsx` — locate:
- `membersModalVisible`, `members`, `friendships` state declarations
- `loadMembers`, `openMembersModal`, `sendFriendRequest` functions
- The `<Modal>` block at the bottom
- The `TouchableOpacity` that calls `openMembersModal` (the "N members" line)

- [ ] **Step 2: Remove modal state and functions**

Delete these state declarations:
```tsx
const [membersModalVisible, setMembersModalVisible] = useState(false);
const [members, setMembers] = useState<MemberRow[]>([]);
const [friendships, setFriendships] = useState<Set<string>>(new Set());
```

Delete these functions entirely: `loadMembers`, `openMembersModal`, `sendFriendRequest`.

Delete the `MemberRow` type definition.

- [ ] **Step 3: Replace "N members" tap with navigation**

Find the `TouchableOpacity` that calls `openMembersModal`:
```tsx
<TouchableOpacity onPress={openMembersModal} style={styles.membersRow}>
```

Replace with:
```tsx
<TouchableOpacity
  onPress={() => router.push(`/(tabs)/discover/community/members/${id}` as any)}
  style={styles.membersRow}
>
```

- [ ] **Step 4: Delete the Members Modal JSX**

Delete the entire `<Modal visible={membersModalVisible} ...>...</Modal>` block (the members modal — not the other modal if any exists). Keep other content intact.

- [ ] **Step 5: Run full suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/app/(tabs)/discover/community/[id].tsx"
git commit -m "refactor: remove members modal from community detail, navigate to members screen"
```

---

## Task 8: Maestro flows

**Files:**
- Create: `.maestro/flows/friends_request_accept.yaml`
- Create: `.maestro/flows/friends_request_decline.yaml`
- Create: `.maestro/flows/community_members_screen.yaml`

- [ ] **Step 1: Create accept flow**

Create `.maestro/flows/friends_request_accept.yaml`:

```yaml
# Test: Send friend request from community members, then accept it.
# Prerequisites: Two accounts available. Run with first account signed in.
# Note: Full accept flow requires two devices/accounts — this tests the Requests tab UI.
appId: com.roxy.app
---
- tapOn:
    text: "Discover"
- scrollUntilVisible:
    element:
      text: "Queer Gamers"
    direction: DOWN
    timeout: 5000
- tapOn:
    text: "Queer Gamers"
- tapOn:
    text: "members"
- assertVisible:
    text: "Members"
    timeout: 3000
- tapOn:
    text: "Add Friend"
    index: 0
- assertVisible:
    text: "Requested"
    timeout: 3000
- back
- tapOn:
    text: "Grow"
- tapOn:
    text: "My People"
- assertVisible:
    text: "My People"
    timeout: 3000
- tapOn:
    text: "Sent"
- assertVisible:
    text: "Cancel"
    timeout: 3000
```

- [ ] **Step 2: Create decline flow**

Create `.maestro/flows/friends_request_decline.yaml`:

```yaml
# Test: Decline a pending friend request from the Requests tab.
# Prerequisites: Another account must have sent a friend request to this user.
appId: com.roxy.app
---
- tapOn:
    text: "Grow"
- tapOn:
    text: "My People"
- assertVisible:
    text: "My People"
    timeout: 3000
- tapOn:
    text: "Requests"
- assertVisible:
    text: "Decline"
    timeout: 3000
- tapOn:
    text: "Decline"
    index: 0
- waitForAnimationToEnd:
    timeout: 2000
# Row should be gone
- assertNotVisible:
    text: "Decline"
```

- [ ] **Step 3: Create members screen flow**

Create `.maestro/flows/community_members_screen.yaml`:

```yaml
# Test: Navigate to full-screen members page from community detail.
appId: com.roxy.app
---
- tapOn:
    text: "Discover"
- scrollUntilVisible:
    element:
      text: "Queer Gamers"
    direction: DOWN
    timeout: 5000
- tapOn:
    text: "Queer Gamers"
- tapOn:
    text: "members"
- assertVisible:
    text: "Members"
    timeout: 3000
- assertNotVisible:
    text: "Members"
    index: 1
# Verify it's a stack screen (back button present, not a modal)
- assertVisible:
    text: "Add Friend"
    timeout: 3000
- back
# Back to community detail
- assertVisible:
    text: "Posts"
    timeout: 2000
```

- [ ] **Step 4: Commit**

```bash
git add .maestro/flows/
git commit -m "test: Maestro flows — friend request accept/decline, community members screen"
```

---

## Task 9: Final verification + PR

- [ ] **Step 1: Run complete test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```
Expected: All pass

- [ ] **Step 2: Push branch and open PR**

```bash
git push origin session-9-friends
gh pr create --base main --title "feat: session 9 — friends, people screen, community members" \
  --body "Friends store, My People screen (Friends/Requests/Sent), Grow tab badge, community members full-screen page."
```

---

## Self-Review

**Spec coverage check:**
- ✅ `friendStore` with fetchAll, sendRequest, acceptRequest, rejectRequest, cancelRequest, unfriend — Tasks 1-3
- ✅ `pendingCount` derived from `pendingReceived.length` — Task 2 fetchAll sets it
- ✅ `grow/people.tsx` Friends/Requests/Sent sub-tabs — Task 4
- ✅ Grow tab badge via `tabBarBadge` — Task 5
- ✅ "My People" tap navigates — Task 5
- ✅ Community members full-screen — Task 6
- ✅ Modal removed from `[id].tsx` — Task 7
- ✅ 23505 error swallowed in sendRequest — Task 3
- ✅ Accept cancelled request handled by fetchAll refresh — Task 3 (acceptRequest calls fetchAll after update)
- ✅ All screens wrap in try/catch + Alert — Task 4, 6
- ✅ Jest tests for all store actions — Tasks 1-3
- ✅ Maestro flows — Task 8

**Placeholder scan:** No TBDs, all code blocks complete. ✅

**Type consistency:**
- `FriendshipRow.profile: ProfileSnippet` used uniformly across Tasks 2, 3, 4, 6 ✅
- `useFriendStore` imported consistently from `'../../../store/friendStore'` or `'../../store/friendStore'` depending on depth ✅
- `unfriend(item.id)` in people.tsx — `item` is `FriendshipRow`, `.id` is friendship id ✅
- `acceptRequest(friendshipId)` in members screen uses `receivedMap.get(memberId)` which returns the friendship id ✅
