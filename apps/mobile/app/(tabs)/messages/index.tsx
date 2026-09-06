import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { freshChannel } from '../../../lib/realtimeChannel';
import { useAuthStore } from '../../../store/authStore';
import { useConnectStore } from '../../../store/connectStore';
import { useFriendStore, isOnline } from '../../../store/friendStore';
import { Conversation } from '../../../types';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { PinnedPersonaRow } from '../../../components/messages/PinnedPersonaRow';
import { RequestsSheet } from '../../../components/messages/RequestsSheet';
import { OfficialChatInbox } from '../../../components/messages/OfficialChatInbox';
import { MessagesInbox, type InboxDm } from '../../../components/messages/MessagesInbox';
import { useAccess } from '../../../hooks/useAccess';
import { useCommunityStore } from '../../../store/communityStore';
import { useProfileStore } from '../../../store/profileStore';
import { readDmPermission, dmPermissionLabel } from '../../../lib/dmPermission';
import {
  fetchInboxCommunityMeta,
  filterInboxByQuery,
  inboxCommunityFromJoined,
  type InboxCommunityMeta,
} from '../../../lib/inboxCommunities';
import { TYPE } from '../../../lib/typography';
import { RADII, inkOn } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

type PartnerProfile = { id: string; display_name: string; username: string };
type ChatItem = InboxDm;

function formatTime(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMM');
}

function MessagesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const { setConversations, unreadCounts, clearUnread } = useConnectStore();
  const { friends } = useFriendStore();
  const pendingCount = useFriendStore((st) => st.pendingCount);
  const fetchAll = useFriendStore((st) => st.fetchAll);
  const joinedCommunities = useCommunityStore((st) => st.joinedCommunities);
  const hydrateCommunities = useCommunityStore((st) => st.hydrate);
  const profile = useProfileStore((st) => st.profile);
  const dmPermission = readDmPermission(profile as { dm_permission?: unknown } | null);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [communityMeta, setCommunityMeta] = useState<Record<string, InboxCommunityMeta>>({});

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

  // The requests entry and its badge both read `pendingCount`, so the inbox has
  // to be the thing that keeps it fresh now that Grow's People screen is gone.
  useEffect(() => {
    if (!user?.id) return;
    void fetchAll(user.id);
    void hydrateCommunities(user.id);
  }, [user?.id, fetchAll, hydrateCommunities]);

  useEffect(() => {
    const ids = joinedCommunities.map((c) => c.id);
    if (ids.length === 0) {
      setCommunityMeta({});
      return;
    }
    let cancelled = false;
    void fetchInboxCommunityMeta(ids)
      .then((meta) => { if (!cancelled) setCommunityMeta(meta); })
      .catch(() => { if (!cancelled) setCommunityMeta({}); });
    return () => { cancelled = true; };
  }, [joinedCommunities]);

  useEffect(() => {
    if (!user || chats.length === 0) return;
    const convIds = chats.map((c) => c.id);
    const channel = freshChannel('messages-tab-unread')
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

  const inboxCommunities = useMemo(
    () => joinedCommunities.map((c) => inboxCommunityFromJoined(c, communityMeta[c.id])),
    [joinedCommunities, communityMeta],
  );

  const filteredChats = filterInboxByQuery(
    chats,
    search,
    (c) => `${c.partner?.display_name ?? ''} ${c.lastMessagePreview}`,
  );
  const filteredCommunities = filterInboxByQuery(
    inboxCommunities,
    search,
    (c) => `${c.name} ${c.preview}`,
  );

  const isPartnerOnline = (item: ChatItem) => {
    const partnerId = item.participant_ids.find((id) => id !== user?.id);
    const friend = friends.find((f) => f.profile.id === partnerId);
    return friend ? isOnline(friend.profile.last_seen_at ?? null) : false;
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    iconBtn: {
      width: 34, height: 34, borderRadius: RADII.pill,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
      alignItems: 'center', justifyContent: 'center',
    },
    requestsChip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 12,
      borderRadius: RADII.pill, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line,
    },
    requestsChipText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
    requestsBadge: {
      backgroundColor: colors.primary, borderRadius: RADII.pill,
      minWidth: 18, height: 18, paddingHorizontal: 6,
      alignItems: 'center', justifyContent: 'center',
    },
    requestsBadgeText: { ...TYPE.micro, color: inkOn(colors.primary), fontWeight: '800' },
    search: {
      flexDirection: 'row', alignItems: 'center', gap: 9,
      backgroundColor: colors.surface, borderRadius: 14,
      marginHorizontal: 14, marginTop: 10, marginBottom: 12,
      paddingHorizontal: 13, paddingVertical: 9,
      borderWidth: 1, borderColor: colors.line,
    },
    searchInput: { ...TYPE.body, color: colors.textPrimary, flex: 1 },
    personas: { paddingHorizontal: 14, gap: 8, paddingBottom: 6 },
    footer: {
      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8,
    },
    footerText: { ...TYPE.caption, color: colors.textMuted, fontWeight: '600' },
    footerAccent: { color: colors.textSecondary, fontWeight: '700' },
  });

  return (
    <SafeAreaView style={s.container}>
      <ScreenHeader
        title="Messages"
        actions={
          <>
            <TouchableOpacity
              style={s.requestsChip}
              onPress={() => setRequestsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={
                pendingCount > 0
                  ? `${pendingCount} ${pendingCount === 1 ? 'request' : 'requests'} waiting`
                  : 'Requests'
              }
              activeOpacity={0.85}
              testID="messages-requests-entry"
            >
              <Text style={s.requestsChipText}>Requests</Text>
              {pendingCount > 0 ? (
                <View style={s.requestsBadge}>
                  <Text style={s.requestsBadgeText}>{pendingCount > 99 ? '99+' : pendingCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => router.push('/(tabs)/messages/new' as any)}
              accessibilityLabel="New message"
            >
              <Ionicons name="create-outline" size={17} color={colors.textSecondary} />
            </TouchableOpacity>
          </>
        }
      />

      <View style={s.search}>
        <Ionicons name="search-outline" size={15} color={colors.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="Search messages"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View style={s.personas}>
        <PinnedPersonaRow persona="roxy" onPress={() => router.push('/roxy-chat' as never)} />
        <PinnedPersonaRow persona="sister" onPress={() => router.push('/sister-button' as never)} />
      </View>

      <MessagesInbox
        chats={filteredChats}
        communities={filteredCommunities}
        unreadCounts={unreadCounts}
        onOpenDm={handleOpen}
        onOpenCommunity={(c) => router.push(`/community/channels/${c.id}` as never)}
        onStartChat={() => router.push('/(tabs)/messages/new' as any)}
        formatTime={formatTime}
        isPartnerOnline={isPartnerOnline}
        loading={loading}
        onRefresh={load}
        footer={
          <TouchableOpacity
            style={s.footer}
            onPress={() => router.push('/(tabs)/you/settings' as never)}
            accessibilityRole="button"
            accessibilityLabel={`Who can message you: ${dmPermissionLabel(dmPermission)}. Change in Settings.`}
          >
            <Text style={s.footerText}>
              Who can message you:{' '}
              <Text style={s.footerAccent}>{dmPermissionLabel(dmPermission)}</Text>
              {' · request-first inbox · change in Settings →'}
            </Text>
          </TouchableOpacity>
        }
      />

      <RequestsSheet visible={requestsOpen} onClose={() => setRequestsOpen(false)} />
    </SafeAreaView>
  );
}

export default function MessagesRoute() {
  const { can } = useAccess();
  if (!can('dms')) return <OfficialChatInbox />;
  return <MessagesScreen />;
}
