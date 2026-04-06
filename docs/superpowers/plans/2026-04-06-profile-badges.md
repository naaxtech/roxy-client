# Profile & Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken profile tab with a proper view card, add Discord-style earned badge icons beneath the avatar, and add an avatar picker (upload photo OR cute preset emoji avatar).

**Architecture:** A shared `ProfileCard` component drives both own-profile and other-user-profile views controlled by an `isOwn` flag. Avatar type (photo vs preset emoji) is encoded in `avatar_url` with an `avatar://🐱` prefix for presets. Badges are fetched from `user_badge_progress JOIN badges` and rendered as emoji icons with tap-to-tooltip behaviour.

**Tech Stack:** Expo 51, React Native 0.74, TypeScript strict, Zustand (`profileStore`), Supabase, `expo-image-picker`, `@expo/vector-icons` (Ionicons), Jest + `@testing-library/react-native`

---

## File Structure

**Create:**
- `apps/mobile/lib/avatars.ts` — preset avatar data + helpers
- `apps/mobile/components/profile/BadgeRow.tsx` — badge emoji row with tooltip
- `apps/mobile/components/profile/AvatarPickerSheet.tsx` — bottom sheet: upload vs preset
- `apps/mobile/components/profile/ProfileCard.tsx` — shared read-only profile view
- `apps/mobile/app/(tabs)/profile/edit.tsx` — edit form (bio, pronouns, identity, avatar)
- `apps/mobile/app/(tabs)/profile/[userId].tsx` — other user public profile
- `apps/mobile/__tests__/components/BadgeRow.test.tsx`
- `apps/mobile/__tests__/components/ProfileCard.test.tsx`

**Modify:**
- `apps/mobile/app/(tabs)/profile/index.tsx` — replace edit form with ProfileCard view
- `apps/mobile/app/(tabs)/grow/people.tsx` — split friend row into name/avatar (→ profile) + Message button (→ DM)

---

### Task 1: Avatar helpers lib

**Files:**
- Create: `apps/mobile/lib/avatars.ts`

- [ ] **Step 1: Write the file**

```ts
// apps/mobile/lib/avatars.ts

export const PRESET_AVATARS = [
  '🐱', '🦊', '🐸', '🌸', '🦋', '🌙',
  '🌈', '💫', '🐧', '🍓', '🌻', '🐝',
];

// Paired background tints for each preset (same order)
export const PRESET_COLORS = [
  '#7C3AED', '#EC4899', '#10B981', '#F59E0B',
  '#3B82F6', '#EF4444', '#8B5CF6', '#14B8A6',
  '#F97316', '#84CC16', '#6366F1', '#A855F7',
];

export function isPresetAvatar(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith('avatar://');
}

export function presetEmoji(url: string): string {
  return url.replace('avatar://', '');
}

export function presetColor(url: string): string {
  const emoji = presetEmoji(url);
  const idx = PRESET_AVATARS.indexOf(emoji);
  return idx >= 0 ? PRESET_COLORS[idx] + '50' : '#7C3AED50';
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/lib/avatars.ts
git commit -m "feat: avatar helpers lib (preset emoji + color)"
```

---

### Task 2: BadgeRow component + tests

