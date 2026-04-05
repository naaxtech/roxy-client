# Friends Presence & Chat Design Spec
**Date:** 2026-04-05
**Session:** 10
**Branch:** session-10-presence

---

## Overview

Add online presence indicators to the friends social layer. The Grow tab My People card shows online friends first with a green dot. The People screen Friends tab sorts online → recently seen → offline. Tapping a friend opens a direct message conversation.

---

## Section 1 — Presence: how "online" works

`profiles.last_seen_at` already exists (migration 001). No new migration needed.

**Heartbeat trigger:** `friendStore.fetchAll(userId)` — called on Grow tab mount and People screen mount.

**Rate cap:** A `_lastHeartbeat: number` field in the store (timestamp, default 0). On each `fetchAll` call:
- If `Date.now() - _lastHeartbeat > 5 * 60 * 1000`: fire `UPDATE profiles SET last_seen_at = now() WHERE id = userId` (no `.select()` — zero row egress), then `set({ _lastHeartbeat: Date.now() })`
- If under 5 minutes: skip the write entirely

**Online thresholds:**
- **Online** = `last_seen_at` within the last 5 minutes → green dot shown
- **Recently** = within 30 minutes → no dot, but sorted above offline
- **Offline** = older than 30 minutes → no dot

No background timer. No `AppState` listener. No Supabase Realtime.

---

## Section 2 — Data: friendStore changes

### `ProfileSnippet` type

```ts
export type ProfileSnippet = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  last_seen_at: string | null;
};
```

### `fetchAll` select — add `last_seen_at` to profile joins

```ts
requester:profiles!requester_id(id, display_name, username, avatar_url, last_seen_at),
addressee:profiles!addressee_id(id, display_name, username, avatar_url, last_seen_at),
```

### `_lastHeartbeat` store field

```ts
_lastHeartbeat: number;  // default: 0
```

Added to `FriendStore` type and initialised as `0` in store state.

### Rate-capped heartbeat (top of `fetchAll`)

```ts
const now = Date.now();
if (now - get()._lastHeartbeat > 5 * 60 * 1000) {
  await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId);
  set({ _lastHeartbeat: now });
}
```

### Exported helpers

```ts
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

---

## Section 3 — UI: Grow tab My People card (`grow/index.tsx`)

**Drop local `friendships` state.** Use `useFriendStore().friends` instead — it already carries `last_seen_at` per friend.

**Rendering:**
- `sortByPresence(friends).slice(0, 5)` — show up to 5 friends
- Each avatar circle: small green dot (8×8, absolute bottom-right) when `isOnline(friend.profile.last_seen_at)`
- Show `friend.profile.display_name[0]` initial in the circle (replacing the generic 👤 emoji)
- Empty state unchanged: "Connect with someone in Discover →"

---

## Section 4 — UI: People screen Friends tab (`grow/people.tsx`)

**Sort:** `sortByPresence(friends)` applied before rendering the FlatList.

**Online dot:** same green dot on each row's avatar circle when `isOnline(item.profile.last_seen_at)`.

**Tap to chat:** rows become `TouchableOpacity`. Tap calls `handleFriendTap(item)`:

```ts
const handleFriendTap = async (item: FriendshipRow) => {
  if (!user) return;
  try {
    // 1. Find existing direct conversation
    // Use .maybeSingle() — returns null (not an error) when no row found
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

    // 2. Create new conversation
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

**Note:** `.maybeSingle()` returns `null` when no row is found instead of throwing PGRST116. Always use this (not `.single()`) for the existence check.

No changes to `/(tabs)/connect/chat/[id].tsx` — it already handles any conversation by ID.

---

## Section 5 — Files Touched

| File | Change |
|---|---|
| `store/friendStore.ts` | `last_seen_at` on `ProfileSnippet`, `_lastHeartbeat` state, rate-capped heartbeat in `fetchAll`, export `isOnline()` + `sortByPresence()` |
| `app/(tabs)/grow/index.tsx` | Use `friendStore.friends`, apply `sortByPresence`, green dots, drop local `friendships` state |
| `app/(tabs)/grow/people.tsx` | Apply `sortByPresence`, green dots on rows, rows tappable → `handleFriendTap` |

---

## Out of Scope

- Supabase Realtime Presence (deferred — cost vs benefit unfavourable at current scale)
- "Last seen X minutes ago" timestamp label on rows
- Blocking a user from seeing your online status
- Push notifications when a friend comes online
