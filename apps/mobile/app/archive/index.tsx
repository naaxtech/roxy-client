import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, ActivityIndicator, StyleSheet, RefreshControl,
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
import { type TypeCounts } from '../../lib/archiveTypes';
import { fetchArchiveTypeCounts } from '../../lib/archive';
import { SortChips } from '../../components/archive/SortChips';
import { PendingBanner } from '../../components/archive/PendingBanner';
import { AccountStatusTag } from '../../components/account/AccountStatusTag';
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
type Props = {
  /** When the Archive is the first tab, Back has nowhere honest to go. */
  asHome?: boolean;
};

export default function ArchiveBrowseScreen({ asHome = false }: Props) {
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
  const refresh = useArchiveStore((s) => s.refresh);
  const loadMore = useArchiveStore((s) => s.loadMore);
  const refreshing = useArchiveStore((s) => s.refreshing) ?? false;
  const loadingMore = useArchiveStore((s) => s.loadingMore) ?? false;
  const takeFlash = useArchiveStore((s) => s.takeFlash);

  const [lockedOpen, setLockedOpen] = useState(false);
  // "Sent to the mods ✿" — left by a composer on its way back (ARC-09).
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    const message = takeFlash?.() ?? null;
    if (!message) return undefined;
    setToast(message);
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [takeFlash]);

  // Counts come from their OWN query, not from `entries`. The list is already
  // narrowed by her search and her type — counting it would make every chip
  // read the size of the current result, so "Movies 12" would drop to "Movies 1"
  // the moment she typed, which is the opposite of what a filter count is for.
  const [typeCounts, setTypeCounts] = useState<TypeCounts | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // One head-count per type, not 500 rows to count client-side (ARC-13).
        const counts = await fetchArchiveTypeCounts();
        if (!cancelled) setTypeCounts(counts);
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

  // Type and sort reload at once; the search waits for a 250 ms pause so a
  // word is one request, not one per letter (ARC-07). The store drops any
  // answer that is not the latest, so a slow "ca" cannot replace "carol".
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      void load();
      return undefined;
    }
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
  }, [load, filters.query]);
  const typeAndSort = useRef(`${filters.mediaType}|${filters.sort}`);
  useEffect(() => {
    const key = `${filters.mediaType}|${filters.sort}`;
    if (typeAndSort.current === key) return;
    typeAndSort.current = key;
    void load();
  }, [load, filters.mediaType, filters.sort]);

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
    searchRow: { width: '100%', paddingHorizontal: 16 },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
      width: '100%', gap: 8, paddingHorizontal: 12,
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.md,
      backgroundColor: colors.surfaceLight,
      borderWidth: 1, borderColor: colors.lineStrong,
    },
    search: {
      flex: 1, ...TYPE.body, color: colors.textPrimary,
      backgroundColor: colors.surfaceLight, paddingVertical: 8,
    },
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
    toast: {
      marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: RADII.md,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary,
    },
    toastText: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700' },
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
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void refresh(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => { void loadMore(); }}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator color={colors.primary} testID="archive-loading-more" style={{ padding: 16 }} />
        ) : null}
        renderItem={({ item }) => (
          <ArchiveRow entry={item} onPress={() => openEntry(item)} testID={`archive-row-${item.slug}`} />
        )}
      />
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        {asHome ? null : (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed' as never))}
            style={s.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="archive-back"
          >
            <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
          </Pressable>
        )}
        <Text style={[s.title, { flex: 1 }]}>The WLW Archive</Text>
        <AccountStatusTag />
      </View>

      <View style={s.searchRow}>
        <View style={s.searchWrap} testID="archive-search-wrap">
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          style={s.search}
          value={filters.query}
          onChangeText={(query) => setFilters({ query })}
          placeholder="Search films, shows, books, comics, music"
          placeholderTextColor={colors.textSecondary}
          testID="archive-search"
          accessibilityLabel="Search the Archive"
          returnKeyType="search"
          onSubmitEditing={() => Analytics.archiveSearch(entries.length)}
        />
        </View>
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

      {toast ? (
        <View style={s.toast} testID="archive-submitted-toast" accessibilityLiveRegion="polite" accessibilityRole="alert">
          <Text style={s.toastText}>{toast}</Text>
        </View>
      ) : null}

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