**Files:**
- Create: `apps/mobile/components/profile/BadgeRow.tsx`
- Create: `apps/mobile/__tests__/components/BadgeRow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/mobile/__tests__/components/BadgeRow.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BadgeRow } from '../../components/profile/BadgeRow';
import type { UserBadgeProgress, Badge } from '../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

function makeBadge(id: string, emoji: string, earned: boolean): EarnedBadge {
  return {
    user_id: 'u1',
    badge_id: id,
    current_value: 1,
    earned_at: earned ? '2026-01-01T00:00:00Z' : null,
    badges: {
      id,
      name: `Badge ${id}`,
      description: `Desc ${id}`,
      emoji,
      category: 'milestone',
      points_value: 10,
      requirement_type: 'connections',
      requirement_threshold: 1,
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

describe('BadgeRow', () => {
  it('renders nothing when no earned badges', () => {
    const { toJSON } = render(<BadgeRow badges={[makeBadge('1', '🏅', false)]} />);
    expect(toJSON()).toBeNull();
  });

  it('renders only earned badges', () => {
    const { getByText, queryByText } = render(
      <BadgeRow badges={[makeBadge('1', '💜', true), makeBadge('2', '⚡', false)]} />
    );
    expect(getByText('💜')).toBeTruthy();
    expect(queryByText('⚡')).toBeNull();
  });

  it('shows +N overflow when more than 5 earned badges', () => {
    const badges = Array.from({ length: 7 }, (_, i) =>
      makeBadge(String(i), '🏅', true)
    );
    const { getByText } = render(<BadgeRow badges={badges} />);
    expect(getByText('+2')).toBeTruthy();
  });

  it('shows tooltip name+description on tap', () => {
    const { getByText, queryByText } = render(
      <BadgeRow badges={[makeBadge('1', '💜', true)]} />
    );
    expect(queryByText('Badge 1')).toBeNull();
    fireEvent.press(getByText('💜'));
    expect(getByText('Badge 1')).toBeTruthy();
    expect(getByText('Desc 1')).toBeTruthy();
  });

  it('dismisses tooltip when same badge tapped again', () => {
    const { getByText, queryByText } = render(
      <BadgeRow badges={[makeBadge('1', '💜', true)]} />
    );
    fireEvent.press(getByText('💜'));
    expect(getByText('Badge 1')).toBeTruthy();
    fireEvent.press(getByText('💜'));
    expect(queryByText('Badge 1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (BadgeRow not found)**

```bash
cd apps/mobile && npx jest __tests__/components/BadgeRow.test.tsx --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../../components/profile/BadgeRow'`

- [ ] **Step 3: Create the component**

First ensure the directory exists:
```bash
mkdir -p apps/mobile/components/profile
```

```tsx
// apps/mobile/components/profile/BadgeRow.tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';
import type { UserBadgeProgress, Badge } from '../../types';

export type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

const MAX_VISIBLE = 5;

interface BadgeRowProps {
  badges: EarnedBadge[];
}

export function BadgeRow({ badges }: BadgeRowProps) {
  const [tooltipId, setTooltipId] = useState<string | null>(null);

  const earned = badges.filter((b) => b.earned_at !== null);
  const visible = earned.slice(0, MAX_VISIBLE);
  const overflow = earned.length - MAX_VISIBLE;
  const tooltipBadge = earned.find((b) => b.badge_id === tooltipId) ?? null;

  if (earned.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {visible.map((b) => (
          <TouchableOpacity
            key={b.badge_id}
            style={styles.badgeBtn}
            onPress={() => setTooltipId(tooltipId === b.badge_id ? null : b.badge_id)}
          >
            <Text style={styles.emoji}>{b.badges?.emoji ?? '🏅'}</Text>
          </TouchableOpacity>
        ))}
        {overflow > 0 && (
          <View style={styles.overflow}>
            <Text style={styles.overflowText}>+{overflow}</Text>
          </View>
        )}
      </View>

      {tooltipBadge && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipName}>{tooltipBadge.badges?.name}</Text>
          <Text style={styles.tooltipDesc}>{tooltipBadge.badges?.description}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', marginTop: 6 },
  row: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  badgeBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.surfaceLight,
  },
  emoji: { fontSize: 16 },
  overflow: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.surfaceLight,
  },
  overflowText: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700' },
  tooltip: {
    marginTop: 6, paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.surface, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.surfaceLight,
    maxWidth: 220, alignItems: 'center',
  },
  tooltipName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 12 },
  tooltipDesc: { color: COLORS.textMuted, fontSize: 11, marginTop: 2, textAlign: 'center' },
});
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/mobile && npx jest __tests__/components/BadgeRow.test.tsx --no-coverage 2>&1 | tail -10
```

