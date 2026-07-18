import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { formatDistanceToNowStrict } from 'date-fns';
import { useAuthStore } from '../../../store/authStore';
import {
  fetchNotifications, markNotificationRead, markAllNotificationsRead, countUnread,
  RoxyNotification,
} from '../../../lib/notifications';
import { useThemeColors } from '../../../hooks/useThemeColors';

const TYPE_EMOJI: Record<RoxyNotification['type'], string> = {
  friend_request: '🌸',
  friend_accept: '💜',
  community_event: '🗓️',
};

export default function NotificationsScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const [items, setItems] = useState<RoxyNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setItems(await fetchNotifications(user.id));
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const unread = countUnread(items);

  const handleOpen = (n: RoxyNotification) => {
    if (n.read_at === null) {
      void markNotificationRead(n.id);
      setItems((prev) => prev.map((x) =>
        x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x
      ));
    }
    if (n.link_path) router.push(n.link_path as any);
  };

  const handleMarkAll = () => {
    if (!user) return;
    void markAllNotificationsRead(user.id);
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.read_at === null ? { ...x, read_at: now } : x)));
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { padding: 4 },
    headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', flex: 1 },
    markAll: { color: colors.roxy, fontSize: 13, fontWeight: '700' },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 13,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    rowUnread: { backgroundColor: colors.roxy + '0D' },
    emoji: {
      width: 40, height: 40, borderRadius: 20, fontSize: 18,
      backgroundColor: colors.surface,
      textAlign: 'center', lineHeight: 38, overflow: 'hidden',
    },
    body: { flex: 1, gap: 2 },
    title: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    titleUnread: { color: colors.textPrimary, fontWeight: '700' },
    sub: { color: colors.textMuted, fontSize: 12 },
    time: { color: colors.textMuted, fontSize: 11, flexShrink: 0 },
    dot: {
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: colors.roxy, marginLeft: 4,
    },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    emptyIcon: { fontSize: 44 },
    emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unread > 0 && (
          <TouchableOpacity onPress={handleMarkAll} accessibilityLabel="Mark all read">
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          onRefresh={() => void load()}
          refreshing={loading}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyTitle}>Nothing yet</Text>
              <Text style={styles.emptyText}>
                Friend requests and new community events will land here 💜
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isUnread = item.read_at === null;
            return (
              <TouchableOpacity
                style={[styles.row, isUnread && styles.rowUnread]}
                onPress={() => handleOpen(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.emoji}>{TYPE_EMOJI[item.type] ?? '🔔'}</Text>
                <View style={styles.body}>
                  <Text style={[styles.title, isUnread && styles.titleUnread]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.body ? <Text style={styles.sub} numberOfLines={1}>{item.body}</Text> : null}
                </View>
                <Text style={styles.time}>
                  {formatDistanceToNowStrict(new Date(item.created_at), { addSuffix: false })}
                </Text>
                {isUnread && <View style={styles.dot} />}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
