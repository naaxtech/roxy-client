# Friends Presence & Tap-to-Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show online status on friends in the Grow tab card and People screen, sort online friends first, and let users tap a friend to open a direct message conversation.

**Architecture:** `friendStore` gains `last_seen_at` on `ProfileSnippet`, a `_lastHeartbeat` timestamp for rate-capping, a rate-capped `UPDATE profiles SET last_seen_at` write inside `fetchAll`, and two exported helpers (`isOnline`, `sortByPresence`). The Grow tab card switches from its own local `friendships` query to `friendStore.friends`. The People screen applies the sort and adds a tap-to-chat handler that finds or creates a `direct` conversation.

**Tech Stack:** Zustand, Supabase JS v2, Expo Router v3, React Native, Jest + @testing-library/react-native

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `store/friendStore.ts` | Modify | Add `last_seen_at` to `ProfileSnippet`, `_lastHeartbeat` state, rate-capped heartbeat in `fetchAll`, export `isOnline()` + `sortByPresence()` |
| `app/(tabs)/grow/index.tsx` | Modify | Use `friendStore.friends`, apply `sortByPresence`, online dots, drop local `friendships` state |
| `app/(tabs)/grow/people.tsx` | Modify | Apply `sortByPresence`, online dots on rows, rows tappable → `handleFriendTap` |
| `__tests__/store/friendStore.test.ts` | Modify | Add tests for `isOnline`, `sortByPresence`, heartbeat rate-cap |

---

## Task 1: `isOnline` + `sortByPresence` helpers — TDD

**Files:**
- Modify: `apps/mobile/store/friendStore.ts`
- Modify: `apps/mobile/__tests__/store/friendStore.test.ts`

- [ ] **Step 1: Add `last_seen_at` to existing test's `beforeEach`**

The new `_lastHeartbeat` field must be seeded in the store reset so heartbeat writes don't fire during existing tests. Update the `beforeEach` block in `apps/mobile/__tests__/store/friendStore.test.ts`:

```ts
beforeEach(() => {
  useFriendStore.setState({
    friends: [], pendingReceived: [], pendingSent: [], _userId: null,
    _lastHeartbeat: Date.now(), // skip heartbeat in all non-heartbeat tests
  });
  jest.clearAllMocks();
});
```

- [ ] **Step 2: Add helper tests**

Add these tests inside the `describe('friendStore')` block, after the existing tests:

```ts
  describe('isOnline', () => {
    it('returns true when last_seen_at is within 5 minutes', () => {
      const recent = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      expect(isOnline(recent)).toBe(true);
    });

    it('returns false when last_seen_at is older than 5 minutes', () => {
      const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      expect(isOnline(old)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isOnline(null)).toBe(false);
    });
  });

  describe('sortByPresence', () => {
    it('puts most-recently-seen friends first', () => {
      const online  = { profile: { last_seen_at: new Date(Date.now() - 1 * 60 * 1000).toISOString() } } as FriendshipRow;
      const recent  = { profile: { last_seen_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() } } as FriendshipRow;
      const offline = { profile: { last_seen_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() } } as FriendshipRow;
      const sorted = sortByPresence([offline, online, recent]);
      expect(sorted[0]).toBe(online);
      expect(sorted[1]).toBe(recent);
      expect(sorted[2]).toBe(offline);
    });

    it('puts null last_seen_at friends last', () => {
      const online  = { profile: { last_seen_at: new Date().toISOString() } } as FriendshipRow;
      const nullOne = { profile: { last_seen_at: null } } as FriendshipRow;
      const sorted = sortByPresence([nullOne, online]);
      expect(sorted[0]).toBe(online);
      expect(sorted[1]).toBe(nullOne);
    });

    it('does not mutate the original array', () => {
      const arr = [
        { profile: { last_seen_at: null } } as FriendshipRow,
        { profile: { last_seen_at: new Date().toISOString() } } as FriendshipRow,
      ];
      const original = [...arr];
      sortByPresence(arr);
      expect(arr[0]).toBe(original[0]);
    });
  });
```

