# Firebase Analytics + Crashlytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Firebase Analytics and Crashlytics so every screen view is tracked, all catch blocks report to Crashlytics, and key product actions fire named analytics events.

**Architecture:** Three new utility files (`lib/analytics.ts`, `lib/errorLogger.ts`, `components/ErrorBoundary.tsx`) are the only places that import Firebase directly. Screens and stores call these wrappers — never Firebase directly. The root layout wires up screen tracking, user identity, and a global JS error handler. All 9 existing catch-block files get a one-line `logError(e)` addition.

**Tech Stack:** `@react-native-firebase/app`, `@react-native-firebase/analytics`, `@react-native-firebase/crashlytics`, Expo 51, Expo Router v3, Zustand, Jest + jest-expo

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/mobile/package.json` | Modify | Add firebase packages + jest moduleNameMapper |
| `apps/mobile/app.json` | Modify | Add firebase config plugins |
| `apps/mobile/google-services.json` | Place + commit | Android Firebase config (user provides) |
| `apps/mobile/GoogleService-Info.plist` | Place + commit | iOS Firebase config (user provides) |
| `apps/mobile/__mocks__/@react-native-firebase/app.js` | Create | Jest mock |
| `apps/mobile/__mocks__/@react-native-firebase/analytics.js` | Create | Jest mock |
| `apps/mobile/__mocks__/@react-native-firebase/crashlytics.js` | Create | Jest mock |
| `apps/mobile/lib/analytics.ts` | Create | Typed analytics event wrappers |
| `apps/mobile/lib/errorLogger.ts` | Create | Crashlytics error reporting utility |
| `apps/mobile/components/ErrorBoundary.tsx` | Create | React render error boundary |
| `apps/mobile/app/_layout.tsx` | Modify | Screen tracking, global error handler, user ID |
| `apps/mobile/store/friendStore.ts` | Modify | Analytics events on friend actions |
| 9 screen files (listed in Task 5) | Modify | `logError` in every catch block |
| 9 screen files (listed in Task 6) | Modify | Analytics events at key moments |

---

## Task 1: Install packages, place config files, jest mocks

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.json`
- Create: `apps/mobile/__mocks__/@react-native-firebase/app.js`
- Create: `apps/mobile/__mocks__/@react-native-firebase/analytics.js`
- Create: `apps/mobile/__mocks__/@react-native-firebase/crashlytics.js`

- [ ] **Step 1: Install firebase packages**

```bash
cd apps/mobile && npx expo install @react-native-firebase/app @react-native-firebase/analytics @react-native-firebase/crashlytics
```

- [ ] **Step 2: Place config files**

The user has already downloaded these from the Firebase console. Place them at:
- `apps/mobile/google-services.json` (Android)
- `apps/mobile/GoogleService-Info.plist` (iOS)

Add both to git:
```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add apps/mobile/google-services.json apps/mobile/GoogleService-Info.plist
```

- [ ] **Step 3: Add firebase plugins to `app.json`**

In `apps/mobile/app.json`, add two entries at the end of the `plugins` array (after `expo-build-properties`):

```json
      "@react-native-firebase/app",
      "@react-native-firebase/crashlytics"
```

The full plugins array should look like:
```json
    "plugins": [
      "expo-router",
      "expo-notifications",
      [
        "expo-image-picker",
        {
          "photosPermission": "Roxy needs access to your photos to set your profile picture."
        }
      ],
      [
        "expo-build-properties",
        {
          "android": {
            "minSdkVersion": 24
          }
        }
      ],
      "@react-native-firebase/app",
      "@react-native-firebase/crashlytics"
    ]
```

- [ ] **Step 4: Add jest `moduleNameMapper` to `package.json`**

Inside the `"jest"` object in `apps/mobile/package.json`, add `"moduleNameMapper"` after `"preset"`:

```json
    "moduleNameMapper": {
      "^@react-native-firebase/(.*)$": "<rootDir>/__mocks__/@react-native-firebase/$1.js"
    },
```

