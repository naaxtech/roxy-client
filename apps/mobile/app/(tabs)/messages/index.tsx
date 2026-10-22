import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Platform,
} from 'react-native';
import { TouchableOpacity } from '../../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../../../store/authStore';
import { useConnectStore } from '../../../store/connectStore';
import { useFriendStore, isOnline } from '../../../store/friendStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AccountStatusTag } from '../../../components/account/AccountStatusTag';
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
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

/** Header and row icons: 24 dp outlines (direction › Create sheet, Bans). */
const ICON = 24;
/** The Requests row (direction › Spacing: rows 56 / 64 / 72). */
const REQUESTS_ROW_MIN = 56;

/**
 * The Messages inbox (design direction v2 › Messages, board v2-06, normal
 * state only — the discreet switch is held with Premium, so no eye button and
 * no lock badge ship).
 *
 * `headline` "Messages" with search and compose; Roxy AI and Sister pinned;
 * then a Requests row ("2 waiting"), the people and a Communities group.
 * Search moved from a permanent field into the header (it opens one in place),
 * and the v0 caps "Requests" chip became the row.
 *
 * Direct + private-group threads come from ONE server call, `inbox_summary()`
 * (migration 132), through connectStore — the same call that feeds the tab
 * badge (CHAT-13).
 *
 * Message requests never appear in this list (CHAT-02): they wait in the
 * Requests sheet, which is also where friend requests are answered.
 */
function MessagesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  // Selectors only (jank audit #9): a token refresh used to re-render the
  // whole inbox. Only the id is read.
  const userId = useAuthStore((st) => st.user?.id ?? null);
  const threads = useConnectStore((st) => st.threads);
  const requests = useConnectStore((st) => st.requests);
  const loaded = useConnectStore((st) => st.loaded);
  const loading = useConnectStore((st) => st.loading);
  const refresh = useConnectStore((st) => st.refresh);
  const pendingCount = useFriendStore((st) => st.pendingCount);
  const fetchAll = useFriendStore((st) => st.fetchAll);
  const joinedCommunities = useCommunityStore((st) => st.joinedCommunities);
  const hydrateCommunities = useCommunityStore((st) => st.hydrate);
  const dmPermissionRaw = useProfileStore((st) => (st.profile as { dm_permission?: unknown } | null)?.dm_permission);
  const dmPermission = readDmPermission({ dm_permission: dmPermissionRaw });
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
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

  // Returns the reload so her pull spins until the new rows are in.
  const load = useCallback(() => refresh(), [refresh]);

  useEffect(() => {
    if (!userId) return;
    void refresh();
    void fetchAll(userId);
    void hydrateCommunities(userId);
  }, [userId, refresh, fetchAll, hydrateCommunities]);

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
    () => (userId ? threads.map((t) => inboxRowFromThread(t, userId)) : []),
    [threads, userId],
  );
  const lastSeen = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const t of threads) {
      if (t.conversation_type === 'direct' && t.members[0]) m.set(t.conversation_id, t.members[0].last_seen_at);
    }
    return m;
  }, [threads]);

  const handleOpen = useCallback((item: InboxDm) => {
    router.push(`/chat/${item.id}` as never);
  }, [router]);

  const inboxCommunities = useMemo(
    () => joinedCommunities.map((c) =>
      inboxCommunityFromJoined(c, {
        ...communityMeta[c.id],
        unreadCount: communityUnread[c.id] ?? communityMeta[c.id]?.unreadCount ?? 0,
      }),
    ),
    [joinedCommunities, communityMeta, communityUnread],
  );

  const filteredChats = useMemo(() => filterInboxByQuery(
    chats,
    search,
    (c) => `${c.kind === 'group' ? c.title ?? '' : c.partner?.display_name ?? ''} ${c.lastMessagePreview}`,
  ), [chats, search]);
  const filteredCommunities = useMemo(() => filterInboxByQuery(
    inboxCommunities,
    search,
    (c) => `${c.name} ${c.preview}`,
  ), [inboxCommunities, search]);

  const isPartnerOnline = useCallback(
    (item: InboxDm) => isOnline(lastSeen.get(item.id) ?? null),
    [lastSeen],
  );

  const closeSearch = () => {
    setSearch('');
    setSearchOpen(false);
  };

  // Built once per theme, not on every render (jank audit #8).
  const s = useMemo(() => styles(colors), [colors]);
  const waiting = requestCount > 0
    ? `${requestCount > 99 ? '99+' : requestCount} waiting`
    : 'None waiting';

  const pinnedAndRequests = (
    <View>
      <PinnedPersonaRow persona="roxy" onPress={() => router.push('/roxy-chat' as never)} />
      <PinnedPersonaRow persona="sister" onPress={() => router.push('/sister-button' as never)} />
      <TouchableOpacity
        style={s.requestsRow}
        onPress={() => setRequestsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Requests, ${waiting.toLowerCase()}`}
        testID="messages-requests-entry"
      >
        <Text style={s.requestsLabel}>Requests</Text>
        <Text style={[s.requestsCount, requestCount > 0 ? s.requestsCountOn : null]}>{waiting}</Text>
        <Ionicons
          name="chevron-forward"
          size={ICON - SPACE[1]}
          color={requestCount > 0 ? colors.pinkInk : colors.ink3}
        />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.title} accessibilityRole="header">Messages</Text>
        <AccountStatusTag />
        <TouchableOpacity
          style={s.iconBtn}
          onPress={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          accessibilityRole="button"
          accessibilityLabel={searchOpen ? 'Close search' : 'Search messages'}
          testID="messages-search-toggle"
        >
          <Ionicons name={searchOpen ? 'close' : 'search-outline'} size={ICON} color={colors.ink} />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.iconBtn}
          onPress={() => router.push('/(tabs)/messages/new' as never)}
          accessibilityRole="button"
          accessibilityLabel="New message"
          testID="messages-new"
        >
          <Ionicons name="create-outline" size={ICON} color={colors.ink} />
        </TouchableOpacity>
      </View>

      {searchOpen ? (
        <View style={s.search}>
          <Ionicons name="search-outline" size={ICON - SPACE[1]} color={colors.ink2} />
          <TextInput
            style={s.searchInput}
            placeholder="Search people and communities"
            placeholderTextColor={colors.ink3}
            value={search}
            onChangeText={setSearch}
            autoFocus
            accessibilityLabel="Search messages"
            testID="messages-search"
          />
        </View>
      ) : null}

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
        directHeader={pinnedAndRequests}
        footer={
          <TouchableOpacity
            style={s.footer}
            onPress={() => router.push('/(tabs)/you/settings' as never)}
            accessibilityRole="button"
            accessibilityLabel={`Who can message you: ${dmPermissionLabel(dmPermission)}. Change in Settings.`}
            testID="messages-dm-permission"
          >
            <Text style={s.footerText}>
              Who can message you: {dmPermissionLabel(dmPermission)}.{' '}
              <Text style={s.footerLink}>Change in Settings</Text>
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

const styles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ground },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[0],
    paddingLeft: MARGIN, paddingRight: SPACE[1], paddingTop: SPACE[2], paddingBottom: SPACE[1],
  },
  title: { ...TYPE.headline, color: colors.ink, flex: 1 },
  iconBtn: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[1],
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: MARGIN,
    marginHorizontal: MARGIN, marginBottom: SPACE[1],
    borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  searchInput: { ...TYPE.body, color: colors.ink, flex: 1, minHeight: MIN_TOUCH_TARGET },
  requestsRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[1],
    minHeight: REQUESTS_ROW_MIN, paddingHorizontal: MARGIN,
  },
  requestsLabel: { ...TYPE.label, color: colors.ink, flex: 1 },
  requestsCount: { ...TYPE.body, color: colors.ink3 },
  requestsCountOn: { ...TYPE.label, color: colors.pinkInk },
  footer: { paddingHorizontal: MARGIN, paddingVertical: SPACE[3], minHeight: MIN_TOUCH_TARGET },
  footerText: { ...TYPE.meta, color: colors.ink2 },
  footerLink: { color: colors.pinkInk },
});

export default function MessagesRoute() {
  const { can } = useAccess();
  if (!can('dms')) return <OfficialChatInbox />;
  return <MessagesScreen />;
}
