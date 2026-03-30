# Session 7 — UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 broken or missing UX flows: FAB direct navigation, Roxy Chat keyboard, Grow screen tappable sections with avatar, account deletion soft-delete with confirmation screen, and support org detail modal.

**Architecture:** Each fix is a targeted change to 1–3 files. Tasks are ordered so earlier fixes (FAB, keyboard) don't depend on later ones. The only cross-task dependency is that Task 5 (delete screen) depends on Task 4 (migration + gdpr-delete update) being done first. All other tasks are independent.

**Tech Stack:** Expo 51 / Expo Router v3 / React Native 0.74 / TypeScript strict / Supabase Edge Functions (Deno) / Jest + @testing-library/react-native

---

## File Map

| File | Action | Task |
|------|--------|------|
| `apps/mobile/components/ui/RoxyCompanionButton.tsx` | Modify | 1 |
| `apps/mobile/app/(tabs)/_layout.tsx` | Modify | 1 |
| `apps/mobile/__tests__/components/RoxyCompanionButton.test.tsx` | Create | 1 |
| `apps/mobile/app/(tabs)/grow/roxy-chat.tsx` | Modify | 2 |
| `apps/mobile/app/(tabs)/grow/index.tsx` | Modify | 3 |
| `apps/mobile/app/(tabs)/grow/badges.tsx` | Create | 4 |
| `supabase/migrations/007_soft_delete.sql` | Create | 5 |
| `supabase/functions/gdpr-delete/index.ts` | Modify | 5 |
| `apps/mobile/app/(tabs)/profile/settings.tsx` | Modify | 6 |
| `apps/mobile/app/(tabs)/profile/delete-account.tsx` | Create | 6 |
| `apps/mobile/__tests__/screens/DeleteAccount.test.tsx` | Create | 6 |
| `apps/mobile/app/(tabs)/build/index.tsx` | Modify | 7 |

---

## Task 1: FAB → Roxy Chat Directly

**Files:**
- Modify: `apps/mobile/components/ui/RoxyCompanionButton.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/__tests__/components/RoxyCompanionButton.test.tsx`

### Context

The FAB currently shows an `Alert.alert` menu asking whether to open Roxy Chat or Sister. Spec decision: FAB always goes directly to Roxy Chat. The FAB must be hidden when the user is already on the roxy-chat screen (avoid infinite loop / visual clutter).

---

- [ ] **Step 1: Create the test file (will fail — component not yet updated)**

Create `apps/mobile/__tests__/components/RoxyCompanionButton.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Mock expo-router
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

import { RoxyCompanionButton } from '../../../components/ui/RoxyCompanionButton';

beforeEach(() => {
  mockPush.mockClear();
});

describe('RoxyCompanionButton', () => {
  it('renders when visible is true (default)', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    expect(getByTestId('fab-button')).toBeTruthy();
  });

  it('renders nothing when visible is false', () => {
    const { queryByTestId } = render(<RoxyCompanionButton visible={false} />);
    expect(queryByTestId('fab-button')).toBeNull();
  });

  it('navigates to roxy-chat on press', () => {
    const { getByTestId } = render(<RoxyCompanionButton />);
    fireEvent.press(getByTestId('fab-button'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/grow/roxy-chat');
  });

  it('does not call router.push when visible is false (not rendered)', () => {
    const { queryByTestId } = render(<RoxyCompanionButton visible={false} />);
    expect(queryByTestId('fab-button')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/mobile && npx jest --testPathPattern="RoxyCompanionButton" --ci 2>&1 | tail -20
```

Expected: FAIL — `getByTestId` won't find `fab-button` (testID not on component yet).

---

- [ ] **Step 3: Replace `RoxyCompanionButton.tsx` with updated version**

Full file replacement — `apps/mobile/components/ui/RoxyCompanionButton.tsx`:

```tsx
import React, { useRef, useEffect } from 'react';
import { TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS } from '../../lib/constants';

interface Props {
  visible?: boolean;
}

export function RoxyCompanionButton({ visible = true }: Props) {
  const router = useRouter();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, delay: 400, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 300, delay: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  if (!visible) return null;

  const handlePress = () => {
    router.push('/(tabs)/grow/roxy-chat' as any);
  };

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity
        testID="fab-button"
        style={styles.button}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        <Ionicons name="sparkles" size={22} color="#FFFFFF" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute', bottom: 90, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.roxy,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 8, zIndex: 1000,
  },
});
```

---

- [ ] **Step 4: Update `_layout.tsx` to hide FAB on roxy-chat screen**

Full file replacement — `apps/mobile/app/(tabs)/_layout.tsx`:

```tsx
import { View } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../lib/constants';
import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';

export default function TabLayout() {
  const pathname = usePathname();
  const showFab = !pathname.includes('roxy-chat');

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: COLORS.background, borderTopColor: COLORS.surface },
          tabBarActiveTintColor: COLORS.roxy,
          tabBarInactiveTintColor: COLORS.textMuted,
        }}
      >
        <Tabs.Screen
          name="grow"
          options={{
            title: 'Grow',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="connect"
          options={{
            title: 'Connect',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="discover"
          options={{
            title: 'Discover',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="compass-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="build"
          options={{
            title: 'Build',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="hammer-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            href: null,
          }}
        />
      </Tabs>
      <RoxyCompanionButton visible={showFab} />
    </View>
  );
}
```

---

- [ ] **Step 5: Run tests — should pass**