- [ ] **Step 5: Create jest mock files**

Create `apps/mobile/__mocks__/@react-native-firebase/app.js`:
```js
module.exports = { default: jest.fn() };
```

Create `apps/mobile/__mocks__/@react-native-firebase/analytics.js`:
```js
const analytics = () => ({
  logScreenView: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
});
analytics.default = analytics;
module.exports = analytics;
```

Create `apps/mobile/__mocks__/@react-native-firebase/crashlytics.js`:
```js
const crashlytics = () => ({
  recordError: jest.fn(),
  log: jest.fn(),
  setUserId: jest.fn(),
  setCrashlyticsCollectionEnabled: jest.fn(),
});
crashlytics.default = crashlytics;
module.exports = crashlytics;
```

- [ ] **Step 6: Run tests to verify mocks work**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: 102 tests pass, no import errors from `@react-native-firebase`.

- [ ] **Step 7: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add apps/mobile/package.json apps/mobile/app.json "apps/mobile/__mocks__/@react-native-firebase/app.js" "apps/mobile/__mocks__/@react-native-firebase/analytics.js" "apps/mobile/__mocks__/@react-native-firebase/crashlytics.js" && git commit -m "feat: install @react-native-firebase, jest mocks, config plugins"
```

---

## Task 2: Core utility files — `analytics.ts`, `errorLogger.ts`, `ErrorBoundary.tsx`

**Files:**
- Create: `apps/mobile/lib/analytics.ts`
- Create: `apps/mobile/lib/errorLogger.ts`
- Create: `apps/mobile/components/ErrorBoundary.tsx`

- [ ] **Step 1: Create `apps/mobile/lib/analytics.ts`**

```ts
import analytics from '@react-native-firebase/analytics';

export const Analytics = {
  screenView: (screenName: string) =>
    analytics().logScreenView({ screen_name: screenName, screen_class: screenName }),

  setUser: (userId: string | null) =>
    analytics().setUserId(userId),

  // Friends
  friendRequestSent: (targetUserId: string) =>
    analytics().logEvent('friend_request_sent', { target_user_id: targetUserId }),
  friendRequestAccepted: (friendshipId: string) =>
    analytics().logEvent('friend_request_accepted', { friendship_id: friendshipId }),
  friendRequestDeclined: (friendshipId: string) =>
    analytics().logEvent('friend_request_declined', { friendship_id: friendshipId }),
  friendRequestCancelled: (friendshipId: string) =>
    analytics().logEvent('friend_request_cancelled', { friendship_id: friendshipId }),
  friendRemoved: (friendshipId: string) =>
    analytics().logEvent('friend_removed', { friendship_id: friendshipId }),

  // Posts
  postCreated: (communityId: string) =>
    analytics().logEvent('post_created', { community_id: communityId }),
  postViewed: (postId: string) =>
    analytics().logEvent('post_viewed', { post_id: postId }),
  commentCreated: (postId: string) =>
    analytics().logEvent('comment_created', { post_id: postId }),

  // Communities
  communityViewed: (communityId: string) =>
    analytics().logEvent('community_viewed', { community_id: communityId }),
  communityJoined: (communityId: string) =>
    analytics().logEvent('community_joined', { community_id: communityId }),

  // Chat
  dmOpened: (conversationId: string) =>
    analytics().logEvent('dm_opened', { conversation_id: conversationId }),
  dmCreated: () =>
    analytics().logEvent('dm_created'),
  messageSent: (conversationId: string) =>
    analytics().logEvent('message_sent', { conversation_id: conversationId }),

  // Speed dating
  speedDateJoined: () =>
    analytics().logEvent('speed_date_joined'),
  speedDateCompleted: () =>
    analytics().logEvent('speed_date_completed'),

  // Roxy AI
  roxyChatOpened: () =>
    analytics().logEvent('roxy_chat_opened'),
  roxyGreetingViewed: () =>
    analytics().logEvent('roxy_greeting_viewed'),
};
```

- [ ] **Step 2: Create `apps/mobile/lib/errorLogger.ts`**

```ts
import crashlytics from '@react-native-firebase/crashlytics';

