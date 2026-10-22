import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
} from 'react-native';
import { PressableScale } from '../../../../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../../lib/supabase';
import { useAuthStore } from '../../../../../store/authStore';
import { useThemeColors } from '../../../../../hooks/useThemeColors';
import { TYPE } from '../../../../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../../../../lib/touchTargets';
import { logError } from '../../../../../lib/errorLogger';
import { ChannelBar } from '../../../../../components/channels/ChannelBar';
import { ChannelMessage } from '../../../../../components/channels/ChannelMessage';
import { ChannelComposer } from '../../../../../components/channels/ChannelComposer';
import { ChannelMessageActions, type ChannelAction } from '../../../../../components/channels/ChannelMessageActions';
import {
  absorbEcho, dropPending, isPending, pendingMessage, settlePending,
} from '../../../../../components/channels/pendingMessages';
import { Snackbar } from '../../../../../components/ui/Snackbar';
import {
  fetchChannels, fetchChannelMessages, fetchChannelMessage, sendChannelMessage, deleteChannelMessage,
  fetchOlderChannelMessages, prependOlder, MESSAGE_PAGE,
  initialChannel, fetchMyChannelRole, writeFailureMessage, authorName, fetchLiveStage,
  markChannelRead, setChannelNotifications, fetchChannelNotifications,
  hideSilenced, mergeChannelMessage,
  type LiveStage,
  type Channel, type ChannelAuthor, type ChannelMessage as Message,
} from '../../../../../lib/channels';
import { useSafetyStore } from '../../../../../store/safetyStore';
import { useProfileStore } from '../../../../../store/profileStore';
import { useReactions } from '../../../../../hooks/useReactions';
import { useTyping } from '../../../../../hooks/useTyping';
import { ReactionChips } from '../../../../../components/chat/ReactionBar';
import { TypingIndicator } from '../../../../../components/chat/TypingIndicator';
import { KeyboardTrackingView } from '../../../../../components/chat/KeyboardTrackingView';
import { SHEET_EMOJIS } from '../../../../../components/chat/MessageActionSheet';
import { typingLabel } from '../../../../../lib/chatThread';
import { haptic } from '../../../../../lib/haptics';
import EmojiKeyboard from 'rn-emoji-keyboard';
import { useAccess } from '../../../../../hooks/useAccess';
import { ComingSoon } from '../../../../../components/features/ComingSoon';
import { OFFICIAL_COMMUNITY_SLUG } from '../../../../../lib/features';
import { showAlert, confirmAction } from '../../../../../lib/confirm';
import { freshChannel } from '../../../../../lib/realtimeChannel';
import { canModerateMember, fetchElevatedRoles, removeCommunityMember } from '../../../../../lib/communityMembership';

const NONE: string[] = [];

/**
 * Community channels (design markup 655–697).
 *
 * Membership is never checked here. Migration 105's RLS answers it — reads are
 * `is_community_member(community_id)` — so a non-member gets an empty channel
 * list and the empty state says so. A client-side gate would be a second,
 * weaker answer to a question the database already answers, and the one that
 * drifts.
 */