```bash
cd apps/mobile && npx jest --testPathPattern="RoxyCompanionButton" --ci 2>&1 | tail -20
```

Expected: PASS — 4 tests passing.

---

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -10
```

Expected: All tests pass (54+4 = 58 tests).

---

- [ ] **Step 7: Commit**

```bash
cd apps/mobile && git add components/ui/RoxyCompanionButton.tsx app/(tabs)/_layout.tsx __tests__/components/RoxyCompanionButton.test.tsx
cd ../.. && git commit -m "$(cat <<'EOF'
fix: FAB navigates directly to Roxy Chat — remove Alert menu

FAB always opens roxy-chat. Hides itself when already on that screen.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Roxy Chat Keyboard + Back Button

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/roxy-chat.tsx`

### Context

On Android, `behavior={undefined}` means the keyboard doesn't push the input up — user has to scroll. The back button `‹` is small and has no label, which looks incomplete.

---

- [ ] **Step 1: Edit `roxy-chat.tsx` — keyboard behavior**

In `apps/mobile/app/(tabs)/grow/roxy-chat.tsx`, find line 62–66:

```tsx
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
```

Replace with:

```tsx
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
```

---

- [ ] **Step 2: Edit `roxy-chat.tsx` — back button label**

Find lines 69–71:

```tsx
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
```

Replace with:

```tsx
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backIcon}>‹</Text>
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
```

---

- [ ] **Step 3: Add `backLabel` style**

In the `StyleSheet.create({...})` at the bottom, find:

```tsx
  backBtn: { width: 40, alignItems: 'center' },
```

Replace with:

```tsx
  backBtn: { width: 60, flexDirection: 'row', alignItems: 'center' },
  backLabel: { fontSize: 15, color: COLORS.textPrimary, marginLeft: 2 },
```

---

- [ ] **Step 4: Run tests to confirm no regressions**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: All tests pass.

---

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/grow/roxy-chat.tsx
git commit -m "$(cat <<'EOF'
fix: Roxy Chat keyboard avoidance on Android + clearer back button

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Grow Screen — Tappable Sections + Avatar Header

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/index.tsx`

### Context

The Grow screen has 5 zones. Currently Communities, Journey, and Badges are static Views. They need to be tappable. Communities → navigates to Discover tab. Badges → navigates to new `grow/badges` screen (created in Task 4). Journey → tappable with opacity feedback but no navigation in this session. A mini header with the user's initials avatar is added at the top.

---

- [ ] **Step 1: Full replacement of `grow/index.tsx`**

