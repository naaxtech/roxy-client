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
import {
  fetchChannels, fetchChannelMessages, sendChannelMessage, initialChannel,
  type Channel, type ChannelMessage as Message,
} from '../../../../../lib/channels';

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
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<FlatList<Message>>(null);

  const loadChannels = useCallback(async () => {
    if (!communityId) return;
    try {
      const [rows, community] = await Promise.all([
        fetchChannels(communityId),
        supabase.from('communities').select('name').eq('id', communityId).maybeSingle(),
      ]);
      setChannels(rows);
      setActive(initialChannel(rows));
      setCommunityName(community.data?.name ?? '');
      setError(null);
    } catch (e) {
      logError(e, 'community_channels_load_failed');
      setError('Could not load this community’s channels.');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { void loadChannels(); }, [loadChannels]);

  const loadMessages = useCallback(async (channelId: string) => {
    setLoadingMessages(true);
    try {
      setMessages(await fetchChannelMessages(channelId));
      setError(null);
    } catch (e) {
      logError(e, 'community_channel_messages_failed');
      setError('Could not load this channel.');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (active) void loadMessages(active.id);
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
    const saved = await sendChannelMessage(active.id, user.id, body);
    // Appended from the RETURNED row, which is the only proof it exists.
    setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [active, user?.id]);

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
            testID={`channel-message-${item.id}`}
          />
        )}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
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
        />
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body()}
        {active ? (
          <ChannelComposer
            placeholder={`Message # ${active.slug}`}
            onSend={handleSend}
            disabled={!user?.id}
            disabledReason="Sign in to post here."
          />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
