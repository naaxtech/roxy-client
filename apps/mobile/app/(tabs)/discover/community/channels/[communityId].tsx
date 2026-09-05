import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable,
  KeyboardAvoidingView, Platform,
} from 'react-native';
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
  fetchChannels, fetchChannelMessages, sendChannelMessage, deleteChannelMessage,
  initialChannel, fetchMyChannelRole, writeFailureMessage, authorName, fetchLiveStage,
  type LiveStage,
  type Channel, type ChannelMessage as Message,
} from '../../../../../lib/channels';
import { useSafetyStore } from '../../../../../store/safetyStore';

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
  const { user } = useAuthStore();

  const [channels, setChannels] = useState<Channel[]>([]);
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

  const listRef = useRef<FlatList<Message>>(null);
  // Which channel the screen is actually showing. A fetch that resolves after
  // she has moved on must not paint its rows under another channel's name.
  const shownChannelId = useRef<string | null>(null);
  // Whether she is parked at the bottom. Yanking a woman who is reading
  // yesterday down to the newest message every time anyone posts is hostile.
  const atBottom = useRef(true);

  const { blockUser, openReportModal } = useSafetyStore();

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
        supabase.from('communities').select('name').eq('id', communityId).maybeSingle(),
      ]);
      setChannels(rows);
      setActive(initialChannel(rows));
      setCommunityName(community.data?.name ?? '');
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

  const loadMessages = useCallback(async (channelId: string) => {
    setLoadingMessages(true);
    try {
      const rows = await fetchChannelMessages(channelId);
      // She may have tapped another chip while this was in flight. Painting
      // these rows now puts one channel's messages under another's name, and a
      // reply typed against them posts to the room she is not looking at.
      if (shownChannelId.current !== channelId) return;
      setMessages(rows);
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
    setMessageError(null);
    void loadMessages(active.id);
  }, [active, loadMessages]);

  // Filtered by channel_id, never table-wide: a subscription to every message
  // in every community is the pattern CLAUDE.md §18 bans outright.
  useEffect(() => {
    if (!active) return undefined;
    const channel = supabase
      .channel(`community-channel-${active.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'community_channel_messages',
          filter: `channel_id=eq.${active.id}`,
        },
        () => {
          // Re-read rather than trusting the payload: the realtime row carries
          // no joined author, and rendering it would flash "Someone who left"
          // beside every incoming message.
          void loadMessages(active.id);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [active, loadMessages]);

  const handleSend = useCallback(async (body: string) => {
    if (!active || !user?.id) return;
    const target = active.id;
    const saved = await sendChannelMessage(target, user.id, body);
    // Only if she is still in the channel she sent to. Appending unconditionally
    // drew a #general message into #rants, where she read it as posted there
    // until the next refetch quietly took it away again.
    if (shownChannelId.current !== target) return;
    // Appended from the RETURNED row, which is the only proof it exists.
    setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
    atBottom.current = true;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [active, user?.id]);

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
        onPress: () => { void blockUser(message.sender_id as string); },
      });
    }

    return actions;
  }, [user?.id, isModerator, removeMessage, openReportModal, blockUser]);

  const s = StyleSheet.create({
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
  });

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
          <Pressable
            onPress={() => { setLoading(true); void loadChannels(); }}
            style={s.retryHit}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.retry}>Try again</Text>
          </Pressable>
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
          <Pressable
            onPress={() => { if (active) void loadMessages(active.id); }}
            style={s.retryHit}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.retry}>Try again</Text>
          </Pressable>
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

    if (messages.length === 0) {
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
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.list}
        renderItem={({ item }) => (
          <ChannelMessage
            message={item}
            onPressAuthor={(id) => router.push(`/user/${id}` as never)}
            onLongPress={(m) => setMenuFor(m)}
            testID={`channel-message-${item.id}`}
          />
        )}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          atBottom.current =
            contentOffset.y + layoutMeasurement.height >= contentSize.height - 60;
        }}
        scrollEventThrottle={16}
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
        <Pressable
          onPress={() => router.back()}
          style={s.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="channels-back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={s.headText}>
          <Text style={s.title} numberOfLines={1}>
            {communityName || 'Community'}
            {active ? <Text style={s.channelName}>{`  # ${active.slug}`}</Text> : null}
          </Text>
          {active?.topic ? (
            <Text style={s.subtitle} numberOfLines={1}>{active.topic}</Text>
          ) : null}
        </View>
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body()}
        {active ? (
          <ChannelComposer
            // Keyed per channel. Without it an unsent draft — and a failed-send
            // error — follow her into the next channel and post there.
            key={active.id}
            placeholder={`Message # ${active.slug}`}
            onSend={handleSend}
            disabled={!user?.id}
            disabledReason="Sign in to post here."
          />
        ) : null}
      </KeyboardAvoidingView>

      <ChannelMessageActions
        title={menuFor ? authorName(menuFor.author) : ''}
        actions={menuFor ? menuActions(menuFor) : []}
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
      />
    </SafeAreaView>
  );
}
