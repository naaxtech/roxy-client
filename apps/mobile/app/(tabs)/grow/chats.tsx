import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { COLORS } from '../../../lib/constants';

type ConvRow = {
  id: string;
  participant_ids: string[];
  last_message_at: string | null;
};

type PartnerProfile = {
  id: string;
  display_name: string;
  username: string;
};

type ChatItem = ConvRow & { partner: PartnerProfile | null };

function formatTime(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMM');
}

export default function ChatsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, participant_ids, last_message_at')
      .contains('participant_ids', [user.id])
      .eq('conversation_type', 'direct')
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (!convs || convs.length === 0) {
      setChats([]);
      setLoading(false);
      return;
    }

    const partnerIds = [...new Set((convs as ConvRow[]).flatMap((c) =>
      c.participant_ids.filter((id) => id !== user.id)
    ))];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, username')
      .in('id', partnerIds);

    const profileMap = new Map((profiles ?? []).map((p: PartnerProfile) => [p.id, p]));

    setChats((convs as ConvRow[]).map((c) => {
      const partnerId = c.participant_ids.find((id) => id !== user.id) ?? null;
      return { ...c, partner: partnerId ? (profileMap.get(partnerId) ?? null) : null };
    }));
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Chats</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          onRefresh={load}
          refreshing={loading}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No chats yet. Connect with friends to start chatting! 💜</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push(`/chat/${item.id}` as any)}
              activeOpacity={0.7}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.partner?.display_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.partner?.display_name ?? 'Unknown'}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  @{item.partner?.username ?? '—'}
                </Text>
              </View>
              <Text style={styles.rowTime}>{formatTime(item.last_message_at)}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { color: COLORS.primary, fontWeight: '700', fontSize: 16 },
  rowContent: { flex: 1 },
  rowName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  rowSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  rowTime: { color: COLORS.textMuted, fontSize: 12, flexShrink: 0 },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 32, paddingTop: 80,
  },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
