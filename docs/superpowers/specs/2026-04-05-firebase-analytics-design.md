# Firebase Analytics + Crashlytics Design Spec
**Date:** 2026-04-05
**Session:** 11
**Branch:** session-11-firebase

---

## Overview

Integrate Firebase Analytics and Crashlytics into the Roxy mobile app. Every screen view is tracked automatically. Key product actions fire named events. All errors — native crashes, unhandled JS exceptions, React render failures, and every handled `catch` block — are reported to Crashlytics.

---

## Section 1 — Package Installation & Config

### Packages to install

```bash
cd apps/mobile
npx expo install @react-native-firebase/app @react-native-firebase/analytics @react-native-firebase/crashlytics
```

### Config files

Place both downloaded files from the Firebase console inside `apps/mobile/`:
- `apps/mobile/google-services.json` — Android
- `apps/mobile/GoogleService-Info.plist` — iOS

Both files are safe to commit (they contain project IDs, not secrets). Add them to git.

### `app.json` plugin additions

Add to the `plugins` array in `apps/mobile/app.json`:

```json
"@react-native-firebase/app",
"@react-native-firebase/crashlytics"
```

Analytics is included automatically via the app plugin — no separate plugin entry needed.

### Jest mocks

Add three mock files so Jest doesn't fail on firebase imports:

`apps/mobile/__mocks__/@react-native-firebase/app.js`:
```js
module.exports = { default: jest.fn() };
```

`apps/mobile/__mocks__/@react-native-firebase/analytics.js`:
```js
module.exports = () => ({
  logScreenView: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
});
module.exports.default = module.exports;
```

`apps/mobile/__mocks__/@react-native-firebase/crashlytics.js`:
```js
module.exports = () => ({
  recordError: jest.fn(),
  log: jest.fn(),
  setUserId: jest.fn(),
  setCrashlyticsCollectionEnabled: jest.fn(),
});
module.exports.default = module.exports;
```

Add to `jest.config.js` `moduleNameMapper`:
```js
'^@react-native-firebase/(.*)$': '<rootDir>/__mocks__/@react-native-firebase/$1.js',
```

---

## Section 2 — Core Libraries

### `apps/mobile/lib/analytics.ts` (new)

Typed wrapper around Firebase Analytics. All event calls go through this file — never call `analytics().logEvent(...)` directly in screen/store code.

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

All calls are fire-and-forget (no `await` needed at call sites).

### `apps/mobile/lib/errorLogger.ts` (new)

Thin wrapper around Crashlytics for consistent error reporting.

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

Every `catch` block in the app calls `logError(e)`. Never call `crashlytics()` directly in screen/store code.

### `apps/mobile/components/ErrorBoundary.tsx` (new)

Catches React render errors (white screen crashes) and reports them.

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

---

## Section 3 — Root Layout (`app/_layout.tsx`)

Four additions to the existing root layout:

**1. Screen tracking** — `usePathname` fires `Analytics.screenView` on every navigation:
```ts
const pathname = usePathname();
useEffect(() => { Analytics.screenView(pathname); }, [pathname]);
```

**2. Global JS error handler** — catches unhandled exceptions and promise rejections:
```ts
useEffect(() => {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    logError(error, isFatal ? 'fatal_js_error' : 'unhandled_js_error');
    previous?.(error, isFatal);
  });
}, []);
```

**3. User identity** — sets both Analytics and Crashlytics user ID when auth state changes:
```ts
useEffect(() => {
  Analytics.setUser(user?.id ?? null);
  setCrashlyticsUser(user?.id ?? null);
}, [user?.id]);
```

**4. ErrorBoundary wrapper** — wraps the Stack navigator:
```tsx
<ErrorBoundary>
  <Stack screenOptions={{ headerShown: false }} />
</ErrorBoundary>
```

---

## Section 4 — Analytics Events in `friendStore.ts`

