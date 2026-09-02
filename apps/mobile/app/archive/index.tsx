import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useArchiveStore } from '../../store/archiveStore';
import { useMembership } from '../../hooks/useMembership';
import { useAuthStore } from '../../store/authStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { Analytics } from '../../lib/analytics';
import { archiveDetailPath } from '../../lib/contentNavigation';
import { ArchiveRow } from '../../components/archive/ArchiveRow';
import { MediaTypeChips } from '../../components/archive/MediaTypeChips';
import { countByType, type TypeCounts } from '../../lib/archiveTypes';
import { fetchArchiveEntries } from '../../lib/archive';
import { SortChips } from '../../components/archive/SortChips';
import { PendingBanner } from '../../components/archive/PendingBanner';
import type { ArchiveEntry } from '../../lib/archive';

/**
 * Browse the WLW Archive.
 *
 * This is the one screen a **pending** member can use, and the reason the
 * feature exists at all: migration 079 is a postmortem about a new signup
 * landing on `vetting_status='pending'`, every RLS helper answering false, and
 * her being locked out of the whole app with no screen explaining why. The
 * banner at the top is that explanation, and it leads with what she CAN do.
 *
 * The empty state asks for a contribution rather than apologising. A search
 * that found nothing is the single best moment to ask — she has just told us
 * exactly what the Archive is missing.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 952–1007 · 2026-09-01
 */
export default function ArchiveBrowseScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const membership = useMembership();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const entries = useArchiveStore((s) => s.entries);
  const loading = useArchiveStore((s) => s.loading);
  const error = useArchiveStore((s) => s.error);
  const filters = useArchiveStore((s) => s.filters);
  const load = useArchiveStore((s) => s.load);
  const setFilters = useArchiveStore((s) => s.setFilters);
  const hydrateMine = useArchiveStore((s) => s.hydrateMine);

  const [lockedOpen, setLockedOpen] = useState(false);

  // Counts come from their OWN query, not from `entries`. The list is already
  // narrowed by her search and her type — counting it would make every chip
  // read the size of the current result, so "Movies 12" would drop to "Movies 1"
  // the moment she typed, which is the opposite of what a filter count is for.
  const [typeCounts, setTypeCounts] = useState<TypeCounts | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await fetchArchiveEntries({ sort: 'newest', limit: 500 });
        if (!cancelled) setTypeCounts(countByType(all));
      } catch {
        // fetchArchiveEntries logs before throwing. A failed count is not a
        // failed screen — the chips simply render without numbers.
        if (!cancelled) setTypeCounts(undefined);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    Analytics.archiveViewed();
  }, []);

  useEffect(() => {
    void load();
  }, [load, filters.query, filters.mediaType, filters.sort]);

  useEffect(() => {
    if (userId) void hydrateMine(userId);
  }, [userId, hydrateMine]);

  const openEntry = useCallback((entry: ArchiveEntry) => {
    Analytics.archiveEntryViewed(entry.slug);
    router.push(archiveDetailPath(entry.slug) as never);
  }, [router]);

  const onSuggest = useCallback(() => {
    // Locked actions explain the unlock. A greyed-out control tells her she is
    // not allowed and nothing else, which is how she decides the app is broken.
    if (!membership.canEdit) { setLockedOpen(true); return; }
    router.push('/archive/new' as never);
  }, [membership.canEdit, router]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
    },
    backBtn: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    title: { ...TYPE.headline, color: colors.textPrimary },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginHorizontal: 16, paddingHorizontal: 12,
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.pill,
      backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line,
    },
    search: { flex: 1, ...TYPE.body, color: colors.textPrimary, paddingVertical: 8 },
    bannerWrap: { paddingHorizontal: 16, paddingTop: 8 },
    list: { padding: 16, gap: 10 },
    state: { padding: 24, gap: 10, alignItems: 'flex-start' },
    stateText: { ...TYPE.body, color: colors.textSecondary },
    action: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    actionText: { ...TYPE.body, color: colors.primaryInk, fontWeight: '700' },
    sheet: {
      margin: 16, padding: 14, gap: 10,
      borderRadius: RADII.md,
      backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line,
    },
  });

  const body = () => {
    if (loading && entries.length === 0) {
      return (
        <View style={s.state} testID="archive-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    if (error && entries.length === 0) {
      return (
        <View style={s.state} testID="archive-error">
          <Text style={s.stateText}>{error}</Text>
          <Pressable
            onPress={() => void load()}
            style={s.action}
            testID="archive-retry"
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.actionText}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    if (entries.length === 0) {
      const searched = filters.query.trim().length > 0;
      return (
        <View style={s.state} testID="archive-empty">
          <Text style={s.stateText}>
            {searched
              ? `Nothing in the Archive matches “${filters.query.trim()}” yet. If you know it belongs here, suggest it as a new entry.`
              : 'The Archive is empty right now. Suggest the first thing that belongs here.'}
          </Text>
          <Pressable
            onPress={onSuggest}
            style={s.action}
            testID="archive-empty-suggest"
            accessibilityRole="button"
            accessibilityLabel="Suggest a new entry"
          >
            <Text style={s.actionText}>
              {membership.canEdit ? 'Suggest an entry →' : '🔒 Suggest an entry'}
            </Text>
          </Pressable>
        </View>
      );
    }

    return (
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={s.list}
        testID="archive-list"
        renderItem={({ item }) => (
          <ArchiveRow entry={item} onPress={() => openEntry(item)} testID={`archive-row-${item.slug}`} />
        )}
      />
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/discover' as never))}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={s.title}>The WLW Archive</Text>
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={s.search}
          value={filters.query}
          onChangeText={(query) => setFilters({ query })}
          placeholder="Search films, shows, books, comics, music"
          placeholderTextColor={colors.textMuted}
          testID="archive-search"
          accessibilityLabel="Search the Archive"
          returnKeyType="search"
          onSubmitEditing={() => Analytics.archiveSearch(entries.length)}
        />
      </View>

      {membership.status === 'pending' ? (
        <View style={s.bannerWrap}>
          <PendingBanner testID="archive-pending-banner" />
        </View>
      ) : null}

      <MediaTypeChips
        value={filters.mediaType}
        onChange={(mediaType) => setFilters({ mediaType })}
        counts={typeCounts}
      />
      <SortChips value={filters.sort} onChange={(sort) => setFilters({ sort })} />

      {body()}

      {lockedOpen ? (
        <View style={s.sheet} testID="archive-locked-sheet">
          <PendingBanner variant="locked" />
          <Pressable
            onPress={() => setLockedOpen(false)}
            style={s.action}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={s.actionText}>Got it</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