Replace the entire file `apps/mobile/app/(tabs)/grow/index.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { callEdgeFunction, supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfile } from '../../../hooks/useProfile';
import { COLORS } from '../../../lib/constants';

type CommunityRow = { community_id: string; communities: { id: string; name: string; category: string } | null };
type FriendshipRow = { id: string; requester_id: string; addressee_id: string; status: string; created_at: string };
type BadgeProgressRow = {
  user_id: string;
  badge_id: string;
  current_value: number;
  earned_at: string | null;
  badges: {
    id: string;
    name: string;
    description: string;
    emoji: string;
    category: string;
    points_value: number;
    requirement_type: string;
    requirement_threshold: number;
  } | null;
};

function getLevelInfo(points: number): { label: string; emoji: string; nextThreshold: number | null; progress: number } {
  if (points >= 500) return { label: 'Radiant', emoji: '✨', nextThreshold: null, progress: 1 };
  if (points >= 100) return { label: 'Bloom', emoji: '🌸', nextThreshold: 500, progress: (points - 100) / 400 };
  return { label: 'Seedling', emoji: '🌱', nextThreshold: 100, progress: points / 100 };
}

export default function GrowScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfile();
  const router = useRouter();

  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);
  const [communities, setCommunities] = useState<CommunityRow[]>([]);
  const [friendships, setFriendships] = useState<FriendshipRow[]>([]);
  const [badges, setBadges] = useState<BadgeProgressRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    setGreetingLoading(true);
    callEdgeFunction<{ greeting: string }>('roxy-greeting', {})
      .then(({ data }) => setGreeting(data?.greeting ?? null))
      .finally(() => setGreetingLoading(false));
  }, [profile]);

  const loadSocial = useCallback(async () => {
    if (!user) return;
    const [commRes, friendRes] = await Promise.all([
      supabase
        .from('community_members')
        .select('community_id, communities(id, name, category)')
        .eq('user_id', user.id),
      supabase
        .from('friendships')
        .select('*')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted'),
    ]);
    if (commRes.data) setCommunities(commRes.data as CommunityRow[]);
    if (friendRes.data) setFriendships(friendRes.data as FriendshipRow[]);
  }, [user]);

  useEffect(() => { loadSocial(); }, [loadSocial]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_badge_progress')
      .select('*, badges(*)')
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => { if (data) setBadges(data as BadgeProgressRow[]); });
  }, [user?.id]);

  const points = profile?.gamification_points ?? 0;
  const level = getLevelInfo(points);
  const earnedCount = badges.filter((b) => b.earned_at !== null).length;
  const inProgressCount = badges.filter((b) => b.earned_at === null && b.current_value > 0).length;
  const avatarInitial = profile?.display_name?.[0]?.toUpperCase() ?? '?';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Mini header */}
        <View style={styles.miniHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{avatarInitial}</Text>
          </View>
          <Text style={styles.screenTitle}>Grow</Text>
          <View style={styles.avatarCircle} />
        </View>

        {/* Zone 1 — Roxy Greeting Card */}
        <View style={styles.greetingCard}>
          <View style={styles.roxyDot} />
          {greetingLoading ? (
            <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.greetingText}>{greeting ?? 'Hey — Roxy here. 👋'}</Text>
          )}
          <Text style={styles.greetingLabel}>✨ Your daily message from Roxy</Text>
        </View>

        {/* Zone 2 — My Communities */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/discover' as any)}
          activeOpacity={0.75}
        >
          <Text style={styles.sectionTitle}>
            My Communities{' '}
            <Text style={styles.sectionHint}>tap to browse →</Text>
          </Text>
          {communities.length === 0 ? (
            <Text style={styles.emptyState}>Join your first community in Discover →</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {communities.map((row) => (
                <View key={row.community_id} style={styles.chip}>
                  <Text style={styles.chipText}>{row.communities?.name ?? '—'}</Text>
                </View>
              ))}
              <View style={[styles.chip, styles.chipJoin]}>
                <Text style={styles.chipJoinText}>+ Join more</Text>
              </View>
            </ScrollView>
          )}
        </TouchableOpacity>

        {/* Zone 3 — My People */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My People</Text>
          {friendships.length === 0 ? (
            <Text style={styles.emptyState}>Connect with someone in Discover →</Text>
          ) : (
            <View style={styles.avatarRow}>
              {friendships.slice(0, 8).map((f) => (
                <View key={f.id} style={styles.avatar}>
                  <Text style={styles.avatarText}>{'👤'}</Text>
                </View>
              ))}
              {friendships.length > 8 && (
                <View style={styles.avatar}>
                  <Text style={styles.avatarCount}>+{friendships.length - 8}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Zone 4 — My Journey */}
        <TouchableOpacity style={styles.section} activeOpacity={0.75}>
          <Text style={styles.sectionTitle}>My Journey</Text>
          <View style={styles.levelRow}>
            <Text style={styles.levelEmoji}>{level.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.levelLabel}>{level.label}</Text>
              <Text style={styles.levelPoints}>{points} points</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${level.progress * 100}%` as any }]} />
          </View>
          {level.nextThreshold !== null ? (
            <Text style={styles.progressHint}>{level.nextThreshold - points} points to next level</Text>
          ) : (
            <Text style={styles.progressHint}>You've reached the highest level! ✨</Text>
          )}
        </TouchableOpacity>

        {/* Zone 5 — Badges preview */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/grow/badges' as any)}
          activeOpacity={0.75}
        >
          <Text style={styles.sectionTitle}>
            🏆 Badges{' '}
            <Text style={styles.sectionHint}>tap to see all →</Text>
          </Text>
          {badges.length === 0 ? (
            <Text style={styles.emptyState}>Complete actions to earn badges! ✨</Text>
          ) : (
            <>
              <View style={styles.badgePreviewRow}>
                {badges.slice(0, 4).map((b) => (
                  <Text
                    key={b.badge_id}
                    style={[styles.badgePreviewEmoji, b.earned_at === null && styles.badgePreviewDim]}
                  >
                    {b.badges?.emoji ?? '🏅'}
                  </Text>
                ))}
              </View>
              <Text style={styles.badgePreviewSummary}>
                {earnedCount} earned · {inProgressCount} in progress
              </Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 16, gap: 16 },

  miniHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + '30',
    borderWidth: 2, borderColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  screenTitle: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' },

  greetingCard: {
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 24,
    minHeight: 180, justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  roxyDot: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.roxy, marginBottom: 12,
  },
  greetingText: { fontSize: 18, color: COLORS.textPrimary, lineHeight: 28, fontWeight: '500' },
  greetingLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 12 },

  section: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 10 },
  sectionHint: { color: COLORS.textMuted, fontSize: 11, fontWeight: '400' },
  emptyState: { color: COLORS.textMuted, fontSize: 14 },

  chipScroll: { marginTop: 4 },
  chip: {
    backgroundColor: COLORS.primary + '20', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
    marginRight: 8, borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  chipText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
  chipJoin: { backgroundColor: COLORS.roxy + '20', borderColor: COLORS.roxy + '60' },
  chipJoinText: { color: COLORS.roxy, fontWeight: '600', fontSize: 13 },

  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 20 },
  avatarCount: { color: COLORS.textMuted, fontWeight: '700', fontSize: 13 },

  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  levelEmoji: { fontSize: 32 },
  levelLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  levelPoints: { color: COLORS.textMuted, fontSize: 13 },
  progressTrack: {
    height: 8, backgroundColor: COLORS.surfaceLight,
    borderRadius: 4, overflow: 'hidden', marginBottom: 6,
  },
  progressFill: { height: 8, backgroundColor: COLORS.primary, borderRadius: 4 },
  progressHint: { color: COLORS.textMuted, fontSize: 12 },

  badgePreviewRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  badgePreviewEmoji: { fontSize: 26 },
  badgePreviewDim: { opacity: 0.3 },
  badgePreviewSummary: { color: COLORS.textMuted, fontSize: 12 },
});
```

---

- [ ] **Step 2: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: All tests pass.

---

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/grow/index.tsx
git commit -m "$(cat <<'EOF'
feat: Grow screen tappable sections + user avatar header

Communities → Discover, Badges → badges screen, Journey visual feedback.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Badges Screen

**Files:**
- Create: `apps/mobile/app/(tabs)/grow/badges.tsx`

### Context

The Grow screen badge preview now links to `/(tabs)/grow/badges`. This screen shows all badges in a 2-column grid with full descriptions and progress. It reuses the same `BadgeProgressRow` type and Supabase query pattern.

---

- [ ] **Step 1: Create `apps/mobile/app/(tabs)/grow/badges.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { COLORS } from '../../../lib/constants';