export function logError(e: unknown, context?: string): void {
  const error = e instanceof Error ? e : new Error(String(e));
  if (context) crashlytics().log(context);
  crashlytics().recordError(error);
}

export function setCrashlyticsUser(userId: string | null): void {
  crashlytics().setUserId(userId ?? '');
}
```

- [ ] **Step 3: Create `apps/mobile/components/ErrorBoundary.tsx`**

```tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { logError } from '../lib/errorLogger';
import { COLORS } from '../lib/constants';

interface State { hasError: boolean }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    logError(error, 'ErrorBoundary');
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <TouchableOpacity onPress={() => this.setState({ hasError: false })}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: COLORS.background },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 16 },
  retry: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },
});
```

- [ ] **Step 4: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: 102 tests pass.

- [ ] **Step 5: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add apps/mobile/lib/analytics.ts apps/mobile/lib/errorLogger.ts apps/mobile/components/ErrorBoundary.tsx && git commit -m "feat: analytics wrapper, errorLogger, ErrorBoundary"
```

---

## Task 3: Root layout — screen tracking, error handler, user ID

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`

The current file imports `Stack, useRouter, useSegments` from `expo-router`. It has a `useAuth` hook providing `user` and `loading`.

- [ ] **Step 1: Update imports**

Replace the existing expo-router import line:
```ts
import { Stack, useRouter, useSegments } from 'expo-router';
```
With:
```ts
import { Stack, useRouter, useSegments, usePathname } from 'expo-router';
```

Add two new imports after the existing imports:
```ts
import { Analytics } from '../lib/analytics';
import { logError, setCrashlyticsUser } from '../lib/errorLogger';
import { ErrorBoundary } from '../components/ErrorBoundary';
```

- [ ] **Step 2: Add screen tracking**

Inside `RootLayout`, after the existing state declarations, add:

```ts
  const pathname = usePathname();
  useEffect(() => {
    Analytics.screenView(pathname);
  }, [pathname]);
```

- [ ] **Step 3: Add global JS error handler**

Add this `useEffect` after the screen tracking one:

```ts
  useEffect(() => {
    const previous = ErrorUtils.getGlobalHandler();
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      logError(error, isFatal ? 'fatal_js_error' : 'unhandled_js_error');
      previous?.(error, isFatal);
    });
  }, []);
```

- [ ] **Step 4: Add user identity tracking**

Add this `useEffect` after the global error handler:

```ts
  useEffect(() => {
    Analytics.setUser(user?.id ?? null);
    setCrashlyticsUser(user?.id ?? null);
  }, [user?.id]);
```

- [ ] **Step 5: Wrap Stack with ErrorBoundary**

Replace the return statement's inner content:
```tsx
        <Stack screenOptions={{ headerShown: false }} />
```
With:
```tsx
        <ErrorBoundary>
          <Stack screenOptions={{ headerShown: false }} />
        </ErrorBoundary>
```

- [ ] **Step 6: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: 102 tests pass.

- [ ] **Step 7: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add "apps/mobile/app/_layout.tsx" && git commit -m "feat: screen tracking, global error handler, user ID in root layout"
```

---

## Task 4: Friend store analytics events

**Files:**
- Modify: `apps/mobile/store/friendStore.ts`

- [ ] **Step 1: Add Analytics import**

At the top of `apps/mobile/store/friendStore.ts`, after the existing imports, add:

```ts
import { Analytics } from '../lib/analytics';
```

- [ ] **Step 2: Add event to `sendRequest`**

In the `sendRequest` action, after `if (error && error.code !== '23505') throw error;`, add:

```ts
    Analytics.friendRequestSent(targetId);
```

