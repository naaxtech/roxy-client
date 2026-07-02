import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, isToday, isYesterday } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useConnectStore } from '../../../store/connectStore';
import { useFriendStore, isOnline } from '../../../store/friendStore';
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

const GRAD_COLORS = [
  ['#FF6A2E', '#E81C8E'],
  ['#8B5CF6', '#E879A6'],
  ['#FF2F71', '#8B5CF6'],
  ['#F472B6', '#FF6A2E'],
  ['#C4476A', '#8B5CF6'],
  ['#FF8A3D', '#FF2F71'],
] as const;

function gradFor(seed: number) {
  return GRAD_COLORS[((seed % GRAD_COLORS.length) + GRAD_COLORS.length) % GRAD_COLORS.length];
}

function nameToSeed(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function formatTime(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMM');
}

export default function MessagesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const { setConversations, unreadCounts, clearUnread } = useConnectStore();
  const { friends } = useFriendStore();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

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

    setConversations(convs as Conversation[]);
    const convIds = (convs as { id: string }[]).map((c) => c.id);

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

    const { incrementUnread } = useConnectStore.getState();
    for (const [convId, count] of Object.entries(dbUnreadMap)) {
      const storeCount = useConnectStore.getState().unreadCounts[convId] ?? 0;
      const delta = count - storeCount;
      for (let i = 0; i < delta; i++) incrementUnread(convId);
    }

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

  useEffect(() => {
    if (!user || chats.length === 0) return;
    const convIds = chats.map((c) => c.id);
    const channel = supabase
      .channel('messages-tab-unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as { conversation_id: string; sender_id: string; content?: string };
        if (!convIds.includes(msg.conversation_id)) return;
        if (msg.sender_id === user.id) return;
        if (useConnectStore.getState().activeConversationId === msg.conversation_id) return;
        useConnectStore.getState().incrementUnread(msg.conversation_id);
        setChats((prev) =>
          prev.map((c) =>
            c.id === msg.conversation_id ? { ...c, lastMessagePreview: msg.content ?? '' } : c
          )
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, chats.length]);

  const handleOpen = (item: ChatItem) => {
    clearUnread(item.id);
    router.push(`/chat/${item.id}` as any);
  };

  const liveUnread = (id: string) => unreadCounts[id] ?? 0;

  const filtered = search
    ? chats.filter((c) => (c.partner?.display_name ?? '').toLowerCase().includes(search.toLowerCase()))
    : chats;

  const isPartnerOnline = (item: ChatItem) => {
    const partnerId = item.participant_ids.find((id) => id !== user?.id);
    const friend = friends.find((f) => f.profile.id === partnerId);
    return friend ? isOnline(friend.profile.last_seen_at ?? null) : false;
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10,
    },
    headerLeft: { flex: 1 },
    title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
    iconBtn: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    search: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surface, borderRadius: 14,
      marginHorizontal: 18, marginBottom: 12,
      paddingHorizontal: 14, paddingVertical: 10,
    },
    searchText: { color: colors.textMuted, fontSize: 14, flex: 1 },
    searchInput: { color: colors.textPrimary, fontSize: 14, flex: 1 },

    // Roxy DM row
    roxyRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 18, paddingVertical: 13,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    roxyAva: {
      width: 48, height: 48, borderRadius: 24,
      alignItems: 'center', justifyContent: 'center',
    },
    roxyBody: { flex: 1, gap: 2 },
    roxyTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    roxyName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    roxyTag: {
      backgroundColor: colors.roxy + '20', borderRadius: 6,
      paddingHorizontal: 6, paddingVertical: 1,
    },
    roxyTagText: { color: colors.roxy, fontSize: 10, fontWeight: '700' },
    roxySub: { color: colors.textMuted, fontSize: 13 },

    // Divider
    divider: {
      paddingHorizontal: 18, paddingVertical: 8,
      color: colors.textMuted, fontSize: 11, fontWeight: '700',
      letterSpacing: 0.8, textTransform: 'uppercase',
    },

    // DM rows
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 18, paddingVertical: 13,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    avaWrap: { position: 'relative' },
    ava: {
      width: 48, height: 48, borderRadius: 24,
      alignItems: 'center', justifyContent: 'center',
    },
    avaText: { color: '#fff', fontWeight: '700', fontSize: 18 },
    onlineDot: {
      position: 'absolute', bottom: 1, right: 1,
      width: 12, height: 12, borderRadius: 6,
      backgroundColor: '#22C55E',
      borderWidth: 2, borderColor: colors.background,
    },
    content: { flex: 1, gap: 3 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    name: { color: colors.textSecondary, fontWeight: '500', fontSize: 15, flex: 1 },
    nameUnread: { color: colors.textPrimary, fontWeight: '700' },
    time: { color: colors.textMuted, fontSize: 12, flexShrink: 0, marginLeft: 8 },
    timeUnread: { color: colors.primary, fontWeight: '600' },
    bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    preview: { color: colors.textMuted, fontSize: 13, flex: 1 },
    previewUnread: { color: colors.textSecondary, fontWeight: '500' },
    badge: {
      backgroundColor: colors.primary, borderRadius: 10,
      minWidth: 20, height: 20, paddingHorizontal: 5,
      alignItems: 'center', justifyContent: 'center', marginLeft: 8,
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

    // Empty
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  });

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.title}>Messages</Text>
        </View>
        <TouchableOpacity
          style={s.iconBtn}
          onPress={() => router.push('/(tabs)/discover/communities' as any)}
          accessibilityLabel="New message"
        >
          <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.search}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search messages"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Roxy DM row — always pinned at top */}
      <TouchableOpacity
        style={s.roxyRow}
        onPress={() => router.push('/(tabs)/grow/roxy-chat' as any)}
        activeOpacity={0.8}
      >
        <LinearGradient colors={['#FF6A2E', '#E81C8E']} style={s.roxyAva}>
          <Ionicons name="sparkles" size={22} color="#fff" />
        </LinearGradient>
        <View style={s.roxyBody}>
          <View style={s.roxyTop}>
            <Text style={s.roxyName}>Roxy</Text>
            <View style={s.roxyTag}><Text style={s.roxyTagText}>Wingwoman</Text></View>
          </View>
          <Text style={s.roxySub} numberOfLines={1}>Tap me anytime — I'll help you break the ice 💜</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </TouchableOpacity>

      <Text style={s.divider}>Direct messages</Text>

      {loading ? (
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          onRefresh={load}
          refreshing={loading}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyIcon}>💬</Text>
              <Text style={s.emptyTitle}>No messages yet</Text>
              <Text style={s.emptyText}>
                Connect with people in the community to start chatting 💜
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const unread = liveUnread(item.id);
            const hasUnread = unread > 0;
            const online = isPartnerOnline(item);
            const name = item.partner?.display_name ?? 'Unknown';
            const seed = nameToSeed(name);
            const grad = gradFor(seed);
            return (
              <TouchableOpacity style={s.row} onPress={() => handleOpen(item)} activeOpacity={0.7}>
                <View style={s.avaWrap}>
                  <LinearGradient colors={grad} style={s.ava}>
                    <Text style={s.avaText}>{name[0]?.toUpperCase() ?? '?'}</Text>
                  </LinearGradient>
                  {online && <View style={s.onlineDot} />}
                </View>
                <View style={s.content}>
                  <View style={s.top}>
                    <Text style={[s.name, hasUnread && s.nameUnread]} numberOfLines={1}>{name}</Text>
                    <Text style={[s.time, hasUnread && s.timeUnread]}>{formatTime(item.last_message_at)}</Text>
                  </View>
                  <View style={s.bottom}>
                    <Text style={[s.preview, hasUnread && s.previewUnread]} numberOfLines={1}>
                      {item.lastMessagePreview}
                    </Text>
                    {hasUnread && (
                      <View style={s.badge}>
                        <Text style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text>
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
