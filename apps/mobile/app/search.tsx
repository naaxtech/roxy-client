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
import { avatarGradient } from '../lib/avatars';
import { SectionHeader } from '../components/ui/SectionHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useThemeColors } from '../hooks/useThemeColors';

const DEBOUNCE_MS = 300;
const EMPTY_RESULTS: GlobalSearchResult = { communities: [], people: [], events: [], businesses: [] };

export default function GlobalSearchScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState('');
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

  const hasQuery = query.trim().length > 0;
  const hasResults =
    results.communities.length > 0 ||
    results.people.length > 0 ||
    results.events.length > 0 ||
    results.businesses.length > 0;

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { padding: 4 },
    inputWrap: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surface, borderRadius: 20,
      paddingHorizontal: 14, height: 40,
    },
    input: { flex: 1, color: colors.textPrimary, fontSize: 15 },
    clearBtn: { padding: 2 },
    scroll: { flex: 1 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 18, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    iconPlate: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    avatar: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    rowInfo: { flex: 1 },
    rowTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    loadingWrap: { paddingVertical: 24, alignItems: 'center' },
    section: { paddingTop: 14 },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.inputWrap}>
          <Ionicons name="search" size={17} color={colors.textMuted} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search communities, people, events…"
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

      {loading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.roxy} />
        </View>
      )}

      {!loading && !hasQuery && (
        <EmptyState
          emoji="🔍"
          title="Search communities, people, events…"
          body="Find your people, your spaces, and what's happening 💜"
        />
      )}

      {!loading && hasQuery && !hasResults && (
        <EmptyState
          emoji="🌸"
          title="No results"
          body={`Nothing matched "${query.trim()}" — try a different search`}
        />
      )}

      {!loading && hasQuery && hasResults && (
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          {results.communities.length > 0 && (
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

          {results.people.length > 0 && (
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

          {results.events.length > 0 && (
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

          {results.businesses.length > 0 && (
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