export default function CommunityChannelsScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  // Selectors, not whole stores (jank audit #9). Only the id is read.
  const userId = useAuthStore((st) => st.user?.id ?? null);
  const user = useMemo(() => (userId ? { id: userId } : null), [userId]);
  const { canCommunity } = useAccess();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [communitySlug, setCommunitySlug] = useState<string | null>(null);
  const [active, setActive] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [communityName, setCommunityName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  // Two independent loaders get two error slots. One shared slot let a
  // successful channel-list refresh silently clear a message-load failure.
  const [error, setError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [stage, setStage] = useState<LiveStage | null>(null);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  // CHAT-09: who outranks whom here, loaded only for moderators (a hint for
  // what to draw; remove_community_member is the gate). Absent = member.
  const [roles, setRoles] = useState<Map<string, string>>(new Map());

  // CHAT-16: history older than the first page. hasOlder is true while the
  // last page came back full; the header row loads the next one up.
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const loadingOlderRef = useRef(false);

  const listRef = useRef<FlatList<Message>>(null);
  // Which channel the screen is actually showing. A fetch that resolves after
  // she has moved on must not paint its rows under another channel's name.
  const shownChannelId = useRef<string | null>(null);
  // Whether she is parked at the bottom. Yanking a woman who is reading
  // yesterday down to the newest message every time anyone posts is hostile.
  const atBottom = useRef(true);

  const blockUser = useSafetyStore((st) => st.blockUser);
  const openReportModal = useSafetyStore((st) => st.openReportModal);
  const blockedUserIds = useSafetyStore((st) => st.blockedUserIds);
  const mutedUserIds = useSafetyStore((st) => st.mutedUserIds);
  // CHAT-10: block and mute reach channels. RLS (migration 132) already hides
  // block-paired senders both ways; this hides her at once after she taps
  // Block, before any refetch, and keeps muted senders out of her view.
  const visible = useMemo(
    () => hideSilenced(messages, blockedUserIds ?? NONE, mutedUserIds ?? NONE),
    [messages, blockedUserIds, mutedUserIds],
  );

  // CHAT-17: reactions and typing, on the open channel's private topics
  // (chan:<id>:reactions / :typing; migration 132 admits members only).
  const me = user?.id ?? '';
  const selfName = useProfileStore((st) => st.profile?.display_name ?? st.profile?.username ?? undefined);
  const selfAvatar = useProfileStore((st) => st.profile?.avatar_url ?? null);
  const selfUsername = useProfileStore((st) => st.profile?.username ?? null);
  // F10: a send that failed. The provisional message is already gone again;
  // this says why and offers Retry (the composer has her words back).
  const [sendFailure, setSendFailure] = useState<{ message: string; retry: () => void } | null>(null);
  const messageIds = useMemo(() => visible.map((m) => m.id), [visible]);
  const { reactionsMap, addReaction, removeReaction } = useReactions({
    conversationId: active?.id ?? '', scope: 'channel', messageIds,
  });
  const { typingNames, sendTyping, stopTyping } = useTyping({
    conversationId: active?.id ?? '', scope: 'channel', currentUserId: me, partnerName: '', selfName,
  });
  const [reactAnyFor, setReactAnyFor] = useState<string | null>(null);
  const toggleReaction = useCallback((messageId: string, emoji: string, own: boolean) => {
    if (!me) return;
    haptic('select');
    if (own) void removeReaction(messageId, emoji, me);
    else void addReaction(messageId, emoji, me);
  }, [me, addReaction, removeReaction]);
  const reactFromMenu = useCallback((messageId: string, emoji: string) => {
    const own = (reactionsMap[messageId] ?? []).some((r) => r.user_id === me && r.emoji === emoji);
    toggleReaction(messageId, emoji, own);
  }, [reactionsMap, me, toggleReaction]);

  const loadChannels = useCallback(async () => {
    if (!communityId) {
      // Without this the `finally` never runs, so a missing param rendered a
      // spinner forever with no error and no way out.
      setError('This community could not be opened.');
      setLoading(false);
      return;
    }
    try {
      const [rows, community] = await Promise.all([
        fetchChannels(communityId),
        supabase.from('communities').select('name, slug').eq('id', communityId).maybeSingle(),
      ]);
      setChannels(rows);
      setActive(initialChannel(rows));
      setCommunityName(community.data?.name ?? '');
      setCommunitySlug(community.data?.slug ?? null);
      setError(null);
      // A hint for what to DRAW, never the gate. The gate is the policy, and a
      // client that decided this for itself would be the copy that drifts.
      if (user?.id) {
        const { isModerator: mod } = await fetchMyChannelRole(communityId, user.id);
        setIsModerator(mod);
      }
      setStage(await fetchLiveStage(communityId));
    } catch (e) {
      logError(e, 'community_channels_load_failed');
      setError('Could not load this community’s channels.');
    } finally {
      setLoading(false);
    }
  }, [communityId, user?.id]);

  useEffect(() => { void loadChannels(); }, [loadChannels]);

  useEffect(() => {
    if (!isModerator || !communityId) return undefined;
    let cancelled = false;
    fetchElevatedRoles(communityId)
      .then((r) => { if (!cancelled) setRoles(r); })
      .catch((e) => logError(e, 'community_channel_roles_failed'));
    return () => { cancelled = true; };
  }, [isModerator, communityId]);

  // Opt-in channel notifications, off by default (migration 128).
  useEffect(() => {
    if (!communityId || !user?.id) return;
    let cancelled = false;
    void fetchChannelNotifications(communityId, user.id).then((on) => {
      if (!cancelled) setNotifyEnabled(on);
    });
    return () => { cancelled = true; };
  }, [communityId, user?.id]);

  const toggleNotifications = async () => {
    if (!communityId) return;
    const next = !notifyEnabled;
    setNotifyEnabled(next);
    await setChannelNotifications(communityId, next);
  };

  const loadMessages = useCallback(async (channelId: string) => {
    setLoadingMessages(true);
    try {
      const rows = await fetchChannelMessages(channelId);
      // She may have tapped another chip while this was in flight. Painting
      // these rows now puts one channel's messages under another's name, and a
      // reply typed against them posts to the room she is not looking at.
      if (shownChannelId.current !== channelId) return;
      setMessages(rows);
      setHasOlder(rows.length >= MESSAGE_PAGE);
      setOlderError(false);
      setMessageError(null);
    } catch (e) {
      logError(e, 'community_channel_messages_failed');
      if (shownChannelId.current === channelId) setMessageError('Could not load this channel.');
    } finally {
      if (shownChannelId.current === channelId) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    // Cleared BEFORE the fetch, never after it returns. Leaving the previous
    // channel's messages up under the new channel's name is not a race — it
    // happened on every switch, for the whole length of the fetch.
    shownChannelId.current = active.id;
    atBottom.current = true;
    setMessages([]);
    setSendFailure(null);
    setMessageError(null);
    setHasOlder(false);
    setOlderError(false);
    void loadMessages(active.id);
    // Opening the channel is reading it. Clear its unread cursor so the inbox
    // badge does not count messages she has already seen.
    void markChannelRead(active.id);
  }, [active, loadMessages]);

  // The page before the oldest loaded row, put ABOVE what she is reading.
  // The cursor is the oldest row she has loaded, including any she has hidden
  // (block/mute), so a silenced sender never makes the same page load twice.
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const loadOlder = useCallback(async () => {
    const channelId = shownChannelId.current;
    const oldest = messagesRef.current[0]?.created_at;
    if (!channelId || !oldest || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const older = await fetchOlderChannelMessages(channelId, oldest);
      if (shownChannelId.current !== channelId) return;
      // hasMore from the rows she has now; the updater re-merges against
      // whatever landed meanwhile (a live message), never a stale copy.
      setHasOlder(prependOlder(messagesRef.current, older, MESSAGE_PAGE).hasMore);
      setMessages((prev) => prependOlder(prev, older, MESSAGE_PAGE).messages);
    } catch (e) {
      logError(e, 'community_channel_older_failed');
      if (shownChannelId.current === channelId) setOlderError(true);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, []);

  // Filtered by channel_id, never table-wide: a subscription to every message
  // in every community is the pattern CLAUDE.md §18 bans outright.
  //
  // CHAT-16: an incoming row is fetched BY ID (the payload carries no joined
  // author) and folded in — the page used to be re-read for every message
  // anybody posted. UPDATE covers edits and moderator removals the same way.
  // A row RLS hides (a block-paired sender) comes back null and is dropped.
  // freshChannel: a unique topic, so quick re-entry never reuses a dead one
  // (CHAT-08).
  useEffect(() => {
    if (!active) return undefined;
    const channelId = active.id;
    const fold = async (id: string | undefined) => {
      if (!id) return;
      try {
        const row = await fetchChannelMessage(id);
        if (!row || shownChannelId.current !== channelId) return;
        setMessages((prev) => mergeChannelMessage(absorbEcho(prev, row), row));
      } catch (e) {
        logError(e, 'community_channel_message_fetch_failed');
        // One row failed: fall back to the page rather than lose the message.
        if (shownChannelId.current === channelId) void loadMessages(channelId);
      }
    };
    const filter = `channel_id=eq.${channelId}`;
    const channel = freshChannel(`community-channel-${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'community_channel_messages', filter },
        (payload: { new?: { id?: string } }) => {
          void fold(payload.new?.id);
          // She is watching, so what lands is read. Clear the cursor as the
          // message arrives, or it comes back as an unread badge after she
          // leaves.
          void markChannelRead(channelId);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'community_channel_messages', filter },
        (payload: { new?: { id?: string } }) => { void fold(payload.new?.id); },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [active, loadMessages]);

  const handleSend = useCallback(async (body: string) => {
    if (!active || !user?.id) return;
    const target = active.id;
    const author: ChannelAuthor = {
      id: user.id, username: selfUsername, display_name: selfName ?? null, avatar_url: selfAvatar,
    };
    // F10: drawn in the same frame as Send, as a provisional row. The
    // RETURNED row replaces it (the only proof it exists); a refusal takes it
    // back out and the composer hands the reason to the snackbar.
    const provisional = pendingMessage(target, user.id, body, author);
    setSendFailure(null);
    setMessages((prev) => [...prev, provisional]);
    atBottom.current = true;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    try {
      const saved = await sendChannelMessage(target, user.id, body);
      // Only if she is still in the channel she sent to. Appending
      // unconditionally drew a #general message into #rants, where she read it
      // as posted there until the next refetch quietly took it away again.
      if (shownChannelId.current !== target) return;
      setMessages((prev) => settlePending(prev, provisional.id, saved));
    } catch (e) {
      setMessages((prev) => dropPending(prev, provisional.id));
      throw e;
    }
  }, [active, user?.id, selfName, selfUsername, selfAvatar]);

  const removeMessage = useCallback(async (message: Message) => {
    try {
      await deleteChannelMessage(message.id);
      // Re-read rather than assume. deleteChannelMessage already refuses a
      // zero-row update, and this puts the settled state on screen.
      if (shownChannelId.current === message.channel_id) await loadMessages(message.channel_id);
    } catch (e) {
      logError(e, 'community_channel_message_remove_failed');
      // Never the raw error: a PostgrestError is an Error subclass, so its
      // message is policy text naming the table, in front of a member.
      setMessageError(writeFailureMessage(e));
    }
  }, [loadMessages]);

  /**
   * The safety menu. A group message surface without report and block is one a
   * woman cannot get out of; the DM screen has had both since it shipped.
   */
  const menuActions = useCallback((message: Message): ChannelAction[] => {
    const mine = !!user?.id && message.sender_id === user.id;
    const name = authorName(message.author);
    const actions: ChannelAction[] = [];

    if ((mine || isModerator) && !message.deleted_at) {
      actions.push({
        key: 'remove',
        label: mine ? 'Delete my message' : 'Remove this message',
        destructive: true,
        onPress: () => { void removeMessage(message); },
      });
    }

    if (message.sender_id && !mine) {
      actions.push({
        key: 'report',
        label: 'Report this message',
        onPress: () => openReportModal({
          userId: message.sender_id as string,
          contentType: 'message',
          contentId: message.id,
        }),
      });
      actions.push({
        key: 'block',
        label: `Block ${name}`,
        destructive: true,
        onPress: () => {
          void (async () => {
            try {
              await blockUser(message.sender_id as string);
              // Her messages leave the list now (hideSilenced); say so, so the
              // menu action never looks like it did nothing.
              showAlert('Blocked', `You won't see ${name}'s messages here any more.`);
            } catch (e) {
              logError(e, 'community_channel_block_failed');
              showAlert('Not blocked', `Something went wrong, so ${name} is not blocked. Try again in a moment.`);
            }
          })();
        },
      });
    }

    // CHAT-09: moderators remove or ban — only someone below their own rank.
    const myRole = user?.id ? roles.get(user.id) : undefined;
    if (isModerator && communityId && message.sender_id && !mine
        && canModerateMember(myRole ?? 'moderator', roles.get(message.sender_id) ?? 'member')) {
      const target = message.sender_id;
      const act = (ban: boolean) => () => {
        void (async () => {
          const yes = await confirmAction(
            ban ? `Ban ${name}?` : `Remove ${name}?`,
            ban
              ? `${name} leaves this community and can't rejoin, ask to join or be invited back until a moderator lifts the ban.`
              : `${name} leaves this community. She can join again later.`,
            ban ? 'Ban' : 'Remove',
          );
          if (!yes) return;
          try {
            await removeCommunityMember(communityId, target, { ban });
            showAlert('Done', ban ? `${name} is banned from this community.` : `${name} was removed from this community.`);
          } catch (e) {
            logError(e, 'community_channel_moderate_failed');
            showAlert('Not done', e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');
          }
        })();
      };
      actions.push({ key: 'remove-member', label: `Remove ${name} from the community`, destructive: true, onPress: act(false) });
      actions.push({ key: 'ban-member', label: `Ban ${name}`, destructive: true, onPress: act(true) });
    }

    return actions;
  }, [user?.id, isModerator, removeMessage, openReportModal, blockUser, roles, communityId]);

  // Built once per theme, not on every render (jank audit #8).
  const s = useMemo(() => StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.backgroundAlt,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    back: {
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    notifyBtn: {
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headText: { flex: 1, minWidth: 0 },
    title: { ...TYPE.body, fontWeight: '700', color: colors.textPrimary },
    channelName: { color: colors.primaryInk },
    subtitle: { ...TYPE.micro, color: colors.textMuted },
    list: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, gap: 13 },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
    centreTitle: { ...TYPE.title, color: colors.textPrimary, textAlign: 'center' },
    centreBody: { ...TYPE.caption, color: colors.textSecondary, textAlign: 'center' },
    retry: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '700' },
    retryHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    olderHit: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
    older: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '700' },
    olderError: { ...TYPE.caption, color: colors.errorInk, textAlign: 'center' },
    reactRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 8 },
    reactHit: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
    reactEmoji: { fontSize: 24 },
    startOf: { ...TYPE.micro, color: colors.textMuted, textAlign: 'center', paddingVertical: 8 },
    snackAnchor: { height: 0, zIndex: 1 },
    flex: { flex: 1 },
  }), [colors]);

  if (!loading && communitySlug && !canCommunity(communitySlug)) {
    return (
      <ComingSoon
        feature={communitySlug === OFFICIAL_COMMUNITY_SLUG ? 'officialChat' : 'communities'}
      />
    );
  }

  const body = () => {
    if (loading) {
      return (
        <View style={s.centre} testID="channels-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={s.centre} testID="channels-error">
          <Text style={s.centreBody}>{error}</Text>
          <PressableScale
            onPress={() => { setLoading(true); void loadChannels(); }}
            style={s.retryHit}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.retry}>Try again</Text>
          </PressableScale>
        </View>
      );
    }

    if (!active) {
      // No channels means either the community has none, or she is not a
      // member and RLS returned nothing. Both are "you cannot read this yet",
      // and guessing which would mean telling her something we do not know.
      return (
        <View style={s.centre} testID="channels-empty">
          <Text style={s.centreTitle}>No channels here yet</Text>
          <Text style={s.centreBody}>
            Channels open up once you are a member of this community.
          </Text>
        </View>
      );
    }

    if (messageError) {
      return (
        <View style={s.centre} testID="channel-messages-error">
          <Text style={s.centreBody}>{messageError}</Text>
          {/* Retries THIS channel. The screen-level retry reloads the channel
              list and resets `active`, which dropped her into #general when
              what had failed was #rants. */}
          <PressableScale
            onPress={() => { if (active) void loadMessages(active.id); }}
            style={s.retryHit}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.retry}>Try again</Text>
          </PressableScale>
        </View>
      );
    }

    if (loadingMessages && messages.length === 0) {
      return (
        <View style={s.centre} testID="channel-messages-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    if (visible.length === 0) {
      return (
        <View style={s.centre} testID="channel-messages-empty">
          <Text style={s.centreTitle}>Nothing in # {active.slug} yet</Text>
          {/* Never the topic: the header already carries it two lines up, and
              the same sentence twice on one screen reads as a rendering bug. */}
          <Text style={s.centreBody}>Say the first thing. Somebody has to.</Text>
        </View>
      );
    }

    return (
      <FlatList
        ref={listRef}
        data={visible}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.list}
        renderItem={({ item }) => (
          <ChannelMessage
            message={item}
            onPressAuthor={(id) => router.push(`/user/${id}` as never)}
            // A provisional message does not exist yet: nothing to report,
            // remove or react to until the server has it.
            onLongPress={isPending(item) ? undefined : (m) => setMenuFor(m)}
            onOpenCard={(path) => router.push(path as never)}
            footer={(reactionsMap[item.id]?.length ?? 0) > 0 ? (
              <ReactionChips
                reactions={reactionsMap[item.id] ?? []}
                currentUserId={me}
                onToggle={(emoji, own) => toggleReaction(item.id, emoji, own)}
              />
            ) : null}
            testID={`channel-message-${item.id}`}
          />
        )}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          atBottom.current =
            contentOffset.y + layoutMeasurement.height >= contentSize.height - 60;
          // CHAT-16: near the top, fetch the page before. A failed page waits
          // for her tap instead of retrying on every scroll event.
          if (contentOffset.y < 80 && hasOlder && !loadingOlderRef.current && !olderError) {
            void loadOlder();
          }
        }}
        scrollEventThrottle={16}
        // Keeps her place when an older page lands above her (native; the web
        // build keeps the offset as is, which also holds the visible row).
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        ListHeaderComponent={
          hasOlder || olderError ? (
            <PressableScale
              onPress={() => { void loadOlder(); }}
              disabled={loadingOlder}
              style={s.olderHit}
              accessibilityRole="button"
              accessibilityLabel={olderError ? 'Try loading earlier messages again' : 'Load earlier messages'}
              accessibilityState={{ busy: loadingOlder }}
              testID="channel-load-older"
            >
              {loadingOlder ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={olderError ? s.olderError : s.older}>
                  {olderError ? "Couldn't load earlier messages. Tap to try again." : 'Earlier messages'}
                </Text>
              )}
            </PressableScale>
          ) : (
            <Text style={s.startOf} testID="channel-start">{`Start of # ${active.slug}`}</Text>
          )
        }
        // Only when she was already at the bottom, or a woman reading yesterday
        // is yanked to the newest message every time anybody posts.
        onContentSizeChange={() => {
          if (atBottom.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        testID="channel-messages"
      />
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <PressableScale
          onPress={() => router.back()}
          style={s.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="channels-back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </PressableScale>
        <View style={s.headText}>
          <Text style={s.title} numberOfLines={1}>
            {communityName || 'Community'}
            {active ? <Text style={s.channelName}>{`  # ${active.slug}`}</Text> : null}
          </Text>
          {active?.topic ? (
            <Text style={s.subtitle} numberOfLines={1}>{active.topic}</Text>
          ) : null}
        </View>
        <PressableScale
          onPress={() => { void toggleNotifications(); }}
          style={s.notifyBtn}
          accessibilityRole="button"
          accessibilityLabel={notifyEnabled ? 'Mute channel notifications' : 'Notify me about new channel messages'}
          accessibilityState={{ selected: notifyEnabled }}
          testID="channels-notify"
        >
          <Ionicons
            name={notifyEnabled ? 'notifications' : 'notifications-off-outline'}
            size={20}
            color={notifyEnabled ? colors.roxy : colors.textSecondary}
          />
        </PressableScale>
      </View>

      {channels.length > 0 ? (
        <ChannelBar
          channels={channels}
          activeId={active?.id ?? null}
          onSelect={setActive}
          stageCount={stage?.participantCount ?? null}
          onJoinStage={stage
            ? () => router.push(`/community-room-session?room_id=${stage.roomId}` as never)
            : undefined}
        />
      ) : null}

      {/* F14: the composer rides the keyboard frame by frame. */}
      <KeyboardTrackingView style={s.flex} testID="channel-keyboard">
        {body()}
        <TypingIndicator partnerName="" visible={typingNames.length > 0} label={typingLabel(typingNames)} />
        {/* A zero-height anchor: the snackbar rises from the composer's top
            edge, never over the words she just got back. */}
        <View style={s.snackAnchor} pointerEvents="box-none">
          <Snackbar
            visible={sendFailure !== null}
            message={sendFailure?.message ?? ''}
            actionLabel="Retry"
            onAction={() => sendFailure?.retry()}
            onDismiss={() => setSendFailure(null)}
            testID="channel-send-snackbar"
          />
        </View>
        {active ? (
          <ChannelComposer
            // Keyed per channel. Without it an unsent draft — and a failed-send
            // error — follow her into the next channel and post there.
            key={active.id}
            placeholder={`Message # ${active.slug}`}
            onSend={handleSend}
            onSendFailed={(message, retry) => setSendFailure({ message, retry })}
            onTyping={sendTyping}
            onStopTyping={stopTyping}
            disabled={!user?.id}
            disabledReason="Sign in to post here."
          />
        ) : null}
      </KeyboardTrackingView>

      <ChannelMessageActions
        title={menuFor ? authorName(menuFor.author) : ''}
        actions={menuFor ? menuActions(menuFor) : []}
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        header={menuFor && !menuFor.deleted_at && me ? (
          <View style={s.reactRow}>
            {SHEET_EMOJIS.map((emoji) => (
              <PressableScale
                key={emoji}
                style={s.reactHit}
                onPress={() => { const id = menuFor.id; setMenuFor(null); reactFromMenu(id, emoji); }}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
              >
                <Text style={s.reactEmoji}>{emoji}</Text>
              </PressableScale>
            ))}
            <PressableScale
              style={s.reactHit}
              onPress={() => { const id = menuFor.id; setMenuFor(null); setReactAnyFor(id); }}
              accessibilityRole="button"
              accessibilityLabel="Choose any emoji"
            >
              <Ionicons name="add" size={22} color={colors.textPrimary} />
            </PressableScale>
          </View>
        ) : null}
      />

      {reactAnyFor ? (
        <EmojiKeyboard
          open
          onClose={() => setReactAnyFor(null)}
          onEmojiSelected={({ emoji }: { emoji: string }) => {
            const target = reactAnyFor;
            setReactAnyFor(null);
            if (target) reactFromMenu(target, emoji);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
