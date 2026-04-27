# Games Platform — Implementation Plan Part 2: Mobile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Games stub in the Discover tab with a real games list, add a WebView launcher screen, and inject the Roxy JS SDK so games can communicate with the app.

**Prerequisite:** Part 1 must be merged. Migration 046 must be applied.

**Architecture:** Games subtab queries `community_games` joined to `games` for the user's active community. Tapping a game opens either a native route (Roxy games with url=null, e.g. Speed Dating) or a full-screen WebView with the Roxy SDK injected. SDK uses React Native WebView's `postMessage` / `onMessage` bridge.

**Tech Stack:** Expo Router, React Native WebView (`react-native-webview`), FlashList, Supabase

---

## File Map

**Create:**
- `apps/mobile/app/(tabs)/discover/games/[gameId].tsx` — WebView launcher
- `apps/mobile/lib/roxyGameSdk.ts` — JS string injected into WebView
- `apps/mobile/store/gamesStore.ts` — community games state

**Modify:**
- `apps/mobile/app/(tabs)/discover/index.tsx` — wire real Games subtab
- `apps/mobile/types/index.ts` — add Game type

---

### Task 10: Game Type + gamesStore

**Files:**
- Modify: `apps/mobile/types/index.ts`
- Create: `apps/mobile/store/gamesStore.ts`

- [ ] **Step 1: Add Game type to types/index.ts**

Add after the existing types:

```ts
export type GameCategory = 'party' | 'trivia' | 'dating' | 'icebreaker' | 'other';
export type GamePublisher = 'roxy' | 'community';

export interface Game {
  id: string;
  name: string;
  short_description: string;
  category: GameCategory;
  publisher_type: GamePublisher;
  url: string | null;           // null = native Roxy game
  thumbnail_url: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Write gamesStore.ts**

```ts
// apps/mobile/store/gamesStore.ts
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { Game } from '../types';

interface GamesState {
  games: Game[];
  loading: boolean;
  communityId: string | null;
  fetchGames: (communityId: string) => Promise<void>;
}

export const useGamesStore = create<GamesState>((set, get) => ({
  games: [],
  loading: false,
  communityId: null,

  fetchGames: async (communityId: string) => {
    if (get().communityId === communityId && get().games.length > 0) return;
    set({ loading: true, communityId });

    const { data, error } = await supabase
      .from('community_games')
      .select('games(id, name, short_description, category, publisher_type, url, thumbnail_url, created_at)')
      .eq('community_id', communityId);

    if (!error && data) {
      const games = data
        .map((row: any) => row.games)
        .filter(Boolean) as Game[];
      set({ games, loading: false });
    } else {
      set({ loading: false });
    }
  },
}));
```

- [ ] **Step 3: Write gamesStore tests**

```ts
// apps/mobile/__tests__/store/gamesStore.test.ts
import { useGamesStore } from '../../store/gamesStore';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({
          data: [
            { games: { id: 'g1', name: 'Speed Dating', short_description: 'Speed dates', category: 'dating', publisher_type: 'roxy', url: null, thumbnail_url: null, created_at: '' } },
            { games: { id: 'g2', name: 'WLW Trivia', short_description: 'Trivia', category: 'trivia', publisher_type: 'community', url: 'https://trivia.app', thumbnail_url: null, created_at: '' } },
          ],
          error: null,
        })),
      })),
    })),
  },
}));

describe('gamesStore', () => {
  beforeEach(() => useGamesStore.setState({ games: [], loading: false, communityId: null }));

  it('fetchGames populates games list', async () => {
    await useGamesStore.getState().fetchGames('c1');
    expect(useGamesStore.getState().games).toHaveLength(2);
    expect(useGamesStore.getState().games[0].name).toBe('Speed Dating');
  });

  it('does not re-fetch if same communityId and games exist', async () => {
    await useGamesStore.getState().fetchGames('c1');
    const { supabase } = jest.requireMock('../../lib/supabase');
    const callCount = (supabase.from as jest.Mock).mock.calls.length;
    await useGamesStore.getState().fetchGames('c1');
    expect((supabase.from as jest.Mock).mock.calls.length).toBe(callCount);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd apps/mobile && npx jest __tests__/store/gamesStore.test.ts --no-coverage
```
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/types/index.ts apps/mobile/store/gamesStore.ts "apps/mobile/__tests__/store/gamesStore.test.ts"
git commit -m "feat(games): Game type + gamesStore — fetchGames from community_games join"
```

---

### Task 11: Roxy JS SDK

**Files:**
- Create: `apps/mobile/lib/roxyGameSdk.ts`

- [ ] **Step 1: Write SDK**

```ts
// apps/mobile/lib/roxyGameSdk.ts
// Returns a JS string injected into the WebView before page load.
// The game calls window.Roxy.* and the RN host responds via onMessage.

export function buildRoxySDK(user: { id: string; displayName: string }): string {
  return `
(function() {
  window.Roxy = {
    _userId: ${JSON.stringify(user.id)},
    _displayName: ${JSON.stringify(user.displayName)},

    getUser: function() {
      return { id: window.Roxy._userId, displayName: window.Roxy._displayName };
    },

    close: function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'roxy:close' }));
    },

    shareScore: function(score, message) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'roxy:shareScore',
        score: score,
        message: message || '',
      }));
    },
  };

  true; // required for injectedJavaScript
})();
`;
}
```