Expected: `5 passed, 5 total`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/profile/BadgeRow.tsx apps/mobile/__tests__/components/BadgeRow.test.tsx
git commit -m "feat: BadgeRow — earned badge emoji row with tap tooltip"
```

---

### Task 3: AvatarPickerSheet component

**Files:**
- Create: `apps/mobile/components/profile/AvatarPickerSheet.tsx`

No test needed — this is a pure UI interaction component wrapping ImagePicker (already covered by the system).

- [ ] **Step 1: Create the component**

```tsx
// apps/mobile/components/profile/AvatarPickerSheet.tsx
import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { COLORS } from '../../lib/constants';
import { PRESET_AVATARS, PRESET_COLORS } from '../../lib/avatars';

type Tab = 'photo' | 'avatar';

interface AvatarPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelectPreset: (avatarUrl: string) => void;
  onUploadPhoto: () => void;
  uploading: boolean;
}

export function AvatarPickerSheet({
  visible, onClose, onSelectPreset, onUploadPhoto, uploading,
}: AvatarPickerSheetProps) {
  const [tab, setTab] = useState<Tab>('photo');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.tabs}>
          {(['photo', 'avatar'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'photo' ? 'Upload Photo' : 'Pick Avatar'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'photo' ? (
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={() => { onUploadPhoto(); onClose(); }}
            disabled={uploading}
          >
            {uploading
              ? <ActivityIndicator color={COLORS.roxy} />
              : <Text style={styles.uploadBtnText}>Choose from Library</Text>
            }
          </TouchableOpacity>
        ) : (
          <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {PRESET_AVATARS.map((emoji, i) => (
              <TouchableOpacity
                key={emoji}
                style={[styles.avatarOption, { backgroundColor: PRESET_COLORS[i] + '30', borderColor: PRESET_COLORS[i] }]}
                onPress={() => { onSelectPreset(`avatar://${emoji}`); onClose(); }}
              >
                <Text style={styles.avatarEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 40, paddingTop: 12, maxHeight: '60%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: COLORS.textMuted + '60',
    alignSelf: 'center', marginBottom: 16,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    marginHorizontal: 20, marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.roxy },
  tabText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: COLORS.roxy },
  uploadBtn: {
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: COLORS.surface, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  uploadBtnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, gap: 12, justifyContent: 'center',
  },
  avatarOption: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  avatarEmoji: { fontSize: 30 },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/components/profile/AvatarPickerSheet.tsx
git commit -m "feat: AvatarPickerSheet — upload photo or pick preset emoji avatar"
```

---

### Task 4: ProfileCard component + tests

**Files:**
- Create: `apps/mobile/components/profile/ProfileCard.tsx`
- Create: `apps/mobile/__tests__/components/ProfileCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/mobile/__tests__/components/ProfileCard.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ProfileCard } from '../../components/profile/ProfileCard';
import type { Profile } from '../../types';

const baseProfile: Profile = {
  id: 'u1',
  username: 'testuser',
  display_name: 'Test User',
  bio: 'Hello world',
  avatar_url: null,
  pronouns: ['she/her'],
  identity_labels: ['lesbian'],
  is_dating_mode: false,
  dating_looking_for: [],
  age_min_pref: 18,
  age_max_pref: 35,
  location_city: null,
  location_country: null,
  is_verified: false,
  is_active: true,
  last_seen_at: '2026-01-01T00:00:00Z',
  gamification_points: 125,
  badge_ids: [],
  push_token: null,
  notification_preferences: {},
  is_ghost: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ProfileCard', () => {
  it('renders display name and username', () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(getByText('Test User')).toBeTruthy();
    expect(getByText('@testuser')).toBeTruthy();
  });

  it('renders bio when present', () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(getByText('Hello world')).toBeTruthy();
  });

  it('renders pronouns and identity chips', () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(getByText('she/her')).toBeTruthy();
    expect(getByText('lesbian')).toBeTruthy();
  });

  it('shows Edit Profile button when isOwn=true', () => {
    const onEdit = jest.fn();
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={true} onEdit={onEdit} />
    );
    expect(getByText('Edit Profile')).toBeTruthy();
  });

  it('hides Edit Profile button when isOwn=false', () => {
    const { queryByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(queryByText('Edit Profile')).toBeNull();
  });

  it('calls onEdit when Edit Profile is pressed', () => {
    const onEdit = jest.fn();
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={true} onEdit={onEdit} />
    );
    fireEvent.press(getByText('Edit Profile'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('calls onBack when back button is pressed', () => {
    const onBack = jest.fn();
    const { getByTestId } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} onBack={onBack} />
    );
    fireEvent.press(getByTestId('back-btn'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders initials avatar when no avatar_url', () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(getByText('T')).toBeTruthy(); // first letter of 'Test User'
  });

  it('renders preset emoji avatar when avatar_url is avatar://', () => {
    const { getByText } = render(
      <ProfileCard profile={{ ...baseProfile, avatar_url: 'avatar://🐱' }} badges={[]} isOwn={false} />
    );
    expect(getByText('🐱')).toBeTruthy();
  });

  it('shows level and points', () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(getByText('🌸 Bloom · 125 pts')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/mobile && npx jest __tests__/components/ProfileCard.test.tsx --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../../components/profile/ProfileCard'`

- [ ] **Step 3: Create the component**

```tsx
// apps/mobile/components/profile/ProfileCard.tsx
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../lib/constants';
import { isPresetAvatar, presetEmoji, presetColor } from '../../lib/avatars';
import { BadgeRow } from './BadgeRow';
import type { Profile } from '../../types';
import type { EarnedBadge } from './BadgeRow';

function getLevelInfo(points: number): { label: string; emoji: string } {
  if (points >= 500) return { label: 'Radiant', emoji: '✨' };
  if (points >= 100) return { label: 'Bloom', emoji: '🌸' };
  return { label: 'Seedling', emoji: '🌱' };
}

interface ProfileCardProps {
  profile: Profile;
  badges: EarnedBadge[];
  isOwn: boolean;
  onEdit?: () => void;
  onSettings?: () => void;
  onBack?: () => void;
}

export function ProfileCard({ profile, badges, isOwn, onEdit, onSettings, onBack }: ProfileCardProps) {
  const points = profile.gamification_points ?? 0;
  const level = getLevelInfo(points);
  const initials = (profile.display_name ?? '?').charAt(0).toUpperCase();
  const hasPreset = isPresetAvatar(profile.avatar_url);

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* Nav row */}
      <View style={styles.navRow}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.navBtn} testID="back-btn">
            <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
        ) : <View style={styles.navBtn} />}
        <View style={{ flex: 1 }} />
        {isOwn && onSettings && (
          <TouchableOpacity onPress={onSettings} style={styles.navBtn}>
            <Ionicons name="settings-outline" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Avatar + badge row */}
      <View style={styles.avatarSection}>
        {hasPreset ? (
          <View style={[styles.avatarCircle, { backgroundColor: presetColor(profile.avatar_url!) }]}>
            <Text style={styles.avatarEmoji}>{presetEmoji(profile.avatar_url!)}</Text>
          </View>
        ) : profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{initials}</Text>
          </View>
        )}
        <BadgeRow badges={badges} />
      </View>

      {/* Name */}
      <Text style={styles.displayName}>{profile.display_name}</Text>
      <Text style={styles.username}>@{profile.username}</Text>

      {/* Identity + pronouns chips */}
      {([...(profile.pronouns ?? []), ...(profile.identity_labels ?? [])].length > 0) && (
        <View style={styles.chipRow}>
          {[...(profile.pronouns ?? []), ...(profile.identity_labels ?? [])].map((tag) => (
            <View key={tag} style={styles.chip}>
              <Text style={styles.chipText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Bio */}
      {profile.bio ? (
        <View style={styles.bioBox}>
          <Text style={styles.bioText}>{profile.bio}</Text>
        </View>
      ) : isOwn && onEdit ? (
        <TouchableOpacity style={[styles.bioBox, styles.bioPlaceholderBox]} onPress={onEdit}>
          <Text style={styles.bioPlaceholder}>Add a bio…</Text>
        </TouchableOpacity>
      ) : null}

      {/* Level */}
      <View style={styles.levelRow}>
        <Text style={styles.levelText}>{level.emoji} {level.label} · {points} pts</Text>
      </View>

      {/* Edit button */}
      {isOwn && onEdit && (
        <TouchableOpacity style={styles.editBtn} onPress={onEdit}>
          <Text style={styles.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, alignItems: 'center', gap: 12 },

  navRow: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', marginBottom: 4,
  },
  navBtn: { width: 40, height: 40, justifyContent: 'center' },

  avatarSection: { alignItems: 'center', marginTop: 4 },
  avatarCircle: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: COLORS.roxy,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: 90, height: 90, borderRadius: 45 },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarEmoji: { fontSize: 44 },

  displayName: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '700' },
  username: { color: COLORS.textMuted, fontSize: 14, marginTop: -4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  chip: {
    backgroundColor: COLORS.primary + '20', borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  chipText: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },

  bioBox: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 14, width: '100%',
  },
  bioPlaceholderBox: { borderWidth: 1, borderColor: COLORS.textMuted + '40', borderStyle: 'dashed' },
  bioText: { color: COLORS.textPrimary, fontSize: 15, lineHeight: 22 },
  bioPlaceholder: { color: COLORS.textMuted, fontSize: 15, fontStyle: 'italic' },

  levelRow: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  levelText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },

  editBtn: {
    width: '100%', backgroundColor: COLORS.roxy,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    marginTop: 4,
  },
  editBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/mobile && npx jest __tests__/components/ProfileCard.test.tsx --no-coverage 2>&1 | tail -10
```

Expected: `10 passed, 10 total`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/profile/ProfileCard.tsx apps/mobile/__tests__/components/ProfileCard.test.tsx
git commit -m "feat: ProfileCard — shared profile view card with avatar, badges, level"
```

---

### Task 5: Refactor profile/index.tsx → own profile view

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile/index.tsx`

Replace the entire file:

- [ ] **Step 1: Replace profile/index.tsx**

```tsx
// apps/mobile/app/(tabs)/profile/index.tsx
import { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';
import { ProfileCard } from '../../../components/profile/ProfileCard';
import { logError } from '../../../lib/errorLogger';
import type { UserBadgeProgress, Badge } from '../../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const router = useRouter();
  const [badges, setBadges] = useState<EarnedBadge[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_badge_progress')
      .select('*, badges(*)')
      .eq('user_id', user.id)
      .then(({ data }) => { if (data) setBadges(data as EarnedBadge[]); })
      .catch((e) => logError(e, 'profileScreen_fetchBadges'));
  }, [user?.id]);

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ProfileCard
        profile={profile}
        badges={badges}
        isOwn={true}
        onEdit={() => router.push('/(tabs)/profile/edit' as any)}
        onSettings={() => router.push('/(tabs)/profile/settings' as any)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
});
```

- [ ] **Step 2: Run all tests — expect PASS**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/profile/index.tsx
git commit -m "feat: profile tab → ProfileCard view (replaces edit form)"
```

---

### Task 6: Create profile/edit.tsx — edit form with avatar picker + badges

**Files:**
- Create: `apps/mobile/app/(tabs)/profile/edit.tsx`

This is the edit form moved from the old `index.tsx`, enhanced with `AvatarPickerSheet` and a "My Badges" section at the bottom.

- [ ] **Step 1: Create edit.tsx**

```tsx
// apps/mobile/app/(tabs)/profile/edit.tsx
import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Alert, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { supabase } from '../../../lib/supabase';
import { COLORS, PRONOUNS, IDENTITY_LABELS } from '../../../lib/constants';
import { logError } from '../../../lib/errorLogger';
import { isPresetAvatar, presetEmoji, presetColor } from '../../../lib/avatars';
import { AvatarPickerSheet } from '../../../components/profile/AvatarPickerSheet';
import type { UserBadgeProgress, Badge } from '../../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

export default function EditProfileScreen() {
  const { user } = useAuthStore();
  const { profile, updateProfile } = useProfileStore();
  const router = useRouter();

  const [localBio, setLocalBio] = useState(profile?.bio ?? '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);

  useEffect(() => {
    setLocalBio(profile?.bio ?? '');
  }, [profile?.bio]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_badge_progress')
      .select('*, badges(*)')
      .eq('user_id', user.id)
      .then(({ data }) => { if (data) setBadges(data as EarnedBadge[]); })
      .catch((e) => logError(e, 'editProfile_fetchBadges'));
  }, [user?.id]);

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} />
      </SafeAreaView>
    );
  }

  const handleUploadPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setAvatarUploading(true);
    try {
      const uri = result.assets[0].uri;
      const response = await fetch(uri);
      const blob = await response.blob();
      const path = `${user.id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) { Alert.alert('Upload failed', uploadError.message); return; }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateProfile({ avatar_url: data.publicUrl });
    } catch (e: any) {
      logError(e, 'editProfile_uploadPhoto');
      Alert.alert('Upload failed', e?.message ?? 'Unknown error');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSelectPreset = async (avatarUrl: string) => {
    try {
      await updateProfile({ avatar_url: avatarUrl });
    } catch (e: any) {
      logError(e, 'editProfile_selectPreset');
      Alert.alert('Error', 'Could not save avatar');
    }
  };

  const togglePronoun = async (pronoun: string) => {
    const current = profile.pronouns ?? [];
    const updated = current.includes(pronoun)
      ? current.filter((p) => p !== pronoun)
      : [...current, pronoun];
    try { await updateProfile({ pronouns: updated }); }
    catch (e) { logError(e, 'editProfile_togglePronoun'); Alert.alert('Error', 'Could not save pronouns'); }
  };

  const toggleIdentity = async (label: string) => {
    const current = profile.identity_labels ?? [];
    const updated = current.includes(label)
      ? current.filter((l) => l !== label)
      : [...current, label];
    try { await updateProfile({ identity_labels: updated }); }
    catch (e) { logError(e, 'editProfile_toggleIdentity'); Alert.alert('Error', 'Could not save identity labels'); }
  };

  const initials = (profile.display_name ?? '?').charAt(0).toUpperCase();
  const hasPreset = isPresetAvatar(profile.avatar_url);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Avatar tap → picker sheet */}
        <TouchableOpacity
          style={styles.avatarSection}
          onPress={() => setPickerVisible(true)}
          disabled={avatarUploading}
        >
          {avatarUploading ? (
            <View style={styles.avatarCircle}>
              <ActivityIndicator color={COLORS.textPrimary} />
            </View>
          ) : hasPreset ? (
            <View style={[styles.avatarCircle, { backgroundColor: presetColor(profile.avatar_url!) }]}>
              <Text style={styles.avatarEmoji}>{presetEmoji(profile.avatar_url!)}</Text>
            </View>
          ) : profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{initials}</Text>
            </View>
          )}
          <Text style={styles.editPhotoText}>Change Photo</Text>
        </TouchableOpacity>

        {/* Display name (read-only) */}
        <View style={styles.section}>
          <Text style={styles.label}>Display Name</Text>
          <Text style={styles.readOnlyText}>{profile.display_name}</Text>
          <Text style={styles.hint}>Set during onboarding — contact support to change</Text>
        </View>

        {/* Bio */}
        <View style={styles.section}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={styles.bioInput}
            multiline
            placeholder="Add a bio..."
            placeholderTextColor={COLORS.textMuted}
            value={localBio}
            onChangeText={setLocalBio}
            onBlur={async () => {
              try { await updateProfile({ bio: localBio }); }
              catch (e) { logError(e, 'editProfile_saveBio'); Alert.alert('Error', 'Could not save bio'); }
            }}
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Pronouns */}
        <View style={styles.section}>
          <Text style={styles.label}>Pronouns</Text>
          <View style={styles.chipRow}>
            {PRONOUNS.map((pronoun) => {
              const selected = (profile.pronouns ?? []).includes(pronoun);
              return (
                <TouchableOpacity
                  key={pronoun}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => togglePronoun(pronoun)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{pronoun}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Identity */}
        <View style={styles.section}>
          <Text style={styles.label}>Identity</Text>
          <View style={styles.chipRow}>
            {IDENTITY_LABELS.map((lbl) => {
              const selected = (profile.identity_labels ?? []).includes(lbl);
              return (
                <TouchableOpacity
                  key={lbl}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleIdentity(lbl)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* My Badges */}
        <View style={styles.section}>
          <Text style={styles.label}>My Badges</Text>
          {badges.length === 0 ? (
            <Text style={styles.emptyBadges}>Complete actions to earn badges! ✨</Text>
          ) : (
            badges.map((b) => {
              const earned = b.earned_at !== null;
              const progress = b.badges
                ? Math.min(b.current_value / b.badges.requirement_threshold, 1)
                : 0;
              return (
                <View key={b.badge_id} style={[styles.badgeRow, !earned && styles.badgeRowDim]}>
                  <Text style={styles.badgeEmoji}>{b.badges?.emoji ?? '🏅'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.badgeName}>{b.badges?.name}</Text>
                    <Text style={styles.badgeDesc}>{b.badges?.description}</Text>
                    {!earned && (
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
                      </View>
                    )}
                  </View>
                  {earned && <Text style={styles.badgeEarned}>✓</Text>}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <AvatarPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelectPreset={handleSelectPreset}
        onUploadPhoto={handleUploadPhoto}
        uploading={avatarUploading}
      />
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
  backBtn: { width: 40 },
  headerTitle: { flex: 1, textAlign: 'center', color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  scroll: { padding: 16, gap: 14, alignItems: 'center' },

  avatarSection: { alignItems: 'center', gap: 8 },
  avatarCircle: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: COLORS.roxy, alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: 90, height: 90, borderRadius: 45 },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarEmoji: { fontSize: 44 },
  editPhotoText: { color: COLORS.roxy, fontSize: 13, fontWeight: '600' },

  section: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, width: '100%' },
  label: {
    color: COLORS.textMuted, fontSize: 12, fontWeight: '600',
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  readOnlyText: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  hint: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  bioInput: {
    color: COLORS.textPrimary, fontSize: 15,
    minHeight: 72, textAlignVertical: 'top',
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: COLORS.surfaceLight, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: COLORS.textMuted + '60',
  },
  chipSelected: { backgroundColor: COLORS.roxy, borderColor: COLORS.roxy },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '500' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },

  emptyBadges: { color: COLORS.textMuted, fontSize: 13 },
  badgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.surfaceLight,
  },
  badgeRowDim: { opacity: 0.6 },
  badgeEmoji: { fontSize: 24, width: 32 },
  badgeName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 13 },
  badgeDesc: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  badgeEarned: { color: COLORS.success, fontWeight: '700', fontSize: 16 },
  progressTrack: {
    height: 3, backgroundColor: COLORS.surfaceLight,
    borderRadius: 2, overflow: 'hidden', marginTop: 4,
  },
  progressFill: { height: 3, backgroundColor: COLORS.primary, borderRadius: 2 },
});
```

- [ ] **Step 2: Run all tests — expect PASS**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/app/(tabs)/profile/edit.tsx"
git commit -m "feat: profile/edit — edit form with avatar picker and badges progress"
```

---

### Task 7: Create profile/[userId].tsx — other user public profile

**Files:**
- Create: `apps/mobile/app/(tabs)/profile/[userId].tsx`

- [ ] **Step 1: Create the screen**

```tsx
// apps/mobile/app/(tabs)/profile/[userId].tsx
import { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';
import { ProfileCard } from '../../../components/profile/ProfileCard';
import { logError } from '../../../lib/errorLogger';
import type { Profile, UserBadgeProgress, Badge } from '../../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('user_badge_progress').select('*, badges(*)').eq('user_id', userId),
    ])
      .then(([profileRes, badgesRes]) => {
        if (profileRes.error || !profileRes.data) {
          setNotFound(true);
        } else {
          setProfile(profileRes.data as Profile);
          if (badgesRes.data) setBadges(badgesRes.data as EarnedBadge[]);
        }
      })
      .catch((e) => { logError(e, 'userProfile_fetch'); setNotFound(true); })
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.notFound}>Profile not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ProfileCard
        profile={profile}
        badges={badges}
        isOwn={false}
        onBack={() => router.back()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  notFound: { color: COLORS.textMuted, textAlign: 'center', marginTop: 60, fontSize: 16 },
});
```

- [ ] **Step 2: Run all tests — expect PASS**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/app/(tabs)/profile/[userId].tsx"
git commit -m "feat: profile/[userId] — public read-only profile screen"
```

---

### Task 8: Update people.tsx — profile navigation

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/people.tsx`

The current friend row is entirely tappable and opens DM. Split it: tapping name/avatar navigates to the user's profile; a "Message" button opens the DM.

- [ ] **Step 1: Read the current friend row render (lines 128–143 of people.tsx)**

The current renderItem for friends tab:
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

- [ ] **Step 2: Replace the friends renderItem with split navigation**

Change the friends `renderItem` in `people.tsx`:

```tsx
renderItem={({ item }) => (
  <View style={styles.row}>
    <TouchableOpacity
      style={styles.avatarWrap}
      onPress={() => router.push(`/(tabs)/profile/${item.profile.id}` as any)}
    >
      <AvatarCircle name={item.profile.display_name} />
      {isOnline(item.profile.last_seen_at) && <View style={styles.onlineDot} />}
    </TouchableOpacity>
    <TouchableOpacity
      style={styles.rowInfo}
      onPress={() => router.push(`/(tabs)/profile/${item.profile.id}` as any)}
    >
      <Text style={styles.rowName}>{item.profile.display_name}</Text>
      <Text style={styles.rowSub}>@{item.profile.username}</Text>
    </TouchableOpacity>
    <View style={styles.actionBtns}>
      <TouchableOpacity style={styles.messageBtn} onPress={() => handleFriendTap(item)}>
        <Text style={styles.messageBtnText}>Message</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.mutedBtn} onPress={() => confirmUnfriend(item)}>
        <Text style={styles.mutedBtnText}>Remove</Text>
      </TouchableOpacity>
    </View>
  </View>
)}
```

Also add these styles to the `StyleSheet.create({...})` at the bottom of `people.tsx`:

```ts
messageBtn: {
  backgroundColor: COLORS.roxy, borderRadius: 16,
  paddingHorizontal: 12, paddingVertical: 6,
},
messageBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
```

- [ ] **Step 3: Run all tests — expect PASS**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(tabs)/grow/people.tsx"
git commit -m "feat: people screen — tap avatar/name → profile, separate Message button"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -10
```

Expected: all tests pass (102 existing + 15 new = ~117 total).

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit spec + plan docs**

```bash
cd D:\Nicole\Dev\roxy\roxy-client
git add docs/
git commit -m "docs: profile & badges design spec + implementation plan"
```
