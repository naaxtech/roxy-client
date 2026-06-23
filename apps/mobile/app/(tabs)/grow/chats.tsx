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
import { useConnectStore } from '../../../store/connectStore';
import { Conversation } from '../../../types';
import { useThemeColors } from '../../../hooks/useThemeColors';

type PartnerProfile = { id: string; display_name: string; username: string };

type ChatItem = {
  id: string;
  participant_ids: string[];
  last_message_at: string | null;
  partner: PartnerProfile | null;
  lastMessagePreview: string;
  unreadCount: number;
};

function formatTime(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMM');
}

export default function ChatsScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const { setConversations, unreadCounts, clearUnread } = useConnectStore();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    // 1. Fetch conversations
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, participant_ids, last_message_at, conversation_type, roxy_nudge_count, roxy_wingwoman_count_today, last_roxy_call_date, created_at')
      .contains('participant_ids', [user.id])
      .eq('conversation_type', 'direct')
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (!convs || convs.length === 0) {
      setChats([]);
      setLoading(false);
      return;
    }

    // Warm the connectStore so chat/[id].tsx can resolve partner names from cache
    setConversations(convs as Conversation[]);

    const convIds = (convs as { id: string }[]).map((c) => c.id);

    // 2. Resolve partner display names in one query
    const partnerIds = [...new Set(
      (convs as { participant_ids: string[] }[]).flatMap((c) =>
        c.participant_ids.filter((id) => id !== user.id)
      )
    )];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, username')
      .in('id', partnerIds);

    const profileMap = new Map((profiles ?? []).map((p: PartnerProfile) => [p.id, p]));

    // 3. Fetch last message per conversation (Supabase returns rows DESC by
    //    created_at; first occurrence per conversation_id = most recent)
    const { data: recentMsgs } = await supabase
      .from('messages')
      .select('conversation_id, content, message_type, sender_id')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });

    const lastMsgMap = new Map<string, string>();
    for (const msg of recentMsgs ?? []) {
      if (lastMsgMap.has(msg.conversation_id)) continue;
      if (msg.message_type === 'roxy_suggestion') {
        lastMsgMap.set(msg.conversation_id, '✨ Roxy suggestion');
      } else {
        const isOwn = msg.sender_id === user.id;
        lastMsgMap.set(
          msg.conversation_id,
          isOwn ? `You: ${msg.content ?? ''}` : (msg.content ?? '')
        );
      }
    }

    // 4. Fetch unread counts from DB (messages not yet read, not sent by self)
    const { data: unreadRows } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', convIds)
      .eq('is_read', false)
      .neq('sender_id', user.id);

    const dbUnreadMap: Record<string, number> = {};
    for (const { conversation_id } of unreadRows ?? []) {
      dbUnreadMap[conversation_id] = (dbUnreadMap[conversation_id] ?? 0) + 1;
    }

    // Merge DB counts into connectStore (DB is authoritative on load)
    const { incrementUnread } = useConnectStore.getState();
    for (const [convId, count] of Object.entries(dbUnreadMap)) {
      // Only seed if the store doesn't already have a higher count
      // (could have incremented from Realtime since app started)
      const storeCount = useConnectStore.getState().unreadCounts[convId] ?? 0;
      const delta = count - storeCount;
      for (let i = 0; i < delta; i++) incrementUnread(convId);
    }

    // 5. Build final chat items
    const items: ChatItem[] = (convs as { id: string; participant_ids: string[]; last_message_at: string | null }[]).map((c) => {
      const partnerId = c.participant_ids.find((id) => id !== user.id) ?? null;
      return {
        id: c.id,
        participant_ids: c.participant_ids,
        last_message_at: c.last_message_at,
        partner: partnerId ? (profileMap.get(partnerId) ?? null) : null,
        lastMessagePreview: lastMsgMap.get(c.id) ?? 'No messages yet',
        unreadCount: dbUnreadMap[c.id] ?? 0,
      };
    });

    setChats(items);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Realtime: listen for new incoming messages to update unread counts live
  useEffect(() => {
    if (!user || chats.length === 0) return;

    const convIds = chats.map((c) => c.id);

    const channel = supabase
      .channel('chats-unread-listener')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const msg = payload.new as { conversation_id: string; sender_id: string; content?: string };
          if (!convIds.includes(msg.conversation_id)) return;
          if (msg.sender_id === user.id) return;
          if (useConnectStore.getState().activeConversationId === msg.conversation_id) return;
          useConnectStore.getState().incrementUnread(msg.conversation_id);
          setChats((prev) =>
            prev.map((c) =>
              c.id === msg.conversation_id
                ? { ...c, lastMessagePreview: msg.content ?? '' }
                : c
            )
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, chats.length]);

  const handleOpen = (item: ChatItem) => {
    clearUnread(item.id);
    router.push(`/chat/${item.id}` as any);
  };

  const liveUnread = (id: string) => unreadCounts[id] ?? 0;

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { padding: 4 },
    headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },

    // Rows
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    avatar: {
      width: 46, height: 46, borderRadius: 23,
      backgroundColor: colors.primary + '30',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    avatarUnread: { backgroundColor: colors.primary + '50' },
    avatarText: { color: colors.primary, fontWeight: '700', fontSize: 18 },

    rowContent: { flex: 1, gap: 3 },
    rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowName: { color: colors.textSecondary, fontWeight: '500', fontSize: 15, flex: 1 },
    rowNameUnread: { color: colors.textPrimary, fontWeight: '700' },
    rowTime: { color: colors.textMuted, fontSize: 12, flexShrink: 0, marginLeft: 8 },
    rowTimeUnread: { color: colors.primary, fontWeight: '600' },

    rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowPreview: { color: colors.textMuted, fontSize: 13, flex: 1 },
    rowPreviewUnread: { color: colors.textSecondary, fontWeight: '500' },

    // Unread badge (like WhatsApp green dot)
    badge: {
      backgroundColor: colors.primary,
      borderRadius: 10, minWidth: 20, height: 20,
      alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 5, marginLeft: 8, flexShrink: 0,
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

    // Empty state
    empty: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      padding: 32, paddingTop: 80, gap: 8,
    },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          onRefresh={load}
          refreshing={loading}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyText}>
                Connect with someone in Discover to start chatting 💜
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const unread = liveUnread(item.id);
            const hasUnread = unread > 0;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => handleOpen(item)}
                activeOpacity={0.7}
              >
                {/* Avatar */}
                <View style={[styles.avatar, hasUnread && styles.avatarUnread]}>
                  <Text style={styles.avatarText}>
                    {item.partner?.display_name?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>

                {/* Name + preview */}
                <View style={styles.rowContent}>
                  <View style={styles.rowTop}>
                    <Text
                      style={[styles.rowName, hasUnread && styles.rowNameUnread]}
                      numberOfLines={1}
                    >
                      {item.partner?.display_name ?? 'Unknown'}
                    </Text>
                    <Text style={[styles.rowTime, hasUnread && styles.rowTimeUnread]}>
                      {formatTime(item.last_message_at)}
                    </Text>
                  </View>
                  <View style={styles.rowBottom}>
                    <Text
                      style={[styles.rowPreview, hasUnread && styles.rowPreviewUnread]}
                      numberOfLines={1}
                    >
                      {item.lastMessagePreview}
                    </Text>
                    {hasUnread && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                          {unread > 99 ? '99+' : unread}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