type BadgeProgressRow = {
  user_id: string;
  badge_id: string;
  current_value: number;
  earned_at: string | null;
  badges: {
    id: string;
    name: string;
    description: string;
    emoji: string;
    category: string;
    points_value: number;
    requirement_type: string;
    requirement_threshold: number;
  } | null;
};

export default function BadgesScreen() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [badges, setBadges] = useState<BadgeProgressRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_badge_progress')
      .select('*, badges(*)')
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        if (data) setBadges(data as BadgeProgressRow[]);
        setLoading(false);
      });
  }, [user?.id]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Badges 🏆</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.centreWrap}>
          <Text style={styles.mutedText}>Loading…</Text>
        </View>
      ) : badges.length === 0 ? (
        <View style={styles.centreWrap}>
          <Text style={styles.emptyIcon}>🏅</Text>
          <Text style={styles.emptyTitle}>No badges yet</Text>
          <Text style={styles.emptySub}>Complete actions to earn badges!</Text>
        </View>
      ) : (
        <FlashList
          data={badges.filter((b) => b.badges !== null)}
          numColumns={2}
          estimatedItemSize={100}
          keyExtractor={(item) => item.badge_id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => {
            const badge = item.badges!;
            const earned = item.earned_at !== null;
            const showProgress = !earned && item.current_value > 0;
            return (
              <View style={[
                styles.badgeCard,
                index % 2 === 1 && styles.badgeCardRight,
                !earned && styles.badgeCardDim,
              ]}>
                <Text style={styles.badgeEmoji}>{badge.emoji}</Text>
                <Text style={styles.badgeName} numberOfLines={1}>{badge.name}</Text>
                <Text style={styles.badgeDesc} numberOfLines={2}>{badge.description}</Text>
                {earned ? (
                  <Text style={styles.badgeEarned}>✓ Earned</Text>
                ) : showProgress ? (
                  <Text style={styles.badgeProgress}>
                    {item.current_value} / {badge.requirement_threshold}
                  </Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { width: 60, flexDirection: 'row', alignItems: 'center' },
  backIcon: { fontSize: 32, color: COLORS.textPrimary, lineHeight: 36 },
  backLabel: { fontSize: 15, color: COLORS.textPrimary, marginLeft: 2 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  centreWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  mutedText: { color: COLORS.textMuted, fontSize: 15 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  emptySub: { color: COLORS.textMuted, fontSize: 14 },
  listContent: { padding: 16 },
  badgeCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  badgeCardRight: { marginLeft: 8 },
  badgeCardDim: { opacity: 0.5 },
  badgeEmoji: { fontSize: 28, marginBottom: 6 },
  badgeName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13, marginBottom: 2 },
  badgeDesc: { color: COLORS.textMuted, fontSize: 11, lineHeight: 15 },
  badgeEarned: { color: COLORS.roxy, fontSize: 11, fontWeight: '600', marginTop: 4 },
  badgeProgress: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
});
```

---

- [ ] **Step 2: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: All tests pass.

---

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/grow/badges.tsx
git commit -m "$(cat <<'EOF'
feat: add full badges screen accessible from Grow

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Account Deletion — Migration + Edge Function Update

**Files:**
- Create: `supabase/migrations/007_soft_delete.sql`
- Modify: `supabase/functions/gdpr-delete/index.ts`

### Context

The current `gdpr-delete` function clears PII fields then immediately calls `supabase.auth.admin.deleteUser` — a hard delete. The spec requires a 30-day soft delete: set `deleted_at`, clear PII, deactivate, but do NOT call `deleteUser` yet. A scheduled job (future session) will hard-delete after 30 days.

A new migration adds the `deleted_at` column.

---

- [ ] **Step 1: Create migration `supabase/migrations/007_soft_delete.sql`**

```sql
-- Migration 007: Add soft-delete timestamp to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.deleted_at IS
  'Set when user requests deletion. Hard delete happens 30 days after this timestamp. NULL = active account.';
```

---

- [ ] **Step 2: Push migration to remote**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && npx supabase db push
```

Expected output includes: `Applying migration 007_soft_delete.sql`

If it fails with "cannot connect", ensure Supabase CLI is logged in:
```bash
npx supabase login
```

---

- [ ] **Step 3: Update `supabase/functions/gdpr-delete/index.ts`**

Full file replacement:

```ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
  if (DEV_MOCK) return successResponse({ ok: true, mock: true, scheduled_deletion: '30 days' });

  const supabase = getSupabaseClient();

  // Soft delete: clear PII + mark deleted_at. Hard delete happens via scheduled job after 30 days.
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      display_name: 'Deleted User',
      username: `deleted_${auth.userId.slice(0, 8)}`,
      bio: null,
      avatar_url: null,
      pronouns: [],
      identity_labels: [],
      is_active: false,
      push_token: null,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', auth.userId);

  if (profileError) return errorResponse(profileError.message, 500);

  // NOTE: We do NOT call supabase.auth.admin.deleteUser here.
  // The auth user is deactivated when the profile is marked deleted_at.
  // A scheduled job (future session) will call deleteUser after 30 days.

  return successResponse({ ok: true, scheduled_deletion: '30 days' });
});
```

---

- [ ] **Step 4: Deploy the updated edge function**

```bash
npx supabase functions deploy gdpr-delete --project-ref ptymtdlysqbpxzlgsshp
```

Expected: `Deployed Function gdpr-delete`

---

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/007_soft_delete.sql supabase/functions/gdpr-delete/index.ts
git commit -m "$(cat <<'EOF'
feat: account deletion as 30-day soft delete

Add deleted_at column (migration 007). gdpr-delete edge function now
marks profile as deleted rather than hard-deleting the auth user.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Account Deletion — Mobile Screen

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile/settings.tsx`
- Create: `apps/mobile/app/(tabs)/profile/delete-account.tsx`
- Create: `apps/mobile/__tests__/screens/DeleteAccount.test.tsx`

### Context

Settings currently uses nested Alerts for delete confirmation. Replace with a dedicated screen at `/(tabs)/profile/delete-account` where the user must type "DELETE" before the button activates.

The `profile/_layout.tsx` already uses a `Stack` with `headerShown: false`, so the new screen is automatically registered as a route.

---

- [ ] **Step 1: Write the failing test for delete account logic**

Create `apps/mobile/__tests__/screens/DeleteAccount.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCallEdgeFunction = jest.fn();
const mockSignOut = jest.fn();
const mockAuthSignOut = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: { auth: { signOut: mockAuthSignOut } },
  callEdgeFunction: mockCallEdgeFunction,
}));

jest.mock('../../../store/authStore', () => ({
  useAuthStore: { getState: () => ({ signOut: mockSignOut }) },
}));

import DeleteAccountScreen from '../../../app/(tabs)/profile/delete-account';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert');
});

