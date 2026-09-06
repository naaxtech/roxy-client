import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { startOfDay, startOfWeek } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';

interface Props {
  userId: string;
}

interface QuestRow {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  grad: readonly [string, string];
  label: string;
  current: number;
  target: number;
  route: string;
}

export function MiniWinsCard({ userId }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [counts, setCounts] = useState({ reactions: 0, communityJoins: 0, eventsGoing: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const todayStart = startOfDay(new Date()).toISOString();
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString();

    const [likesRes, joinsRes, eventsRes] = await Promise.all([
      supabase.from('post_likes').select('post_id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('created_at', todayStart),
      supabase.from('community_members').select('community_id', { count: 'exact', head: true })
        .eq('user_id', userId).gte('joined_at', todayStart),
      supabase.from('event_attendees').select('event_id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('status', 'going').gte('rsvp_at', weekStart),
    ]);

    setCounts({
      reactions: likesRes.count ?? 0,
      communityJoins: joinsRes.count ?? 0,
      eventsGoing: eventsRes.count ?? 0,
    });
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles(colors).card, { alignItems: 'center', paddingVertical: 24 }]}>
        <ActivityIndicator color={colors.roxy} />
      </View>
    );
  }

  const quests: QuestRow[] = [
    {
      key: 'react', icon: 'flower', grad: ['#FF2F71', '#E81C8E'], label: 'React to 3 posts',
      current: Math.min(counts.reactions, 3), target: 3, route: '/(tabs)/feed',
    },
    {
      key: 'join', icon: 'people', grad: ['#8E7CF7', '#C86DD7'], label: 'Join 1 community',
      current: Math.min(counts.communityJoins, 1), target: 1, route: '/(tabs)/discover',
    },
    {
      key: 'attend', icon: 'calendar', grad: ['#FF6A2E', '#FF2F71'], label: 'Attend 1 event this week',
      current: Math.min(counts.eventsGoing, 1), target: 1, route: '/(tabs)/discover',
    },
  ];

  const doneCount = quests.filter((q) => q.current >= q.target).length;
  const s = styles(colors);

  return (
    <View style={s.card}>
      <View style={s.header}>
        <LinearGradient colors={['#FF6A2E', '#E81C8E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.headerPlate}>
          <Ionicons name="flash" size={16} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Mini Wins</Text>
          <Text style={s.subtitle}>Small actions. Big connections.</Text>
        </View>
        <View style={[s.countChip, doneCount === quests.length && s.countChipDone]}>
          <Text style={[s.countChipText, doneCount === quests.length && s.countChipTextDone]}>
            {doneCount}/{quests.length} today
          </Text>
        </View>
      </View>

      {quests.map((q) => {
        const done = q.current >= q.target;
        return (
          <TouchableOpacity
            key={q.key}
            style={s.row}
            onPress={() => router.push(q.route as any)}
            activeOpacity={0.75}
          >
            <LinearGradient
              colors={done ? ['#2BB673', '#1E9E62'] : q.grad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.iconPlate}
            >
              <Ionicons name={done ? 'checkmark' : q.icon} size={16} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <View style={s.rowHeader}>
                <Text style={s.rowLabel}>{q.label}</Text>
                <Text style={[s.rowFraction, done && s.rowFractionDone]}>{q.current} / {q.target}</Text>
              </View>
              <View style={s.track}>
                <LinearGradient
                  colors={done ? ['#2BB673', '#1E9E62'] : q.grad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[s.fill, { width: `${Math.max((q.current / q.target) * 100, 4)}%` as any }]}
                />
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = (colors: ReturnType<typeof useThemeColors>) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 14,
    borderWidth: 1, borderColor: colors.primary + '26', gap: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  headerPlate: {
    width: 32, height: 32, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 11, color: colors.textMuted },
  countChip: {
    backgroundColor: colors.roxy + '14',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
  },
  countChipDone: { backgroundColor: '#2BB67322' },
  countChipText: { color: colors.roxy, fontWeight: '800', fontSize: 11 },
  countChipTextDone: { color: '#1E9E62' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  iconPlate: {
    width: 34, height: 34, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  rowLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textPrimary },
  rowFraction: { fontSize: 11, fontWeight: '800', color: colors.textMuted },
  rowFractionDone: { color: '#1E9E62' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceLight, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