- [ ] **Step 2: Write SDK test**

```ts
// apps/mobile/__tests__/lib/roxyGameSdk.test.ts
import { buildRoxySDK } from '../../lib/roxyGameSdk';

describe('buildRoxySDK', () => {
  it('injects user id and displayName', () => {
    const sdk = buildRoxySDK({ id: 'u1', displayName: 'Maya' });
    expect(sdk).toContain('"u1"');
    expect(sdk).toContain('"Maya"');
  });

  it('contains roxy:close postMessage', () => {
    const sdk = buildRoxySDK({ id: 'u1', displayName: 'Maya' });
    expect(sdk).toContain('roxy:close');
  });

  it('contains roxy:shareScore postMessage', () => {
    const sdk = buildRoxySDK({ id: 'u1', displayName: 'Maya' });
    expect(sdk).toContain('roxy:shareScore');
  });

  it('ends with true for injectedJavaScript requirement', () => {
    const sdk = buildRoxySDK({ id: 'u1', displayName: 'Maya' });
    expect(sdk.trim().endsWith('true;')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd apps/mobile && npx jest __tests__/lib/roxyGameSdk.test.ts --no-coverage
```
Expected: PASS, 4 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/roxyGameSdk.ts "apps/mobile/__tests__/lib/roxyGameSdk.test.ts"
git commit -m "feat(games): Roxy JS SDK — injected bridge for getUser, close, shareScore"
```

---

### Task 12: WebView Game Launcher

**Files:**
- Create: `apps/mobile/app/(tabs)/discover/games/[gameId].tsx`

- [ ] **Step 1: Check react-native-webview is installed**

```bash
grep "react-native-webview" apps/mobile/package.json
```
If not present:
```bash
cd apps/mobile && npm install react-native-webview --legacy-peer-deps
```

- [ ] **Step 2: Write WebView launcher**

```tsx
// apps/mobile/app/(tabs)/discover/games/[gameId].tsx
import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGamesStore } from '../../../../store/gamesStore';
import { useAuthStore } from '../../../../store/authStore';
import { buildRoxySDK } from '../../../../lib/roxyGameSdk';
import { COLORS } from '../../../../lib/constants';

// react-native-webview guarded import
let WebViewModule: any = null;
try { WebViewModule = require('react-native-webview'); } catch {}
const WebView = WebViewModule?.WebView ?? null;

export default function GameLaunchScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { games } = useGamesStore();
  const webViewRef = useRef<any>(null);

  const game = games.find(g => g.id === gameId);

  if (!game || !game.url) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
          <Text style={styles.closeText}>×</Text>
        </TouchableOpacity>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Game not available</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sdk = buildRoxySDK({
    id: user?.id ?? '',
    displayName: user?.user_metadata?.display_name ?? '',
  });

  const handleMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'roxy:close') router.back();
      if (msg.type === 'roxy:shareScore') {
        void Share.share({ message: msg.message || `I scored ${msg.score} on ${game.name} in Roxy!` });
      }
    } catch {}
  };

  if (!WebView) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
          <Text style={styles.closeText}>×</Text>
        </TouchableOpacity>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>WebView not available on this platform</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.closeText}>×</Text>
        </TouchableOpacity>
        <Text style={styles.gameName} numberOfLines={1}>{game.name}</Text>
        <View style={{ width: 32 }} />
      </SafeAreaView>

      <WebView
        ref={webViewRef}
        source={{ uri: game.url }}
        injectedJavaScript={sdk}
        onMessage={handleMessage}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={COLORS.primary} size="large" />
          </View>
        )}
        style={{ flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  closeBtn: { padding: 4 },
  closeText: { fontSize: 28, color: COLORS.textPrimary, fontWeight: '300' },
  gameName: { flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 15, color: COLORS.textPrimary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 15 },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
});
```

- [ ] **Step 3: tsc check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep "games/\[gameId\]" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(tabs)/discover/games/[gameId].tsx"
git commit -m "feat(games): WebView game launcher — Roxy SDK injected, postMessage bridge, guarded import"
```

---

