import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../../store/authStore';
import { useConnectStore } from '../../../store/connectStore';
import { useFriendStore, isOnline } from '../../../store/friendStore';
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
import { inboxRowFromThread, formatInboxTime } from '../../../lib/inboxRows';
import {
  fetchInboxCommunityMeta,
  fetchCommunityUnread,
  filterInboxByQuery,
  inboxCommunityFromJoined,
  type InboxCommunityMeta,
} from '../../../lib/inboxCommunities';
import { TYPE } from '../../../lib/typography';
import { RADII, inkOn } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

/**
 * The Messages inbox.
 *
 * Direct + private-group threads come from ONE server call, `inbox_summary()`
 * (migration 132), through connectStore — the same call that feeds the tab
 * badge (CHAT-13). The old four-query fetch (conversations → profiles → every
 * message → unread rows) is gone: it pulled every message she had ever been
 * sent to draw one preview line, and it computed unread its own way, so the
 * badge and the row could disagree.
 *
 * Message requests never appear in this list (CHAT-02): they wait in the
 * Requests sheet, which is also where friend requests are answered.
 */
function MessagesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuthStore();
  const threads = useConnectStore((st) => st.threads);
  const requests = useConnectStore((st) => st.requests);
  const loaded = useConnectStore((st) => st.loaded);
  const loading = useConnectStore((st) => st.loading);
  const refresh = useConnectStore((st) => st.refresh);
  const pendingCount = useFriendStore((st) => st.pendingCount);
  const fetchAll = useFriendStore((st) => st.fetchAll);
  const joinedCommunities = useCommunityStore((st) => st.joinedCommunities);
  const hydrateCommunities = useCommunityStore((st) => st.hydrate);
  const profile = useProfileStore((st) => st.profile);
  const dmPermission = readDmPermission(profile as { dm_permission?: unknown } | null);
  const [search, setSearch] = useState('');
  const [requestsOpen, setRequestsOpen] = useState(false);
  // A community-invite notification (135) links to /messages?requests=1: open
  // Requests, where she answers it, then spend the param so a later visit to
  // Messages does not pop the sheet again.
  const params = useLocalSearchParams<{ requests?: string; community?: string }>();
  useEffect(() => {
    if (params.requests !== '1') return;
    setRequestsOpen(true);
    router.setParams({ requests: undefined, community: undefined });
  }, [params.requests, router]);
  const [communityMeta, setCommunityMeta] = useState<Record<string, InboxCommunityMeta>>({});
  const [communityUnread, setCommunityUnread] = useState<Record<string, number>>({});

  const requestCount = requests.length + pendingCount;

  const load = useCallback(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!user?.id) return;
    void refresh();
    void fetchAll(user.id);
    void hydrateCommunities(user.id);
  }, [user?.id, refresh, fetchAll, hydrateCommunities]);

  // Back from a chat: the read cursor moved, so pull fresh counts. Native keeps
  // this screen mounted (focus fires); web navigation does not fire focus, so
  // a pathname change covers it there.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return;
      void refresh();
    }, [refresh]),
  );
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (prevPath.current !== pathname && pathname.endsWith('/messages')) void refresh();
    prevPath.current = pathname;
  }, [pathname, refresh]);

  useEffect(() => {
    const ids = joinedCommunities.map((c) => c.id);
    if (ids.length === 0) {
      setCommunityMeta({});
      setCommunityUnread({});
      return;
    }
    let cancelled = false;
    void Promise.all([fetchInboxCommunityMeta(ids), fetchCommunityUnread(ids)])
      .then(([meta, unread]) => {
        if (cancelled) return;
        setCommunityMeta(meta);
        setCommunityUnread(unread);
      })
      .catch(() => {
        if (cancelled) return;
        setCommunityMeta({});
        setCommunityUnread({});
      });
    return () => { cancelled = true; };
  }, [joinedCommunities, threads]);

  const chats: InboxDm[] = useMemo(
    () => (user ? threads.map((t) => inboxRowFromThread(t, user.id)) : []),
    [threads, user],
  );
  const lastSeen = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const t of threads) {
      if (t.conversation_type === 'direct' && t.members[0]) m.set(t.conversation_id, t.members[0].last_seen_at);
    }
    return m;
  }, [threads]);

  const handleOpen = (item: InboxDm) => {
    router.push(`/chat/${item.id}` as never);
  };

  const inboxCommunities = useMemo(
    () => joinedCommunities.map((c) =>
      inboxCommunityFromJoined(c, {
        ...communityMeta[c.id],
        unreadCount: communityUnread[c.id] ?? communityMeta[c.id]?.unreadCount ?? 0,
      }),
    ),
    [joinedCommunities, communityMeta, communityUnread],
  );

  const filteredChats = filterInboxByQuery(
    chats,
    search,
    (c) => `${c.kind === 'group' ? c.title ?? '' : c.partner?.display_name ?? ''} ${c.lastMessagePreview}`,
  );
  const filteredCommunities = filterInboxByQuery(
    inboxCommunities,
    search,
    (c) => `${c.name} ${c.preview}`,
  );

  const isPartnerOnline = (item: InboxDm) => isOnline(lastSeen.get(item.id) ?? null);

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
                requestCount > 0
                  ? `${requestCount} ${requestCount === 1 ? 'request' : 'requests'} waiting`
                  : 'Requests'
              }
              activeOpacity={0.85}
              testID="messages-requests-entry"
            >
              <Text style={s.requestsChipText}>Requests</Text>
              {requestCount > 0 ? (
                <View style={s.requestsBadge}>
                  <Text style={s.requestsBadgeText}>{requestCount > 99 ? '99+' : requestCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => router.push('/(tabs)/messages/new' as never)}
              accessibilityLabel="New message"
              testID="messages-new"
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
        unreadCounts={{}}
        onOpenDm={handleOpen}
        onOpenCommunity={(c) => router.push(`/community/channels/${c.id}` as never)}
        onStartChat={() => router.push('/(tabs)/messages/new' as never)}
        formatTime={formatInboxTime}
        isPartnerOnline={isPartnerOnline}
        loading={loading && !loaded}
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

      <RequestsSheet
        visible={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        onOpenChat={(id) => router.push(`/chat/${id}` as never)}
      />
    </SafeAreaView>
  );
}

export default function MessagesRoute() {
  const { can } = useAccess();
  if (!can('dms')) return <OfficialChatInbox />;
  return <MessagesScreen />;
}