Add one `Analytics` call after each successful store action (before or after `fetchAll`):

| Action | Event |
|---|---|
| `sendRequest` | `Analytics.friendRequestSent(targetId)` |
| `acceptRequest` | `Analytics.friendRequestAccepted(friendshipId)` |
| `rejectRequest` | `Analytics.friendRequestDeclined(friendshipId)` |
| `cancelRequest` | `Analytics.friendRequestCancelled(friendshipId)` |
| `unfriend` | `Analytics.friendRemoved(friendshipId)` |

The store has no `catch` blocks — it throws. `logError` is called at the screen level where those errors are caught.

---

## Section 5 — Analytics Events in Screens

| File | Events to add |
|---|---|
| `grow/people.tsx` | `Analytics.dmOpened(data.id)` when existing DM found; `Analytics.dmCreated()` when new DM created |
| `discover/community/create-post.tsx` | `Analytics.postCreated(communityId)` on success |
| `discover/community/post/[postId].tsx` | `Analytics.postViewed(postId)` on mount; `Analytics.commentCreated(postId)` on comment submit |
| `discover/community/[id].tsx` | `Analytics.communityViewed(id)` on mount; `Analytics.communityJoined(id)` on join |
| `connect/speed-dating/session.tsx` | `Analytics.speedDateJoined()` on session start |
| `connect/speed-dating/result.tsx` | `Analytics.speedDateCompleted()` on mount |
| `connect/chat/[id].tsx` | `Analytics.messageSent(conversationId)` after message sends successfully |
| `grow/roxy-chat.tsx` | `Analytics.roxyChatOpened()` on mount |
| `grow/index.tsx` | `Analytics.roxyGreetingViewed()` when greeting loads |

---

## Section 6 — `logError` in All Catch Blocks

Every `catch` block in these files gets `logError(e)` added as the first line:

- `app/(tabs)/grow/people.tsx` — 2 catch blocks (`handleFriendTap`, `confirmUnfriend`)
- `app/(tabs)/discover/community/[id].tsx`
- `app/(tabs)/discover/community/members/[communityId].tsx`
- `app/(tabs)/discover/index.tsx`
- `app/(tabs)/profile/delete-account.tsx`
- `app/(tabs)/discover/community/create-post.tsx`
- `app/(tabs)/connect/speed-dating/session.tsx`
- `app/(tabs)/profile/index.tsx`
- `app/(tabs)/connect/speed-dating/result.tsx`

Pattern for every catch block:
```ts
} catch (e: any) {
  logError(e, 'context_description');  // add this line
  Alert.alert('Error', e?.message);    // existing line
}
```

---

## Section 7 — Files Touched

| File | Action |
|---|---|
| `apps/mobile/package.json` | Add 3 firebase packages |
| `apps/mobile/app.json` | Add 2 config plugins |
| `apps/mobile/google-services.json` | Place downloaded file, commit |
| `apps/mobile/GoogleService-Info.plist` | Place downloaded file, commit |
| `apps/mobile/__mocks__/@react-native-firebase/*.js` | Create 3 jest mock files |
| `apps/mobile/jest.config.js` | Add moduleNameMapper entries |
| `apps/mobile/lib/analytics.ts` | Create |
| `apps/mobile/lib/errorLogger.ts` | Create |
| `apps/mobile/components/ErrorBoundary.tsx` | Create |
| `apps/mobile/app/_layout.tsx` | Screen tracking, global error handler, user ID, ErrorBoundary |
| `apps/mobile/store/friendStore.ts` | 5 analytics event calls |
| 9 screen files | `logError` in every catch block |
| 9 screen files | Analytics event calls at key moments |

---

## Out of Scope

- Custom dimensions or user properties beyond user ID
- Firebase Remote Config or A/B testing
- Firebase Performance Monitoring (separate package, add in a future session if needed)
- Push notification analytics (FCM — already using Expo Notifications)
