# Friends & People — Design Spec
**Date:** 2026-04-05
**Session:** 9
**Branch:** session-9-friends

---

## Overview

Polish the social layer of Roxy: a dedicated friends management screen accessible from Grow's "My People" section, a full-screen community members screen, and a badge on the Grow tab for pending friend requests.

---

## Section 1 — Data & Store

### `friendStore` (Zustand)

**State:**
```ts
friends: Profile[]          // accepted friendships, both directions
pendingReceived: Friendship[] // requests sent TO the current user
pendingSent: Friendship[]     // requests sent BY the current user
pendingCount: number          // === pendingReceived.length, drives badge
```

**Actions:**
| Action | DB operation | Optimistic update |
|---|---|---|
| `fetchAll(userId)` | SELECT all friendships where requester_id or addressee_id = userId | Replace all three lists |
| `sendRequest(targetId)` | INSERT friendships (status: pending) | Add to pendingSent |
| `acceptRequest(friendshipId)` | UPDATE friendships SET status = accepted | Move from pendingReceived → friends |
| `rejectRequest(friendshipId)` | DELETE friendships | Remove from pendingReceived |
| `cancelRequest(friendshipId)` | DELETE friendships | Remove from pendingSent |
| `unfriend(friendshipId)` | DELETE friendships | Remove from friends |

All actions throw on unexpected error. `fetchAll` is called once when Grow tab mounts. `pendingCount` is derived — not stored separately, computed as `pendingReceived.length`.

**Profile type needed in store:**
```ts
{ id, display_name, username, avatar_url }
```
Fetched via join: `friendships → profiles` (requester or addressee side depending on direction).

---

## Section 2 — Screens & Navigation

### 2a. `app/(tabs)/grow/people.tsx` — Friends Screen

Reached by tapping "My People" row in `grow/index.tsx`. Uses `router.push('/(tabs)/grow/people')`.

**Three underline sub-tabs** (same style as Discover/Connect):

**Friends tab:**
- FlatList of `friends`
- Row: avatar initial circle · display_name · @username · "Remove" button (destructive)
- "Remove" shows confirm Alert before calling `unfriend()`
- Empty state: "No friends yet. Find people in communities! 💜"

**Requests tab:**
- FlatList of `pendingReceived`
- Row: avatar initial · display_name · @username · "Accept ✓" + "Decline ✗" buttons
- Accept calls `acceptRequest()`, moves row to Friends tab
- Decline calls `rejectRequest()`, removes row
- Empty state: "No pending requests"

**Sent tab:**
- FlatList of `pendingSent`
- Row: avatar initial · display_name · @username · "Cancel" button
- Cancel calls `cancelRequest()`, removes row
- Empty state: "No sent requests"

**Badge:** Grow tab icon shows a red dot when `pendingCount > 0`. Implemented in `app/(tabs)/_layout.tsx` using `useFriendStore`. Badge clears when user opens the friends screen (on mount, mark as seen — just clears the visual, doesn't change DB).

### 2b. `app/(tabs)/discover/community/members/[communityId].tsx` — Members Screen

Replaces the current members modal in `[id].tsx`. Reached by `router.push('/(tabs)/discover/community/members/${id}')`.

**Layout:** Full-screen with back button header ("Members").

**Member rows:**
| Friendship state | Right-side button |
|---|---|
| Self | — (nothing) |
| No connection | "Add Friend" → calls `sendRequest()` → optimistically shows "Requested" |
| Sent pending | "Requested" (disabled, grey) |
| Received pending | "Accept" → calls `acceptRequest()` |
| Accepted | "Friends 💜" (no button) |

Friendship state is loaded from `friendStore` (already fetched) — no extra DB call needed for the button states.

**Remove modal** from `[id].tsx`: delete `membersModalVisible`, `members`, `friendships` local state, `loadMembers`, `openMembersModal`, and the `<Modal>` block. Replace the "N members" `TouchableOpacity` with `router.push`.

---

## Section 3 — RLS & Error Handling

No new migrations required. The existing policy covers all operations:
```sql
CREATE POLICY "friendships_own" ON friendships
  FOR ALL USING (auth.uid() IN (requester_id, addressee_id));
```

**Edge cases:**
- **Duplicate request (23505):** Catch in `sendRequest`, treat as already-sent. Update UI to "Requested" silently, do not throw.
- **Accept cancelled request:** If `UPDATE` returns 0 rows, call `fetchAll()` to refresh — the row will be gone and the list updates cleanly.
- **Unfriend while other party is viewing:** Same — stale state resolves on next `fetchAll`.

All store actions: throw on unexpected Supabase errors.
All screens: wrap in try/catch, show `Alert.alert('Error', e.message)`.

---

## Section 4 — Testing

### Jest (`__tests__/store/friendStore.test.ts`)
- `fetchAll` correctly splits rows into friends / pendingReceived / pendingSent by status and direction
- `sendRequest` adds to pendingSent, `pendingCount` stays 0
- `acceptRequest` moves row from pendingReceived → friends, `pendingCount` decrements
- `rejectRequest` removes from pendingReceived
- `cancelRequest` removes from pendingSent
- Duplicate 23505 error on `sendRequest` is swallowed (no throw)

### Maestro (`.maestro/flows/`)
- `friends_request_accept.yaml` — open community members → "Add Friend" → navigate to Requests tab in People screen → "Accept" → verify Friends tab shows the user
- `friends_request_decline.yaml` — open Requests tab → "Decline" → verify row disappears
- `community_members_screen.yaml` — tap "N members" in community detail → verify full-screen stack opens → tap "Add Friend" → verify button becomes "Requested"

---

## Files Touched

| File | Change |
|---|---|
| `store/friendStore.ts` | **Create** — Zustand store |
| `app/(tabs)/grow/people.tsx` | **Create** — friends screen |
| `app/(tabs)/grow/index.tsx` | **Edit** — "My People" tap navigates to people.tsx |
| `app/(tabs)/_layout.tsx` | **Edit** — badge dot on Grow tab icon |
| `app/(tabs)/discover/community/members/[communityId].tsx` | **Create** — members screen |
| `app/(tabs)/discover/community/[id].tsx` | **Edit** — remove modal, wire "N members" to new screen |
| `__tests__/store/friendStore.test.ts` | **Create** — store unit tests |
| `.maestro/flows/friends_request_accept.yaml` | **Create** |
| `.maestro/flows/friends_request_decline.yaml` | **Create** |
| `.maestro/flows/community_members_screen.yaml` | **Create** |

---

## Out of Scope

- Push notifications for friend requests (needs separate notification infrastructure)
- Friend suggestions / discovery outside of communities
- Blocking users (schema supports it, UI deferred)
- Real-time Supabase subscription for live request updates