The full `sendRequest` body becomes:
```ts
  sendRequest: async (targetId) => {
    const { _userId } = get();
    if (!_userId) return;
    const { error } = await supabase
      .from('friendships')
      .insert({ requester_id: _userId, addressee_id: targetId });
    if (error && error.code !== '23505') throw error;
    Analytics.friendRequestSent(targetId);
    await get().fetchAll(_userId);
  },
```

- [ ] **Step 3: Add events to `acceptRequest`, `rejectRequest`, `cancelRequest`, `unfriend`**

`acceptRequest`:
```ts
  acceptRequest: async (friendshipId) => {
    const { _userId } = get();
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);
    if (error) throw error;
    Analytics.friendRequestAccepted(friendshipId);
    if (_userId) await get().fetchAll(_userId);
  },
```

`rejectRequest`:
```ts
  rejectRequest: async (friendshipId) => {
    const { _userId } = get();
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) throw error;
    Analytics.friendRequestDeclined(friendshipId);
    if (_userId) await get().fetchAll(_userId);
  },
```

`cancelRequest`:
```ts
  cancelRequest: async (friendshipId) => {
    const { _userId } = get();
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) throw error;
    Analytics.friendRequestCancelled(friendshipId);
    if (_userId) await get().fetchAll(_userId);
  },
```

`unfriend`:
```ts
  unfriend: async (friendshipId) => {
    const { _userId } = get();
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);
    if (error) throw error;
    Analytics.friendRemoved(friendshipId);
    if (_userId) await get().fetchAll(_userId);
  },
```

- [ ] **Step 4: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: 102 tests pass. (Analytics calls are fire-and-forget; mocked in jest.)

- [ ] **Step 5: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add apps/mobile/store/friendStore.ts && git commit -m "feat: friend analytics events in friendStore"
```

---

## Task 5: `logError` in all catch blocks

**Files (9 screen files):**
- `apps/mobile/app/(tabs)/grow/people.tsx`
- `apps/mobile/app/(tabs)/discover/community/[id].tsx`
- `apps/mobile/app/(tabs)/discover/community/members/[communityId].tsx`
- `apps/mobile/app/(tabs)/discover/index.tsx`
- `apps/mobile/app/(tabs)/profile/delete-account.tsx`
- `apps/mobile/app/(tabs)/discover/community/create-post.tsx`
- `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx`
- `apps/mobile/app/(tabs)/profile/index.tsx`
- `apps/mobile/app/(tabs)/connect/speed-dating/result.tsx`

- [ ] **Step 1: Add `logError` import to all 9 files**

In each file, add this import (use the correct relative path for each file's depth):

Files at depth `app/(tabs)/grow/` or `app/(tabs)/discover/` or `app/(tabs)/profile/` or `app/(tabs)/connect/`:
```ts
import { logError } from '../../../lib/errorLogger';
```

Files deeper (e.g. `discover/community/[id].tsx`):
```ts
import { logError } from '../../../../lib/errorLogger';
```

Files even deeper (e.g. `discover/community/members/[communityId].tsx`):
```ts
import { logError } from '../../../../../lib/errorLogger';
```

Correct paths by depth:
- `grow/people.tsx` → `'../../../lib/errorLogger'`
- `discover/community/[id].tsx` → `'../../../../lib/errorLogger'`
- `discover/community/members/[communityId].tsx` → `'../../../../../lib/errorLogger'`
- `discover/index.tsx` → `'../../../lib/errorLogger'`
- `profile/delete-account.tsx` → `'../../../lib/errorLogger'`
- `discover/community/create-post.tsx` → `'../../../../lib/errorLogger'`
- `connect/speed-dating/session.tsx` → `'../../../../lib/errorLogger'`
- `profile/index.tsx` → `'../../../lib/errorLogger'`
- `connect/speed-dating/result.tsx` → `'../../../../lib/errorLogger'`

- [ ] **Step 2: Add `logError(e)` as first line of every catch block**

Pattern — for every `catch (e: any) {` block in each file, add `logError(e, 'context')` as the first line. Use a short context string describing what action failed.

**`grow/people.tsx`** — 2 catch blocks:

In `handleFriendTap`:
```ts
    } catch (e: any) {
      logError(e, 'handleFriendTap');
      Alert.alert('Error', e?.message);
    }