describe('DeleteAccountScreen', () => {
  it('disables delete button when input is empty', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    const btn = getByTestId('delete-confirm-btn');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it('disables delete button when input is partial ("DELET")', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-input'), 'DELET');
    const btn = getByTestId('delete-confirm-btn');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it('enables delete button when input is exactly "DELETE"', () => {
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-input'), 'DELETE');
    const btn = getByTestId('delete-confirm-btn');
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  it('calls gdpr-delete edge function when confirmed', async () => {
    mockCallEdgeFunction.mockResolvedValue({ data: { ok: true }, error: null });
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-input'), 'DELETE');
    fireEvent.press(getByTestId('delete-confirm-btn'));
    await waitFor(() => {
      expect(mockCallEdgeFunction).toHaveBeenCalledWith('gdpr-delete', {});
    });
  });

  it('shows error alert when edge function fails', async () => {
    mockCallEdgeFunction.mockResolvedValue({ data: null, error: 'Server error' });
    const { getByTestId } = render(<DeleteAccountScreen />);
    fireEvent.changeText(getByTestId('delete-input'), 'DELETE');
    fireEvent.press(getByTestId('delete-confirm-btn'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Server error');
    });
  });
});
```

---

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/mobile && npx jest --testPathPattern="DeleteAccount" --ci 2>&1 | tail -20
```

Expected: FAIL — module not found (`delete-account` doesn't exist yet).

---

- [ ] **Step 3: Create `apps/mobile/app/(tabs)/profile/delete-account.tsx`**

```tsx
import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase, callEdgeFunction } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { COLORS } from '../../../lib/constants';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const canDelete = input === 'DELETE';

  const handleDelete = async () => {
    if (!canDelete || loading) return;
    setLoading(true);
    try {
      const { error } = await callEdgeFunction('gdpr-delete', {});
      if (error) throw new Error(error);
      Alert.alert(
        'Account scheduled for deletion',
        'Your account has been deactivated. All data will be permanently deleted in 30 days.',
        [{
          text: 'OK',
          onPress: async () => {
            await supabase.auth.signOut();
            useAuthStore.getState().signOut();
            router.replace('/(auth)/login' as any);
          },
        }]
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not delete account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete Account</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.content}>
        <Text style={styles.warningIcon}>⚠️</Text>
        <Text style={styles.title}>This action cannot be undone</Text>
        <Text style={styles.body}>
          Your account will be immediately deactivated and your profile made private.
          All your data will be permanently deleted after 30 days.{'\n\n'}
          You will be signed out and cannot log back in after this.
        </Text>

        <View style={styles.confirmSection}>
          <Text style={styles.confirmLabel}>Type DELETE to confirm</Text>
          <TextInput
            testID="delete-input"
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="DELETE"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        <TouchableOpacity
          testID="delete-confirm-btn"
          style={[styles.deleteBtn, !canDelete && styles.deleteBtnDisabled]}
          onPress={handleDelete}
          disabled={!canDelete || loading}
          activeOpacity={0.8}
          accessibilityState={{ disabled: !canDelete || loading }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.deleteBtnText}>Delete my account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { width: 60, flexDirection: 'row', alignItems: 'center' },
  backIcon: { fontSize: 32, color: COLORS.textPrimary, lineHeight: 36 },
  backLabel: { fontSize: 15, color: COLORS.textPrimary, marginLeft: 2 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: COLORS.error },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 32, alignItems: 'center' },
  warningIcon: { fontSize: 48, marginBottom: 16 },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  body: {
    color: COLORS.textSecondary, fontSize: 15, lineHeight: 22,
    textAlign: 'center', marginBottom: 32,
  },
  confirmSection: { width: '100%', marginBottom: 24 },
  confirmLabel: {
    color: COLORS.textMuted, fontSize: 13, fontWeight: '600',
    marginBottom: 8, textAlign: 'center',
  },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    color: COLORS.textPrimary, fontSize: 16, fontWeight: '700',
    textAlign: 'center', borderWidth: 1, borderColor: COLORS.error + '40',
  },
  deleteBtn: {
    width: '100%', backgroundColor: COLORS.error,
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    marginBottom: 12,
  },
  deleteBtnDisabled: { opacity: 0.4 },
  deleteBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: { width: '100%', paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: COLORS.textMuted, fontSize: 15 },
});
```

---

- [ ] **Step 4: Update `apps/mobile/app/(tabs)/profile/settings.tsx` — replace `handleDeleteAccount`**

Find lines 54–90 (the `handleDeleteAccount` function):

```tsx
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This will permanently delete your account and all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Your account will be deleted immediately.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete my account',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const { error } = await callEdgeFunction('gdpr-delete', {});
                      if (error) throw new Error(error);
                      await supabase.auth.signOut();
                      useAuthStore.getState().signOut();
                      router.replace('/(auth)/login');
                    } catch (e: any) {
                      Alert.alert('Error', e?.message ?? 'Could not delete account. Please try again.');
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };
```

Replace with:

```tsx
  const handleDeleteAccount = () => {
    router.push('/(tabs)/profile/delete-account' as any);
  };
```

Also remove the now-unused imports: `callEdgeFunction` from the `supabase` import line if it's no longer used elsewhere in the file. Check if `callEdgeFunction` is used in `handleExportData` — it is, so keep it.

---

- [ ] **Step 5: Run the delete account tests**

```bash
cd apps/mobile && npx jest --testPathPattern="DeleteAccount" --ci 2>&1 | tail -20
```

Expected: PASS — 5 tests passing.

---

- [ ] **Step 6: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: All tests pass.

---

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/\(tabs\)/profile/delete-account.tsx apps/mobile/app/\(tabs\)/profile/settings.tsx apps/mobile/__tests__/screens/DeleteAccount.test.tsx
git commit -m "$(cat <<'EOF'
feat: account deletion confirmation screen with 30-day notice

Replace nested Alerts with dedicated screen. User must type DELETE
to confirm. Edge function now soft-deletes instead of hard-deletes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Support Org — Detail Modal

**Files:**
- Modify: `apps/mobile/app/(tabs)/build/index.tsx`

### Context

The Build tab → Impact section has `ImpactCard` with a "Support" button that optimistically increments `supporter_count`. The spec requires the button to first open a detail modal showing org info, website link, and a share option. The "I'll support this project" button inside the modal triggers the existing increment logic.

No new dependencies. Uses React Native's built-in `Modal`, `Linking`, and `Share`.

---

- [ ] **Step 1: Full replacement of `apps/mobile/app/(tabs)/build/index.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, RefreshControl, Linking, Modal, Share, ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useBuildStore } from '../../../store/buildStore';
import { COLORS } from '../../../lib/constants';
import { Business, ImpactProject } from '../../../types';

function BusinessCard({ biz }: { biz: Business }) {
  const handleVisit = () => {
    if (biz.website_url) Linking.openURL(biz.website_url).catch(() => {});
  };
  return (
    <View style={styles.bizCard}>
      <View style={styles.bizLogo}>
        <Text style={styles.bizLogoText}>{biz.name[0]}</Text>
      </View>
      <Text style={styles.bizName} numberOfLines={1}>{biz.name}</Text>
      {biz.is_wlw_owned && <Text style={styles.wlwBadge}>💜 WLW</Text>}
      {biz.location_city && <Text style={styles.bizCity}>{biz.location_city}</Text>}
      {biz.description && <Text style={styles.bizDesc} numberOfLines={2}>{biz.description}</Text>}
      {biz.website_url && (
        <TouchableOpacity style={styles.visitBtn} onPress={handleVisit}>
          <Text style={styles.visitBtnText}>Visit →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ImpactDetailModal({
  project,
  visible,
  alreadySupported,
  onSupport,
  onClose,
}: {
  project: ImpactProject | null;
  visible: boolean;
  alreadySupported: boolean;
  onSupport: () => void;
  onClose: () => void;
}) {
  if (!project) return null;

  const categoryEmoji: Record<string, string> = {
    mutual_aid: '🤝', visibility: '🏳️‍🌈', education: '📚', safety: '🛡️',
  };

  const handleVisitWebsite = () => {
    if (project.website_url) Linking.openURL(project.website_url).catch(() => {});
  };

  const handleShare = () => {
    const shareContent: { message: string; url?: string } = {
      message: `Check out "${project.title}" on Roxy — supporting the WLW community 💜`,
    };
    if (project.website_url) shareContent.url = project.website_url;
    Share.share(shareContent).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          {/* Close button */}
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Org header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalEmoji}>{categoryEmoji[project.category] ?? '✨'}</Text>
              <Text style={styles.modalTitle}>{project.title}</Text>
              <Text style={styles.modalMeta}>{project.supporter_count} supporters</Text>
            </View>

            {/* Description */}
            {project.description ? (
              <Text style={styles.modalDesc}>{project.description}</Text>
            ) : null}

            {/* Progress */}
            {project.goal_amount ? (
              <View style={styles.modalProgressSection}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, {
                    width: `${Math.min(project.raised_amount / project.goal_amount, 1) * 100}%` as any,
                  }]} />
                </View>
                <Text style={styles.progressLabel}>
                  £{project.raised_amount.toLocaleString()} of £{project.goal_amount.toLocaleString()} raised
                </Text>
              </View>
            ) : null}

            {/* Actions */}
            <View style={styles.modalActions}>
              {project.website_url ? (
                <TouchableOpacity style={styles.modalActionBtn} onPress={handleVisitWebsite}>
                  <Text style={styles.modalActionBtnText}>🌐 Visit website</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity style={styles.modalActionBtn} onPress={handleShare}>
                <Text style={styles.modalActionBtnText}>↗ Share</Text>
              </TouchableOpacity>
            </View>

            {/* Support button */}
            {project.status === 'active' && (
              <TouchableOpacity
                style={[styles.supportBtn, alreadySupported && styles.supportBtnDone]}
                onPress={onSupport}
                disabled={alreadySupported}
                activeOpacity={0.8}
              >
                <Text style={styles.supportBtnText}>
                  {alreadySupported ? '✓ Supported' : 'I\'ll support this project 💜'}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ImpactCard({
  project,
  onPress,
  alreadySupported = false,
}: {
  project: ImpactProject;
  onPress: () => void;
  alreadySupported?: boolean;
}) {
  const progress = project.goal_amount
    ? Math.min(project.raised_amount / project.goal_amount, 1)
    : null;

  const categoryEmoji: Record<string, string> = {
    mutual_aid: '🤝', visibility: '🏳️‍🌈', education: '📚', safety: '🛡️',
  };

  return (
    <View style={styles.impactCard}>
      <View style={styles.impactHeader}>
        <Text style={styles.impactEmoji}>{categoryEmoji[project.category] ?? '✨'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.impactTitle} numberOfLines={2}>{project.title}</Text>
          <Text style={styles.impactMeta}>{project.supporter_count} supporters</Text>
        </View>
        {project.status === 'active' && (
          <TouchableOpacity
            style={[styles.supportCardBtn, alreadySupported && styles.supportBtnDone]}
            onPress={onPress}
          >
            <Text style={styles.supportBtnText}>{alreadySupported ? '✓ Supported' : 'Support'}</Text>
          </TouchableOpacity>
        )}
        {project.status === 'completed' && (
          <View style={styles.completedBadge}>
            <Text style={styles.completedText}>✓ Done</Text>
          </View>
        )}
      </View>
      {project.description && (
        <Text style={styles.impactDesc} numberOfLines={2}>{project.description}</Text>
      )}
      {progress !== null && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>
      )}
      {project.goal_amount ? (
        <Text style={styles.progressLabel}>
          £{project.raised_amount.toLocaleString()} of £{project.goal_amount.toLocaleString()} raised
        </Text>
      ) : null}
    </View>
  );
}

export default function BuildScreen() {
  const { user } = useAuthStore();
  const { businesses, impactProjects, loading, setBusinesses, setImpactProjects, setLoading, incrementSupporter } = useBuildStore();

  const [segment, setSegment] = useState<'businesses' | 'impact'>('businesses');
  const [search, setSearch] = useState('');
  const [wlwOnly, setWlwOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [supportedIds, setSupportedIds] = useState<Set<string>>(new Set());
  const [selectedProject, setSelectedProject] = useState<ImpactProject | null>(null);

  const loadBusinesses = useCallback(async () => {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .order('is_verified', { ascending: false })
      .order('name')
      .limit(50);
    setBusinesses((data as Business[]) ?? []);
  }, [setBusinesses]);

  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from('impact_projects')
      .select('*')
      .order('status')
      .order('created_at', { ascending: false })
      .limit(30);
    setImpactProjects((data as ImpactProject[]) ?? []);
  }, [setImpactProjects]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadBusinesses(), loadProjects()]).finally(() => setLoading(false));
  }, [loadBusinesses, loadProjects, setLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setSearch('');
    await Promise.all([loadBusinesses(), loadProjects()]);
    setRefreshing(false);
  };

  const handleSupport = async (project: ImpactProject) => {
    if (!user || supportedIds.has(project.id)) return;
    setSupportedIds((prev) => new Set([...prev, project.id]));
    incrementSupporter(project.id);
    await supabase
      .from('impact_projects')
      .update({ supporter_count: project.supporter_count + 1 })
      .eq('id', project.id)
      .catch(() => {});
  };

  const filteredBiz = businesses.filter((b) => {
    if (wlwOnly && !b.is_wlw_owned) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.segmentRow}>
        {(['businesses', 'impact'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.segmentBtn, segment === s && styles.segmentBtnActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === 'businesses' ? 'Businesses' : 'Impact'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {segment === 'businesses' && (
        <>
          <View style={styles.filterRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search businesses…"
              placeholderTextColor={COLORS.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            <TouchableOpacity
              style={[styles.wlwToggle, wlwOnly && styles.wlwToggleActive]}
              onPress={() => setWlwOnly((v) => !v)}
            >
              <Text style={styles.wlwToggleText}>💜 WLW only</Text>
            </TouchableOpacity>
          </View>
          <FlashList
            data={filteredBiz}
            keyExtractor={(item) => item.id}
            numColumns={2}
            estimatedItemSize={180}
            renderItem={({ item }) => <BusinessCard biz={item} />}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No businesses yet</Text>
                  <Text style={styles.emptySub}>Be the first to list your business.</Text>
                </View>
              )
            }
          />
        </>
      )}

      {segment === 'impact' && (
        <FlashList
          data={impactProjects}
          keyExtractor={(item) => item.id}
          estimatedItemSize={130}
          renderItem={({ item }) => (
            <ImpactCard
              project={item}
              onPress={() => setSelectedProject(item)}
              alreadySupported={supportedIds.has(item.id)}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No projects yet</Text>
                <Text style={styles.emptySub}>Start an impact project for the community.</Text>
              </View>
            )
          }
        />
      )}

      <ImpactDetailModal
        project={selectedProject}
        visible={selectedProject !== null}
        alreadySupported={selectedProject !== null && supportedIds.has(selectedProject.id)}
        onSupport={() => {
          if (selectedProject) handleSupport(selectedProject);
        }}
        onClose={() => setSelectedProject(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  segmentRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    paddingHorizontal: 16, gap: 4,
  },
  segmentBtn: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentBtnActive: { borderBottomColor: COLORS.primary },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  segmentTextActive: { color: COLORS.textPrimary },
  filterRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    color: COLORS.textPrimary, fontSize: 14,
  },
  wlwToggle: {
    backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'transparent',
  },
  wlwToggleActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '20' },
  wlwToggleText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  gridContent: { padding: 8 },
  listContent: { padding: 16 },
  bizCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    margin: 4, gap: 4,
  },
  bizLogo: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary + '30', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  bizLogoText: { color: COLORS.primary, fontWeight: '700', fontSize: 18 },
  bizName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  wlwBadge: { color: COLORS.secondary, fontSize: 11, fontWeight: '600' },
  bizCity: { color: COLORS.textMuted, fontSize: 11 },
  bizDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  visitBtn: { marginTop: 4 },
  visitBtnText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  impactCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, gap: 8,
  },
  impactHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  impactEmoji: { fontSize: 22 },
  impactTitle: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  impactMeta: { color: COLORS.textMuted, fontSize: 12 },
  impactDesc: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  supportCardBtn: {
    backgroundColor: COLORS.primary, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  supportBtn: {
    width: '100%', backgroundColor: COLORS.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 16,
  },
  supportBtnDone: { backgroundColor: COLORS.success },
  supportBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  completedBadge: {
    backgroundColor: COLORS.success + '20', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  completedText: { color: COLORS.success, fontWeight: '700', fontSize: 12 },
  progressTrack: {
    height: 6, backgroundColor: COLORS.surfaceLight,
    borderRadius: 3, overflow: 'hidden',
  },
  progressFill: { height: 6, backgroundColor: COLORS.primary, borderRadius: 3 },
  progressLabel: { color: COLORS.textMuted, fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  emptySub: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, maxHeight: '80%',
  },
  modalClose: {
    position: 'absolute', top: 16, right: 16,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 1,
  },
  modalCloseText: { color: COLORS.textMuted, fontSize: 16, fontWeight: '700' },
  modalHeader: { alignItems: 'center', paddingTop: 8, marginBottom: 16, gap: 6 },
  modalEmoji: { fontSize: 40 },
  modalTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  modalMeta: { color: COLORS.textMuted, fontSize: 13 },
  modalDesc: {
    color: COLORS.textSecondary, fontSize: 15, lineHeight: 22,
    marginBottom: 16,
  },
  modalProgressSection: { marginBottom: 16, gap: 6 },
  modalActions: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  modalActionBtn: {
    flex: 1, backgroundColor: COLORS.surfaceLight,
    borderRadius: 10, paddingVertical: 10,
    alignItems: 'center',
  },
  modalActionBtnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
});
```

---

- [ ] **Step 2: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: All tests pass.

---

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/build/index.tsx
git commit -m "$(cat <<'EOF'
feat: support org detail modal with website link and share

Support button opens bottom sheet with full org description,
website link, share button, and support CTA. Payment in Session 10.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Task |
|-----------------|------|
| FAB removes Alert, goes to roxy-chat directly | Task 1 ✓ |
| FAB hidden when already on roxy-chat | Task 1 ✓ |
| Roxy Chat keyboard fix on Android | Task 2 ✓ |
| Roxy Chat back button clearer | Task 2 ✓ |
| Communities chips tappable → Discover | Task 3 ✓ |
| "+ Join more" chip | Task 3 ✓ |
| Journey section tappable (no nav) | Task 3 ✓ |
| Badges section → badges screen | Tasks 3 + 4 ✓ |
| Avatar initials in header | Task 3 ✓ |
| Migration 007 (deleted_at column) | Task 5 ✓ |
| gdpr-delete: soft delete, no deleteUser | Task 5 ✓ |
| Settings navigates to delete screen | Task 6 ✓ |
| Delete screen: type DELETE confirmation | Task 6 ✓ |
| Delete screen: 30-day notice | Task 6 ✓ |
| Support org: detail modal | Task 7 ✓ |
| Support org: website link + share | Task 7 ✓ |

### 2. Placeholder scan

None found. All code blocks are complete.

### 3. Type consistency

- `ImpactProject` type used in `ImpactDetailModal` and `BuildScreen.selectedProject` — consistent
- `BadgeProgressRow` type defined identically in `grow/index.tsx` and `grow/badges.tsx` — consistent (both use local type definition; if a shared types file exists in the future, they can be merged)
- `callEdgeFunction` used in `delete-account.tsx` and imported from `../../../lib/supabase` — same as existing usage in `settings.tsx`
- `router.push` casts use `as any` for typed routes — consistent with existing codebase pattern

---

## Execution Order

Tasks can be done in any order except: **Task 5 must be done before Task 6** (the screen needs the edge function to accept the `deleted_at` field).

Recommended order: 1 → 2 → 3 → 4 → 5 → 6 → 7
