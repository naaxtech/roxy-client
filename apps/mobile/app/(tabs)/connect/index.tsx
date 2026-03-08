import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useConnectStore } from '../../../store/connectStore';
import { COLORS } from '../../../lib/constants';
import { Conversation } from '../../../types';

function formatLastMessage(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMM');
}

function ConversationRow({
  item,
  currentUserId,
  unreadCount,
  onPress,
}: {
  item: Conversation;
  currentUserId: string;
  unreadCount: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {item.conversation_type === 'speed_date' ? '⚡' : item.conversation_type === 'sister' ? '💜' : '💬'}
        </Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.conversation_type === 'speed_date' ? 'Speed Date Match' : item.conversation_type === 'sister' ? 'Sister Chat' : 'Direct Message'}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {formatLastMessage(item.last_message_at) || 'Tap to open'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowTime}>{formatLastMessage(item.last_message_at)}</Text>
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ConnectScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();
  const { conversations, setConversations, unreadCounts } = useConnectStore();
  const [loading, setLoading] = useState(true);
  const [datingMode, setDatingMode] = useState(profile?.is_dating_mode ?? false);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .contains('participant_ids', [user.id])
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (data) setConversations(data as Conversation[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const toggleDatingMode = async (val: boolean) => {
    if (!user) return;
    setDatingMode(val);
    await supabase.from('profiles').update({ is_dating_mode: val }).eq('id', user.id);
    if (profile) setProfile({ ...profile, is_dating_mode: val });
  };

  const renderItem = ({ item }: { item: Conversation }) => (
    <ConversationRow
      item={item}
      currentUserId={user?.id ?? ''}
      unreadCount={unreadCounts[item.id] ?? 0}
      onPress={() => router.push(`/(tabs)/connect/chat/${item.id}` as any)}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Connect</Text>
        <View style={styles.headerRight}>
          <Text style={styles.datingLabel}>Dating</Text>
          <Switch
            value={datingMode}
            onValueChange={toggleDatingMode}
            trackColor={{ false: COLORS.surface, true: COLORS.primary }}
            thumbColor={COLORS.textPrimary}
          />
        </View>
      </View>

      {/* Roxy Sister banner — always visible */}
      <TouchableOpacity
        style={styles.sisterBanner}
        onPress={() => router.push('/(tabs)/connect/sister-button' as any)}
        activeOpacity={0.8}
      >
        <Text style={styles.sisterIcon}>💜</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.sisterTitle}>Roxy Sister</Text>
          <Text style={styles.sisterSub}>A safe space when you need support</Text>
        </View>
        <Text style={styles.speedDateArrow}>›</Text>
      </TouchableOpacity>

      {/* Speed Date entry (dating mode only) */}
      {datingMode && (
        <TouchableOpacity
          style={styles.speedDateBanner}
          onPress={() => router.push('/(tabs)/connect/speed-dating' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.speedDateIcon}>⚡</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.speedDateTitle}>Speed Dating</Text>
            <Text style={styles.speedDateSub}>Find your next match in 5 minutes</Text>
          </View>
          <Text style={styles.speedDateArrow}>›</Text>
        </TouchableOpacity>
      )}

      {/* Conversation list */}
      {loading ? (
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      ) : conversations.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyBody}>
            Match with someone in Speed Dating or connect in your communities.
          </Text>
        </View>
      ) : (
        <FlashList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          estimatedItemSize={72}
          onRefresh={loadConversations}
          refreshing={loading}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  datingLabel: { color: COLORS.textSecondary, fontSize: 14 },
  sisterBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.roxy + '20',
    borderBottomWidth: 1, borderBottomColor: COLORS.roxy + '60',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  sisterIcon: { fontSize: 28 },
  sisterTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 },
  sisterSub: { color: COLORS.textSecondary, fontSize: 13 },
  speedDateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.primary + '20',
    borderBottomWidth: 1, borderBottomColor: COLORS.primary + '40',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  speedDateIcon: { fontSize: 28 },
  speedDateTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 },
  speedDateSub: { color: COLORS.textSecondary, fontSize: 13 },
  speedDateArrow: { color: COLORS.textMuted, fontSize: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 20 },
  rowContent: { flex: 1, marginRight: 8 },
  rowName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  rowSub: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowTime: { color: COLORS.textMuted, fontSize: 12 },
  unreadBadge: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2, minWidth: 20, alignItems: 'center',
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
});