```

In `confirmUnfriend` (inside the Alert onPress):
```ts
          onPress: async () => {
            try { await unfriend(item.id); }
            catch (e: any) {
              logError(e, 'unfriend');
              Alert.alert('Error', e?.message);
            }
          },
```

**`discover/community/[id].tsx`** — catch block around join/leave (line ~137):
```ts
    } catch (e: any) {
      logError(e, 'joinOrLeaveCommunity');
      Alert.alert('Error', e?.message);
    }
```

**`discover/community/create-post.tsx`** — catch block in `handlePost`:
```ts
    } catch (e: any) {
      logError(e, 'createPost');
      Alert.alert('Error', e?.message ?? 'Could not create post');
    }
```

**For the remaining 6 files** (`members/[communityId].tsx`, `discover/index.tsx`, `profile/delete-account.tsx`, `connect/speed-dating/session.tsx`, `profile/index.tsx`, `connect/speed-dating/result.tsx`): read each file, find every `catch (e` block, and add `logError(e, '<action_name>')` as the first line. The context string should describe the action (e.g. `'deleteAccount'`, `'joinSpeedDate'`).

- [ ] **Step 3: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: 102 tests pass.

- [ ] **Step 4: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add "apps/mobile/app/(tabs)/grow/people.tsx" "apps/mobile/app/(tabs)/discover/community/[id].tsx" "apps/mobile/app/(tabs)/discover/community/members/[communityId].tsx" "apps/mobile/app/(tabs)/discover/index.tsx" "apps/mobile/app/(tabs)/profile/delete-account.tsx" "apps/mobile/app/(tabs)/discover/community/create-post.tsx" "apps/mobile/app/(tabs)/connect/speed-dating/session.tsx" "apps/mobile/app/(tabs)/profile/index.tsx" "apps/mobile/app/(tabs)/connect/speed-dating/result.tsx" && git commit -m "feat: logError in all catch blocks"
```

---

## Task 6: Analytics events in screens

**Files:**
- `apps/mobile/app/(tabs)/grow/people.tsx`
- `apps/mobile/app/(tabs)/discover/community/create-post.tsx`
- `apps/mobile/app/(tabs)/discover/community/post/[postId].tsx`
- `apps/mobile/app/(tabs)/discover/community/[id].tsx`
- `apps/mobile/app/(tabs)/connect/chat/[id].tsx`
- `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx`
- `apps/mobile/app/(tabs)/connect/speed-dating/result.tsx`
- `apps/mobile/app/(tabs)/grow/roxy-chat.tsx`
- `apps/mobile/app/(tabs)/grow/index.tsx`

- [ ] **Step 1: Add `Analytics` import to all 9 files**

In each file, add (correct relative path per depth):
- `grow/people.tsx` → `import { Analytics } from '../../../lib/analytics';`
- `discover/community/create-post.tsx` → `import { Analytics } from '../../../../lib/analytics';`
- `discover/community/post/[postId].tsx` → `import { Analytics } from '../../../../../lib/analytics';`
- `discover/community/[id].tsx` → `import { Analytics } from '../../../../lib/analytics';`
- `connect/chat/[id].tsx` → `import { Analytics } from '../../../../lib/analytics';`
- `connect/speed-dating/session.tsx` → `import { Analytics } from '../../../../lib/analytics';`
- `connect/speed-dating/result.tsx` → `import { Analytics } from '../../../../lib/analytics';`
- `grow/roxy-chat.tsx` → `import { Analytics } from '../../../lib/analytics';`
- `grow/index.tsx` → `import { Analytics } from '../../../lib/analytics';`

- [ ] **Step 2: `grow/people.tsx` — DM events in `handleFriendTap`**

In the existing `handleFriendTap` function, add:
- `Analytics.dmOpened(data.id);` when an existing conversation is found (before `router.push`)
- `Analytics.dmCreated();` when a new conversation is created (before `router.push`)

```ts
      if (data) {
        Analytics.dmOpened(data.id);
        router.push(`/(tabs)/connect/chat/${data.id}` as any);
        return;
      }

      const { data: created, error } = await supabase
        .from('conversations')
        .insert({ participant_ids: [user.id, item.profile.id], conversation_type: 'direct' })
        .select('id')
        .single();

      if (error) throw error;
      Analytics.dmCreated();
      router.push(`/(tabs)/connect/chat/${created.id}` as any);
```

- [ ] **Step 3: `create-post.tsx` — `postCreated` event**

In `handlePost`, in the `else` branch (successful post, before `router.back()`):

```ts
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Analytics.postCreated(communityId);
        router.back();
      }
```

- [ ] **Step 4: `post/[postId].tsx` — `postViewed` on mount, `commentCreated` on success**

**`postViewed` on mount** — add inside the existing `useEffect` that loads the post:

```ts
  useEffect(() => {
    (async () => {
      await Promise.all([loadPost(), loadComments()]);
      setLoading(false);
      if (postId) Analytics.postViewed(postId);
    })();
  }, [loadPost, loadComments]);
```

**`commentCreated` on success** — in `handleSubmit`, in the `else` branch (after comment is added to state):

```ts
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        setComments((prev) => [...prev, data as CommentRow]);
        setPost((prev) => prev ? { ...prev, comment_count: prev.comment_count + 1 } : prev);
        setDraft('');
        Analytics.commentCreated(postId);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      }
```

- [ ] **Step 5: `discover/community/[id].tsx` — community events**

**`communityViewed` on mount** — add inside the `useEffect` that loads community data, after `setCommunity` is called. Find the `useEffect` that uses `id` and `allCommunities`, and add after both branches set the community:

```ts
  useEffect(() => {
    if (!id) return;
    const found = allCommunities.find((c) => c.id === id);
    if (found) {
      setCommunity(found);
      setLoading(false);
    } else {
      supabase.from('communities').select('*').eq('id', id).single().then(({ data }) => {
        if (data) setCommunity(data as Community);
        setLoading(false);
      });
    }
    Analytics.communityViewed(id);
  }, [id, allCommunities]);
```

**`communityJoined` on join action** — in the join/leave handler, fire the event only when joining (not leaving). Find the try block that calls `joinCommunity`/`leaveCommunity` (the `isJoined` toggle logic). Add after the join call:

```ts
      if (isJoined) {
        await leaveCommunity(id, user.id);
      } else {
        await joinCommunity(id, user.id);
        Analytics.communityJoined(id);
      }
```

- [ ] **Step 6: `connect/chat/[id].tsx` — `messageSent` event**

In the `sendMessage` function, after the successful insert, add the event in the `else` branch. The current code checks `if (error) Alert.alert(...)`. Change to:

```ts
    if (error) {
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } else {
      Analytics.messageSent(conversationId ?? '');
    }
    setSending(false);
```

- [ ] **Step 7: `connect/speed-dating/session.tsx` — `speedDateJoined`**

Read `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx` to find where a session starts (the join/connect action). Add `Analytics.speedDateJoined()` at that point — typically when the user successfully enters a room or confirms joining.

- [ ] **Step 8: `connect/speed-dating/result.tsx` — `speedDateCompleted`**

Add `Analytics.speedDateCompleted()` in a `useEffect` that runs on mount (the result screen only appears after a session ends):

```ts
  useEffect(() => {
    Analytics.speedDateCompleted();
  }, []);
```

- [ ] **Step 9: `grow/roxy-chat.tsx` — `roxyChatOpened`**

Add `Analytics.roxyChatOpened()` in a `useEffect` on mount. The file already has a `useEffect` for scroll — add a separate one:

```ts
  useEffect(() => {
    Analytics.roxyChatOpened();
  }, []);
```

- [ ] **Step 10: `grow/index.tsx` — `roxyGreetingViewed`**

In the existing `useEffect` that calls `callEdgeFunction('roxy-greeting', {})`, add `Analytics.roxyGreetingViewed()` when the greeting data arrives:

```ts
    callEdgeFunction<{ greeting: string }>('roxy-greeting', {})
      .then(({ data }) => {
        setGreeting(data?.greeting ?? null);
        if (data?.greeting) Analytics.roxyGreetingViewed();
      })
      .finally(() => setGreetingLoading(false));
```

- [ ] **Step 11: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: 102 tests pass.

- [ ] **Step 12: Commit**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git add "apps/mobile/app/(tabs)/grow/people.tsx" "apps/mobile/app/(tabs)/discover/community/create-post.tsx" "apps/mobile/app/(tabs)/discover/community/post/[postId].tsx" "apps/mobile/app/(tabs)/discover/community/[id].tsx" "apps/mobile/app/(tabs)/connect/chat/[id].tsx" "apps/mobile/app/(tabs)/connect/speed-dating/session.tsx" "apps/mobile/app/(tabs)/connect/speed-dating/result.tsx" "apps/mobile/app/(tabs)/grow/roxy-chat.tsx" "apps/mobile/app/(tabs)/grow/index.tsx" && git commit -m "feat: analytics events across all key screens"
```

---

## Task 7: Final verification + PR

- [ ] **Step 1: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: 102 tests pass across 18 suites.

- [ ] **Step 2: Push and open PR**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && git push origin session-11-firebase && gh pr create --base main --title "feat: session 11 — Firebase Analytics + Crashlytics" --body "$(cat <<'EOF'
## Summary
- Install @react-native-firebase/app, analytics, crashlytics
- Auto screen tracking via root layout usePathname
- Global JS error handler + React ErrorBoundary for all crash types
- logError() in every catch block across 9 screen files
- Analytics events for friends, posts, communities, chat, speed dating, Roxy AI
- Crashlytics user ID set on login/logout

## Test plan
- [ ] 102 unit tests pass
- [ ] EAS preview build succeeds (minSdkVersion 24 already set)
- [ ] Open Firebase console → verify first events appear after running app
- [ ] Force a test error → verify it appears in Crashlytics

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Package install + config files + app.json plugins — Task 1
- ✅ Jest mocks for all 3 firebase packages — Task 1
- ✅ `lib/analytics.ts` typed wrapper — Task 2
- ✅ `lib/errorLogger.ts` crashlytics utility — Task 2
- ✅ `components/ErrorBoundary.tsx` — Task 2
- ✅ Screen tracking via `usePathname` in root layout — Task 3
- ✅ Global JS error handler in root layout — Task 3
- ✅ User ID set on auth state change — Task 3
- ✅ ErrorBoundary wrapping Stack — Task 3
- ✅ 5 friend analytics events in friendStore — Task 4
- ✅ logError in all 9 catch-block screen files — Task 5
- ✅ All 9 screen analytics events (DM, post, community, chat, speed date, Roxy) — Task 6

**Type consistency:**
- `Analytics.friendRequestSent(targetId: string)` called with `targetId` in store ✅
- `Analytics.dmOpened(data.id)` — `data.id` is string from Supabase ✅
- `Analytics.messageSent(conversationId ?? '')` — `conversationId` from `useLocalSearchParams` can be undefined, fallback to `''` ✅
- `logError(e: unknown, context?: string)` — all call sites pass `e` (the caught error) ✅
- `setCrashlyticsUser(user?.id ?? null)` — accepts `string | null` ✅
