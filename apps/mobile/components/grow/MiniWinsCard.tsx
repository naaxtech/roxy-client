import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { startOfDay, startOfWeek } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';

interface Props {
  userId: string;
}

interface QuestRow {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
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
      key: 'react', icon: 'heart', label: 'React to 3 posts',
      current: Math.min(counts.reactions, 3), target: 3, route: '/(tabs)/discover',
    },
    {
      key: 'join', icon: 'people', label: 'Join 1 community',
      current: Math.min(counts.communityJoins, 1), target: 1, route: '/(tabs)/discover',
    },
    {
      key: 'attend', icon: 'calendar', label: 'Attend 1 event this week',
      current: Math.min(counts.eventsGoing, 1), target: 1, route: '/(tabs)/discover',
    },
  ];

  const s = styles(colors);

  return (
    <View style={s.card}>
      <Text style={s.title}>Mini Wins</Text>
      <Text style={s.subtitle}>Small actions. Big connections.</Text>

      {quests.map((q) => {
        const done = q.current >= q.target;
        return (
          <TouchableOpacity
            key={q.key}
            style={s.row}
            onPress={() => router.push(q.route as any)}
            activeOpacity={0.75}
          >
            <View style={[s.iconCircle, done && s.iconCircleDone]}>
              <Ionicons name={done ? 'checkmark' : q.icon} size={16} color={done ? '#fff' : colors.roxy} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.rowHeader}>
                <Text style={s.rowLabel}>{q.label}</Text>
                <Text style={s.rowFraction}>{q.current} / {q.target}</Text>
              </View>
              <View style={s.track}>
                <View style={[s.fill, { width: `${(q.current / q.target) * 100}%` as any }, done && s.fillDone]} />
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
    backgroundColor: colors.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: colors.primary + '30', gap: 4,
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 11, color: colors.textMuted, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  iconCircle: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.roxy + '20',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  iconCircleDone: { backgroundColor: colors.success },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  rowLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  rowFraction: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceLight, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.roxy },
  fillDone: { backgroundColor: colors.success },
});