Also add the import at the top of the test file — replace the existing import line:

```ts
import { act, renderHook } from '@testing-library/react-native';
import { useFriendStore, isOnline, sortByPresence, FriendshipRow } from '../../store/friendStore';
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd apps/mobile && npx jest __tests__/store/friendStore.test.ts --no-coverage
```

Expected: FAIL — `isOnline` and `sortByPresence` are not exported yet.

- [ ] **Step 4: Add `last_seen_at` to `ProfileSnippet` and export helpers**

In `apps/mobile/store/friendStore.ts`, replace the existing `ProfileSnippet` type and add the two helper functions above the `FriendStore` type definition:

```ts
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
```

- [ ] **Step 5: Run to verify helpers pass**

```bash
cd apps/mobile && npx jest __tests__/store/friendStore.test.ts --no-coverage
```

Expected: All existing tests + 6 new helper tests pass. (The heartbeat tests don't exist yet — full suite will be checked in Task 2.)

- [ ] **Step 6: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add apps/mobile/store/friendStore.ts apps/mobile/__tests__/store/friendStore.test.ts && git commit -m "feat: isOnline + sortByPresence helpers, last_seen_at on ProfileSnippet"
```

---

## Task 2: Rate-capped heartbeat in `fetchAll` — TDD

**Files:**
- Modify: `apps/mobile/store/friendStore.ts`
- Modify: `apps/mobile/__tests__/store/friendStore.test.ts`

- [ ] **Step 1: Add heartbeat tests**

Add inside the `describe('friendStore')` block (after the `sortByPresence` describe):

```ts
  describe('fetchAll heartbeat', () => {
    it('writes last_seen_at on first call (_lastHeartbeat = 0)', async () => {
      useFriendStore.setState({ _lastHeartbeat: 0, _userId: null });

      const eqMock = jest.fn().mockResolvedValue({ error: null });
      const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
      const orMock = jest.fn().mockResolvedValue({ data: [], error: null });

      supabase.from
        .mockReturnValueOnce({ update: updateMock })
        .mockReturnValue({ select: jest.fn().mockReturnThis(), or: orMock });

      const { result } = renderHook(() => useFriendStore());
      await act(async () => { await result.current.fetchAll('user-me'); });

      expect(updateMock).toHaveBeenCalledWith({ last_seen_at: expect.any(String) });
      expect(eqMock).toHaveBeenCalledWith('id', 'user-me');
      expect(result.current._lastHeartbeat).toBeGreaterThan(0);
    });

    it('skips the write when called within 5 minutes', async () => {
      const recentBeat = Date.now() - 2 * 60 * 1000; // 2 min ago
      useFriendStore.setState({ _lastHeartbeat: recentBeat, _userId: null });

      const updateMock = jest.fn();
      const orMock = jest.fn().mockResolvedValue({ data: [], error: null });

      supabase.from.mockReturnValue({
        update: updateMock,
        select: jest.fn().mockReturnThis(),
        or: orMock,
      });

      const { result } = renderHook(() => useFriendStore());
      await act(async () => { await result.current.fetchAll('user-me'); });

      expect(updateMock).not.toHaveBeenCalled();
      expect(result.current._lastHeartbeat).toBe(recentBeat);
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/mobile && npx jest __tests__/store/friendStore.test.ts --no-coverage
```

Expected: FAIL — `_lastHeartbeat` not in store yet, heartbeat write never fires.

- [ ] **Step 3: Update `FriendStore` type and store state**

In `apps/mobile/store/friendStore.ts`, replace the `FriendStore` type definition and the `create` call opening state:

```ts
type FriendStore = {
  friends: FriendshipRow[];
  pendingReceived: FriendshipRow[];
  pendingSent: FriendshipRow[];
  pendingCount: number;
  _userId: string | null;
  _lastHeartbeat: number;
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
  _lastHeartbeat: 0,
```

- [ ] **Step 4: Replace `fetchAll` with rate-capped version**

Replace the existing `fetchAll` implementation:

```ts
  fetchAll: async (userId) => {
    // Rate-capped heartbeat: update last_seen_at at most once per 5 minutes
    const now = Date.now();
    if (now - get()._lastHeartbeat > 5 * 60 * 1000) {
      await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId);
      set({ _lastHeartbeat: now });
    }

    set({ _userId: userId });
    const { data } = await supabase
      .from('friendships')
      .select(`
        id, requester_id, addressee_id, status, created_at,
        requester:profiles!requester_id(id, display_name, username, avatar_url, last_seen_at),
        addressee:profiles!addressee_id(id, display_name, username, avatar_url, last_seen_at)
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

- [ ] **Step 5: Run full suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: All pass. (The `beforeEach` sets `_lastHeartbeat: Date.now()` so existing mutation tests skip the heartbeat write.)

- [ ] **Step 6: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add apps/mobile/store/friendStore.ts apps/mobile/__tests__/store/friendStore.test.ts && git commit -m "feat: rate-capped last_seen_at heartbeat in fetchAll"
```

---

## Task 3: Grow tab My People card — online dots + friendStore

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/index.tsx`

- [ ] **Step 1: Update imports**

At the top of `apps/mobile/app/(tabs)/grow/index.tsx`, replace:

```ts
import { useFriendStore } from '../../../store/friendStore';
```

with:

```ts
import { useFriendStore, isOnline, sortByPresence } from '../../../store/friendStore';
```

- [ ] **Step 2: Remove local `FriendshipRow` type and `friendships` state**

Delete this line near the top of the file (it conflicts with the store's exported type):

```ts
type FriendshipRow = { id: string; requester_id: string; addressee_id: string; status: string; created_at: string };
```

Remove the local state declaration:

```ts
const [friendships, setFriendships] = useState<FriendshipRow[]>([]);
```

- [ ] **Step 3: Add `friends` from store + simplify `loadSocial`**

In the component body, update the store destructure to include `friends`:

```ts
const { friends, fetchAll } = useFriendStore();
```

Replace `loadSocial` — remove the friendships query, keep communities only:

```ts
const loadSocial = useCallback(async () => {
  if (!user) return;
  const { data } = await supabase
    .from('community_members')
    .select('community_id, communities(id, name, category)')
    .eq('user_id', user.id);
  if (data) setCommunities(data as unknown as CommunityRow[]);
}, [user]);
```

- [ ] **Step 4: Update My People card JSX**

Replace the entire `{/* Zone 3 — My People */}` block with:

```tsx
        {/* Zone 3 — My People */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/grow/people' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.sectionTitle}>
            My People{' '}
            <Text style={styles.sectionHint}>tap to manage →</Text>
          </Text>
          {friends.length === 0 ? (
            <Text style={styles.emptyState}>Connect with someone in Discover →</Text>
          ) : (
            <View style={styles.avatarRow}>
              {sortByPresence(friends).slice(0, 5).map((f) => (
                <View key={f.id} style={styles.avatarWrap}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {f.profile.display_name?.[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                  {isOnline(f.profile.last_seen_at) && (
                    <View style={styles.onlineDot} />
                  )}
                </View>
              ))}
              {friends.length > 5 && (
                <View style={styles.avatar}>
                  <Text style={styles.avatarCount}>+{friends.length - 5}</Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>
```

- [ ] **Step 5: Add new styles**

In `StyleSheet.create({...})`, replace the existing `avatar` and `avatarRow` styles and add `avatarWrap` + `onlineDot`:

```ts
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  avatarCount: { color: COLORS.textMuted, fontWeight: '700', fontSize: 12 },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: COLORS.success,
    borderWidth: 1.5, borderColor: COLORS.surface,
  },
```

- [ ] **Step 6: Run full suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add "apps/mobile/app/(tabs)/grow/index.tsx" && git commit -m "feat: Grow My People card — online dots, sorted by presence, uses friendStore"
```

---

## Task 4: People screen — sorted friends, online dots, tap to chat

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/people.tsx`

- [ ] **Step 1: Update imports**

At the top of `apps/mobile/app/(tabs)/grow/people.tsx`, replace:

```ts
import { useFriendStore, FriendshipRow } from '../../../store/friendStore';
```

with:

```ts
import { useFriendStore, FriendshipRow, isOnline, sortByPresence } from '../../../store/friendStore';
```

Also add `supabase` import (needed for handleFriendTap):

```ts
import { supabase } from '../../../lib/supabase';
```

- [ ] **Step 2: Add `handleFriendTap`**

Add this function inside the component body, after `confirmUnfriend`:

```ts
  const handleFriendTap = async (item: FriendshipRow) => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .contains('participant_ids', [user.id, item.profile.id])
        .eq('conversation_type', 'direct')
        .limit(1)
        .maybeSingle();

      if (data) {
        router.push(`/(tabs)/connect/chat/${data.id}` as any);
        return;
      }

      const { data: created, error } = await supabase
        .from('conversations')
        .insert({ participant_ids: [user.id, item.profile.id], conversation_type: 'direct' })
        .select('id')
        .single();

      if (error) throw error;
      router.push(`/(tabs)/connect/chat/${created.id}` as any);
    } catch (e: any) {
      Alert.alert('Error', e?.message);
    }
  };
```

- [ ] **Step 3: Update the Friends FlatList — sort, dots, tappable rows**

Replace the Friends tab `FlatList` `renderItem` with:

```tsx
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.row} onPress={() => handleFriendTap(item)} activeOpacity={0.75}>
                  <View style={styles.avatarWrap}>
                    <AvatarCircle name={item.profile.display_name} />
                    {isOnline(item.profile.last_seen_at) && <View style={styles.onlineDot} />}
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{item.profile.display_name}</Text>
                    <Text style={styles.rowSub}>@{item.profile.username}</Text>
                  </View>
                  <TouchableOpacity style={styles.mutedBtn} onPress={() => confirmUnfriend(item)}>
                    <Text style={styles.mutedBtnText}>Remove</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
```

Also apply `sortByPresence` to the FlatList `data` prop:

```tsx
              data={sortByPresence(friends)}
```

- [ ] **Step 4: Add `avatarWrap` + `onlineDot` styles**

In `StyleSheet.create({...})`, add after `avatar`:

```ts
  avatarWrap: { position: 'relative' },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: COLORS.success,
    borderWidth: 1.5, borderColor: COLORS.background,
  },
```

- [ ] **Step 5: Run full suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add "apps/mobile/app/(tabs)/grow/people.tsx" && git commit -m "feat: People screen — sorted by presence, online dots, tap friend → DM"
```

---

## Task 5: Final verification + PR

- [ ] **Step 1: Run complete test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: All pass (100+ tests).

- [ ] **Step 2: Push and open PR**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git push origin session-9-friends && gh pr view 9
```

The existing PR #9 already covers this branch — no new PR needed. Push updates it.

---

## Self-Review

**Spec coverage:**
- ✅ `last_seen_at` on `ProfileSnippet` — Task 1
- ✅ `_lastHeartbeat` rate-cap — Task 2
- ✅ Heartbeat fires on `fetchAll` (Grow + People mount) — Task 2
- ✅ `isOnline` (5 min threshold) — Task 1
- ✅ `sortByPresence` (online → recent → offline) — Task 1
- ✅ Grow tab card: `friendStore.friends` + sort + dots — Task 3
- ✅ People screen: sort + dots on Friends tab — Task 4
- ✅ Tap friend → find/create `direct` conversation → navigate — Task 4
- ✅ `.maybeSingle()` avoids PGRST116 on missing conversation — Task 4

**Placeholder scan:** No TBDs. All code blocks complete. ✅

**Type consistency:**
- `ProfileSnippet.last_seen_at: string | null` used in `isOnline(string | null)` — matches ✅
- `sortByPresence(friends: FriendshipRow[])` — `FriendshipRow.profile: ProfileSnippet` — matches ✅
- `handleFriendTap(item: FriendshipRow)` uses `item.profile.id` — present on `ProfileSnippet` ✅
- `COLORS.success` (`#10B981`) exists in `lib/constants.ts` ✅
