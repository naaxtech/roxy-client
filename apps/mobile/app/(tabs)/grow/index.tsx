import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { callEdgeFunction } from '../../../lib/supabase';
import { useProfile } from '../../../hooks/useProfile';
import { COLORS } from '../../../lib/constants';

export default function GrowScreen() {
  const { profile } = useProfile();
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    setGreetingLoading(true);
    callEdgeFunction<{ greeting: string }>('roxy-greeting', {})
      .then(({ data }) => {
        setGreeting(data?.greeting ?? null);
      })
      .finally(() => {
        setGreetingLoading(false);
      });
  }, [profile]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
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

        {/* Zone 2 — Communities placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Communities</Text>
          <Text style={styles.emptyState}>Join your first community in Discover →</Text>
        </View>

        {/* Zone 3 — People placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your People</Text>
          <Text style={styles.emptyState}>Add your first connection in Discover →</Text>
        </View>

        {/* Zone 4 — Progress placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Journey</Text>
          <Text style={styles.emptyState}>Earn your first badge by posting in a community →</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 16, gap: 16 },
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8 },
  emptyState: { color: COLORS.textMuted, fontSize: 14 },
});
