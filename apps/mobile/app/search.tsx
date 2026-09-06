import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { globalSearch, GlobalSearchResult } from '../lib/globalSearch';
import { formatScore } from '../lib/archive';
import { archiveDetailPath } from '../lib/contentNavigation';
import { avatarGradient } from '../lib/avatars';
import { SectionHeader } from '../components/ui/SectionHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useThemeColors } from '../hooks/useThemeColors';
import { TYPE } from '../lib/typography';
import { RADII, inkOn } from '../lib/theme';

type SearchTab = 'all' | 'people' | 'communities' | 'events' | 'shops' | 'archive';
const SEARCH_TABS: { id: SearchTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'People' },
  { id: 'communities', label: 'Communities' },
  { id: 'events', label: 'Events' },
  { id: 'shops', label: 'Shops' },
  { id: 'archive', label: 'Archive' },
];
const TRENDING = ['sapphic cinema', 'WLW London', 'events this week', 'shops'];

const DEBOUNCE_MS = 300;
const EMPTY_RESULTS: GlobalSearchResult = { communities: [], people: [], events: [], businesses: [], archive: [] };

export default function GlobalSearchScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SearchTab>('all');
  const [results, setResults] = useState<GlobalSearchResult>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);

  // Auto-focus the input the moment this screen mounts.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      globalSearch(trimmed)
        .then((data) => {
          // Discard stale responses: a newer request may have already
          // dispatched (and possibly resolved) while this one was in flight.
          if (requestIdRef.current === requestId) setResults(data);
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const show = (kind: Exclude<SearchTab, 'all'>) => tab === 'all' || tab === kind;
  const hasQuery = query.trim().length > 0;
  const hasResults =
    (show('communities') && results.communities.length > 0) ||
    (show('people') && results.people.length > 0) ||
    (show('events') && results.events.length > 0) ||
    (show('shops') && results.businesses.length > 0) ||
    (show('archive') && results.archive.length > 0);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, gap: 9,
      backgroundColor: colors.backgroundAlt, borderBottomWidth: 1, borderBottomColor: colors.line,
    },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    backBtn: {
      width: 32, height: 32, borderRadius: RADII.pill,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
      alignItems: 'center', justifyContent: 'center',
    },
    inputWrap: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surface, borderRadius: 13,
      paddingHorizontal: 13, minHeight: 40,
      borderWidth: 1, borderColor: colors.primary,
    },
    input: { flex: 1, ...TYPE.body, color: colors.textPrimary },
    clearBtn: { padding: 2 },
    tabs: { flexDirection: 'row', gap: 6 },
    tab: {
      borderRadius: RADII.pill, paddingHorizontal: 12, paddingVertical: 6,
      borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    },
    tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
    tabTextOn: { color: inkOn(colors.primary) },
    trendLabel: {
      ...TYPE.micro, color: colors.textMuted, fontWeight: '800',
      letterSpacing: 1.4, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 8,
    },
    trendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 14 },
    trendChip: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
      borderRadius: RADII.pill, paddingHorizontal: 14, paddingVertical: 8,
    },
    trendText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
    scroll: { flex: 1 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 11,
      marginHorizontal: 14, marginBottom: 8,
      paddingHorizontal: 12, paddingVertical: 10,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
      borderRadius: RADII.md,
    },
    iconPlate: {
      width: 40, height: 40, borderRadius: 13,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceLight,
    },
    avatar: {
      width: 40, height: 40, borderRadius: RADII.pill,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: inkOn(colors.secondary), fontWeight: '800', fontSize: 15 },
    rowInfo: { flex: 1 },
    rowTitle: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
    rowSub: { ...TYPE.caption, color: colors.textMuted, marginTop: 1 },
    kind: {
      ...TYPE.micro, color: colors.textMuted, fontWeight: '800', letterSpacing: 0.8,
      borderWidth: 1, borderColor: colors.line, borderRadius: RADII.pill,
      paddingHorizontal: 8, paddingVertical: 3,
    },
    loadingWrap: { paddingVertical: 24, alignItems: 'center' },
    section: { paddingTop: 10 },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.searchRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.inputWrap}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Search communities, people, events, shops…"
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              testID="global-search-input"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                style={styles.clearBtn}
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={17} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {SEARCH_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.tab, on && styles.tabOn]}
                onPress={() => setTab(t.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t.label}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.roxy} />
        </View>
      )}

      {!loading && !hasQuery && (
        <View>
          <Text style={styles.trendLabel}>TRENDING THIS WEEK</Text>
          <View style={styles.trendWrap}>
            {TRENDING.map((term) => (
              <TouchableOpacity
                key={term}
                style={styles.trendChip}
                onPress={() => setQuery(term)}
                accessibilityRole="button"
                accessibilityLabel={`Search ${term}`}
              >
                <Text style={styles.trendText}>{term}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {!loading && hasQuery && !hasResults && (
        <EmptyState
          emoji="✿"
          title={`Nothing for “${query.trim()}” yet.`}
          body="Try sapphic cinema — or start this community yourself."
        />
      )}

      {!loading && hasQuery && hasResults && (
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          {show('communities') && results.communities.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Communities" icon="people" />
              {results.communities.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.row}
                  onPress={() => router.push(`/community/${c.id}` as any)}
                  accessibilityLabel={`Open community ${c.name}`}
                >
                  <View style={styles.iconPlate}>
                    <Ionicons name="people-circle" size={24} color={colors.roxy} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{c.name}</Text>
                    {c.description ? (
                      <Text style={styles.rowSub} numberOfLines={1}>{c.description}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {show('people') && results.people.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="People" icon="person" />
              {results.people.map((p) => {
                const name = p.display_name ?? p.username ?? '?';
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.row}
                    onPress={() => router.push(`/user/${p.id}` as any)}
                    accessibilityLabel={`Open profile ${name}`}
                  >
                    <LinearGradient colors={avatarGradient(name)} style={styles.avatar}>
                      <Text style={styles.avatarText}>{name[0]?.toUpperCase() ?? '?'}</Text>
                    </LinearGradient>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
                      {p.username ? (
                        <Text style={styles.rowSub} numberOfLines={1}>@{p.username}</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {show('events') && results.events.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Events" icon="calendar" />
              {results.events.map((e) => (
                <TouchableOpacity
                  key={e.id}
                  style={styles.row}
                  onPress={() => router.push(`/event/${e.id}` as any)}
                  accessibilityLabel={`Open event ${e.title}`}
                >
                  <View style={styles.iconPlate}>
                    <Ionicons name="calendar" size={20} color={colors.roxy} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{e.title}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {format(new Date(e.starts_at), 'MMM d, h:mm a')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {show('archive') && results.archive.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Archive" icon="film" />
              {results.archive.map((a) => {
                // Through formatScore, always. It owns the >=10-vote gate, and
                // a search row computing its own percentage is exactly how a
                // one-vote entry ends up advertising 100% on the busiest screen
                // in the app.
                const score = formatScore(a.up_count, a.vote_count);
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={styles.row}
                    onPress={() => router.push(archiveDetailPath(a.slug) as any)}
                    accessibilityLabel={`Open ${a.title}, ${score.label}`}
                    testID={`search-archive-${a.slug}`}
                  >
                    <View style={styles.iconPlate}>
                      <Ionicons name="film" size={20} color={colors.roxy} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{a.title}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {[a.media_type.toUpperCase(), a.release_year, score.label]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {show('shops') && results.businesses.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Businesses" icon="briefcase" />
              {results.businesses.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.row}
                  // Was `/(tabs)/build` — every business result dropped her at
                  // the directory index rather than the business she had just
                  // searched for and found.
                  onPress={() => router.push(`/business/${b.id}` as any)}
                  accessibilityLabel={`Open ${b.name}`}
                >
                  <View style={styles.iconPlate}>
                    <Ionicons name="briefcase" size={20} color={colors.roxy} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{b.name}</Text>
                    {b.description ? (
                      <Text style={styles.rowSub} numberOfLines={1}>{b.description}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