### Task 13: Real Games Subtab in Discover

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/index.tsx`

- [ ] **Step 1: Read current discover/index.tsx games section**

Find the existing Games stub (the `subTab === 'games'` block) — lines with Speed Dating card and Community Icebreakers card.

- [ ] **Step 2: Add GamesSection component before DiscoverScreen**

Add these imports at the top:
```ts
import { useGamesStore } from '../../../store/gamesStore';
import type { Game } from '../../../types';
```

Add this component before `export default function DiscoverScreen()`:

```tsx
function GamesSection({
  communityId,
  onNavigateToGame,
  onNavigateToSpeedDating,
}: {
  communityId: string | null;
  onNavigateToGame: (gameId: string) => void;
  onNavigateToSpeedDating: () => void;
}) {
  const { games, loading, fetchGames } = useGamesStore();

  useEffect(() => {
    if (communityId) void fetchGames(communityId);
  }, [communityId]);

  if (!communityId) {
    return (
      <View style={gamesStyles.empty}>
        <Text style={gamesStyles.emptyText}>Join a community to see games.</Text>
      </View>
    );
  }

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 48 }} />;

  return (
    <FlashList
      data={games}
      keyExtractor={item => item.id}
      estimatedItemSize={120}
      numColumns={2}
      contentContainerStyle={{ padding: 12 }}
      renderItem={({ item }) => {
        const isNative = item.url === null;
        return (
          <TouchableOpacity
            style={gamesStyles.card}
            onPress={() => isNative ? onNavigateToSpeedDating() : onNavigateToGame(item.id)}
            activeOpacity={0.8}
          >
            <View style={gamesStyles.thumbnail}>
              {item.thumbnail_url
                ? <Image source={{ uri: item.thumbnail_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                : <Text style={gamesStyles.thumbnailEmoji}>🎮</Text>
              }
            </View>
            <Text style={gamesStyles.gameName} numberOfLines={1}>{item.name}</Text>
            <Text style={[gamesStyles.publisherBadge, item.publisher_type === 'roxy' && gamesStyles.roxyBadge]}>
              {item.publisher_type === 'roxy' ? 'By Roxy' : 'Community'}
            </Text>
            <TouchableOpacity
              style={gamesStyles.playBtn}
              onPress={() => isNative ? onNavigateToSpeedDating() : onNavigateToGame(item.id)}
            >
              <Text style={gamesStyles.playBtnText}>Play</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={
        <View style={gamesStyles.empty}>
          <Text style={gamesStyles.emptyText}>No games enabled yet. Ask your community admin to add some.</Text>
        </View>
      }
      ListFooterComponent={
        <TouchableOpacity
          style={gamesStyles.suggestBtn}
          onPress={() => router.push('/(tabs)/discover/games/submit' as any)}
        >
          <Text style={gamesStyles.suggestBtnText}>+ Suggest a game</Text>
        </TouchableOpacity>
      }
    />
  );
}

const gamesStyles = StyleSheet.create({
  card: {
    flex: 1, margin: 4, backgroundColor: COLORS.surface,
    borderRadius: 12, padding: 10, gap: 6,
  },
  thumbnail: {
    width: '100%', aspectRatio: 16 / 9,
    backgroundColor: COLORS.surfaceLight, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbnailEmoji: { fontSize: 28 },
  gameName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13 },
  publisherBadge: { color: COLORS.textMuted, fontSize: 11 },
  roxyBadge: { color: COLORS.primary },
  playBtn: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingVertical: 6, alignItems: 'center',
  },
  playBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  empty: { flex: 1, alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  suggestBtn: { alignItems: 'center', padding: 16 },
  suggestBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },
});
```

- [ ] **Step 3: Replace the games stub in DiscoverScreen**

Find:
```tsx
      {/* Games */}
      {subTab === 'games' && (
        <View style={styles.gamesContainer}>
          {/* Speed Dating card */}
          ...
        </View>
      )}
```

Replace with:
```tsx
      {/* Games */}
      {subTab === 'games' && (
        <GamesSection
          communityId={joinedIds.size > 0 ? Array.from(joinedIds)[0] : null}
          onNavigateToGame={(id) => router.push(`/(tabs)/discover/games/${id}` as any)}
          onNavigateToSpeedDating={() => router.push('/speed-dating' as any)}
        />
      )}
```

Also add `Image` import from `expo-image` if not already present.

- [ ] **Step 4: tsc check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep "discover/index" | head -10
```
Fix any errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/discover/index.tsx"
git commit -m "feat(games): real Games subtab — community-specific catalog, Roxy/community badges, Play CTA"
```

---

### Task 14: Final QA + PR

- [ ] **Step 1: Run all tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -8
```
Expected: all PASS, 0 failing (292+ tests).

- [ ] **Step 2: tsc zero errors**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep -v node_modules
```
Expected: no output.

- [ ] **Step 3: Lint**

```bash
cd apps/mobile && npx eslint . --ext .ts,.tsx --max-warnings 0 2>&1 | tail -5
```
Expected: no output.

- [ ] **Step 4: Commit + PR**

```bash
git push -u origin session-14-games-mobile
gh pr create --base main \
  --title "feat(games): Mobile games tab — real catalog, WebView launcher, Roxy JS SDK" \
  --body "Replaces Games stub with real community-specific game list. WebView launcher with injected Roxy SDK bridge. Prerequisite: Part 1 (Studio) merged."
```
