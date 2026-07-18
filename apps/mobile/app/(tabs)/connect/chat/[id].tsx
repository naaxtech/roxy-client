import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
  Modal, FlatList, Image, Pressable, Keyboard, ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useConnectStore } from '../../../../store/connectStore';
import { useRealtime } from '../../../../hooks/useRealtime';
import { useReactions } from '../../../../hooks/useReactions';
import { useTyping } from '../../../../hooks/useTyping';
import { useSafetyStore } from '../../../../store/safetyStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { Analytics } from '../../../../lib/analytics';
import { Message } from '../../../../types';
import EmojiKeyboard from 'rn-emoji-keyboard';
import { ActionTray } from '../../../../components/chat/ActionTray';
import { GifPicker } from '../../../../components/chat/GifPicker';
import { QuickReactBar, ReactionChips } from '../../../../components/chat/ReactionBar';
import { TypingIndicator } from '../../../../components/chat/TypingIndicator';
import { isOnline } from '../../../../store/friendStore';
import { avatarGradient } from '../../../../lib/avatars';

function formatTimeSep(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`;
  return format(d, 'EEE, MMM d · HH:mm');
}

const REPORT_REASONS: {
  key: 'harassment' | 'spam' | 'inappropriate' | 'hate_speech' | 'other';
  label: string;
}[] = [
  { key: 'harassment', label: 'Harassment' },
  { key: 'spam', label: 'Spam' },
  { key: 'inappropriate', label: 'Inappropriate content' },
  { key: 'hate_speech', label: 'Hate speech' },
  { key: 'other', label: 'Other' },
];

type PartnerProfile = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  last_seen_at: string | null;
};

type MessageWithGroup = Message & {
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showTimestamp: boolean;
};

const AVA_SIZE = 32;
const AVA_GAP = 8;

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { clearUnread, conversations, setActiveConversation } = useConnectStore();
  const { blockUser, openReportModal, submitReport } = useSafetyStore();
  const colors = useThemeColors();

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [wingwomanLoading, setWingwomanLoading] = useState(false);
  const [nudgeLoading, setNudgeLoading] = useState(false);
  const [icebreaker, setIcebreaker] = useState<string | null>(null);
  const listRef = useRef<FlatList<MessageWithGroup>>(null);

  const [partnerProfile, setPartnerProfile] = useState<PartnerProfile | null>(null);
  const partnerName = partnerProfile?.display_name || partnerProfile?.username || 'Chat';
  const partnerGrad = useMemo(() => avatarGradient(partnerName), [partnerName]);
  const partnerIsOnline = isOnline(partnerProfile?.last_seen_at ?? null);

  const [showTray, setShowTray] = useState(false);
  const [showEmojiKeyboard, setShowEmojiKeyboard] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [reactingToMessage, setReactingToMessage] = useState<string | null>(null);

  const [menuVisible, setMenuVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportReason, setReportReason] = useState<
    'harassment' | 'spam' | 'inappropriate' | 'hate_speech' | 'other' | null
  >(null);
  const [reportDetail, setReportDetail] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const { messages, isSubscribed: _isSubscribed, appendMessage, replaceMessageId, removeMessage } = useRealtime({
    conversationId: conversationId ?? '',
    initialMessages,
    currentUserId: user?.id ?? '',
  });

  const messageIds = messages.map((m) => m.id);
  const { reactionsMap, addReaction, removeReaction } = useReactions({
    conversationId: conversationId ?? '',
    messageIds,
  });

  const { partnerIsTyping, sendTyping } = useTyping({
    conversationId: conversationId ?? '',
    currentUserId: user?.id ?? '',
    partnerName,
  });

  // Build grouped messages with per-item display metadata
  const groupedMessages = useMemo((): MessageWithGroup[] => {
    const base = searchActive && searchQuery.trim()
      ? messages.filter((m) => m.content?.toLowerCase().includes(searchQuery.toLowerCase()))
      : messages;

    return base.map((msg, i) => {
      const prev = base[i - 1];
      const next = base[i + 1];
      const isRoxy = msg.message_type === 'roxy_suggestion';
      const prevBreaks = !prev || prev.message_type === 'roxy_suggestion' || prev.sender_id !== msg.sender_id;
      const nextBreaks = !next || next.message_type === 'roxy_suggestion' || next.sender_id !== msg.sender_id;

      const isFirstInGroup = isRoxy || prevBreaks;
      const isLastInGroup = isRoxy || nextBreaks;
      const showTimestamp =
        !prev ||
        new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60 * 1000;

      return { ...msg, isFirstInGroup, isLastInGroup, showTimestamp };
    });
  }, [messages, searchActive, searchQuery]);

  // Reversed for inverted FlatList — newest first renders at visual bottom
  const reversedMessages = useMemo(() => [...groupedMessages].reverse(), [groupedMessages]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    // Header
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surfaceLight,
      gap: 10,
    },
    backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    headerAvaWrap: { position: 'relative' },
    headerAva: {
      width: 38, height: 38, borderRadius: 19,
      alignItems: 'center', justifyContent: 'center',
    },
    headerAvaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    headerOnlineDot: {
      position: 'absolute', bottom: 0, right: 0,
      width: 11, height: 11, borderRadius: 6,
      backgroundColor: '#22C55E', borderWidth: 2, borderColor: colors.background,
    },
    headerCenter: { flex: 1 },
    headerName: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    headerSub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    headerActions: { flexDirection: 'row', gap: 2 },
    headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

    // Search header
    searchInput: {
      flex: 1, backgroundColor: colors.surface, borderRadius: 20,
      paddingHorizontal: 14, paddingVertical: 8, color: colors.textPrimary, fontSize: 14,
    },
    searchCancelText: { color: colors.primary, fontWeight: '600', marginLeft: 6 },

    // Icebreaker
    iceBanner: {
      backgroundColor: colors.roxy + '18', borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.roxy + '40', paddingHorizontal: 16, paddingVertical: 10,
    },
    iceLabel: { color: colors.roxy, fontSize: 11, fontWeight: '700', marginBottom: 2 },
    iceText: { color: colors.textPrimary, fontSize: 13, fontStyle: 'italic' },

    // Error
    errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    errorText: { color: colors.textMuted, fontSize: 15 },
    retryBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 },
    retryBtnText: { color: '#fff', fontWeight: '700' },

    // List
    listContent: { paddingVertical: 12, paddingHorizontal: 12 },

    timeSep: {
      alignSelf: 'center', color: colors.textMuted, fontSize: 11,
      marginVertical: 8, fontWeight: '500',
    },

    // Message rows
    msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 1 },
    msgRowOwn: { justifyContent: 'flex-end' },
    msgRowOther: { justifyContent: 'flex-start' },

    avaSlot: { width: AVA_SIZE + AVA_GAP, alignItems: 'flex-start' },
    msgAva: {
      width: AVA_SIZE, height: AVA_SIZE, borderRadius: AVA_SIZE / 2,
      alignItems: 'center', justifyContent: 'center',
    },
    msgAvaText: { color: '#fff', fontWeight: '700', fontSize: 13 },

    // Bubbles
    bubble: { maxWidth: '76%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
    bubbleOwn: { backgroundColor: colors.primary },
    bubbleOther: { backgroundColor: colors.surface },
    bubbleOwnLast: { borderBottomRightRadius: 4 },
    bubbleOtherLast: { borderBottomLeftRadius: 4 },
    bubbleHighlighted: { borderWidth: 2, borderColor: colors.primary + '80' },

    bubbleText: { fontSize: 15, lineHeight: 21 },
    bubbleTextOwn: { color: '#fff' },
    bubbleTextOther: { color: colors.textPrimary },

    gifImage: { width: 200, height: 150, borderRadius: 10 },

    bubbleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3, marginTop: 4 },
    bubbleTime: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
    bubbleTimeOther: { color: colors.textMuted },
    readTick: { fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: '700' },
    readTickRead: { color: 'rgba(255,255,255,0.95)' },

    // Roxy suggestion
    roxyBubble: {
      alignSelf: 'center', backgroundColor: colors.roxy + '14',
      borderRadius: 16, borderWidth: 1, borderColor: colors.roxy + '40',
      padding: 14, marginVertical: 6, width: '88%',
    },
    roxyLabel: { color: colors.roxy, fontSize: 11, fontWeight: '700', marginBottom: 6 },
    roxyText: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
    roxyUseBtnRow: { marginTop: 10 },
    roxyUseBtn: {
      alignSelf: 'flex-start', backgroundColor: colors.roxy,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7,
    },
    roxyUseBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

    emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },

    // Input bar
    inputWrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.surfaceLight,
      backgroundColor: colors.background,
    },
    inputBar: {
      flexDirection: 'row', alignItems: 'flex-end', gap: 8,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    roxyBtn: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.roxy + '50',
      alignItems: 'center', justifyContent: 'center', marginBottom: 2,
    },
    roxyBtnActive: { backgroundColor: colors.roxy + '18', borderColor: colors.roxy },
    inlineEmojiContainer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.surfaceLight },
    input: {
      flex: 1, backgroundColor: colors.surface, borderRadius: 20,
      paddingHorizontal: 16, paddingVertical: 10,
      color: colors.textPrimary, fontSize: 15, maxHeight: 120,
    },
    sendBtn: {
      width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center', marginBottom: 2,
    },
    sendBtnDisabled: { backgroundColor: colors.surfaceLight },

    // Reaction overlay
    reactOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
    reactBarContainer: { position: 'absolute', bottom: 120, alignSelf: 'center' },

    // Modals
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    actionSheet: {
      backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingBottom: 34, paddingTop: 8,
    },
    actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16, gap: 14 },
    actionRowText: { color: colors.textPrimary, fontSize: 16 },
    actionRowTextDanger: { color: colors.error, fontSize: 16, fontWeight: '600' },
    actionSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceLight, marginHorizontal: 16 },
    reportCard: {
      backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 24, paddingBottom: 40,
    },
    reportTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 4 },
    reportSubtitle: { color: colors.textSecondary, fontSize: 14, marginBottom: 16 },
    reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 10 },
    reasonRowSelected: { backgroundColor: colors.primary + '20' },
    reasonRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.textMuted },
    reasonRadioSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
    reasonLabel: { color: colors.textPrimary, fontSize: 15 },
    reasonSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceLight },
    reportDetailInput: {
      backgroundColor: colors.surfaceLight, borderRadius: 12, padding: 12,
      color: colors.textPrimary, fontSize: 14, minHeight: 72, marginTop: 16, textAlignVertical: 'top',
    },
    reportActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
    reportCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.surfaceLight, alignItems: 'center' },
    reportCancelText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
    reportSubmitBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
    reportSubmitBtnDisabled: { backgroundColor: colors.textMuted },
    reportSubmitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });

  useEffect(() => {
    setActiveConversation(conversationId ?? null);
    return () => setActiveConversation(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    setInitialMessages([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !user) return;
    const resolve = async (participantIds: string[]) => {
      const pid = participantIds.find((id) => id !== user.id) ?? null;
      if (!pid) return;
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, username, avatar_url, last_seen_at')
        .eq('id', pid)
        .single();
      if (data) setPartnerProfile(data as PartnerProfile);
    };
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      void resolve(conv.participant_ids);
    } else {
      void (async () => {
        try {
          const { data } = await supabase
            .from('conversations')
            .select('participant_ids')
            .eq('id', conversationId)
            .single();
          if (data) void resolve(data.participant_ids);
        } catch {}
      })();
    }
  }, [conversationId, user, conversations]);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    setLoadingInitial(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      if (data) {
        setInitialMessages(data as Message[]);
        const icebreakerMsg = data.find((m) => m.message_type === 'roxy_suggestion');
        if (icebreakerMsg) setIcebreaker(icebreakerMsg.content);
      }
      if (user && data) {
        await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('conversation_id', conversationId)
          .neq('sender_id', user.id)
          .eq('is_read', false);
        clearUnread(conversationId);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoadingInitial(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, user]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  // With inverted FlatList, scroll to offset 0 = newest = visual bottom
  useEffect(() => {
    if (messages.length > 0 && !searchActive) {
      setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 80);
    }
  }, [messages.length, searchActive]);

  const sendMessage = async (content: string, type: Message['message_type'] = 'text', mediaUrl?: string) => {
    if ((!content.trim() && !mediaUrl) || !user || !conversationId) return;
    setSending(true);
    const optimisticMsg: Message = {
      id: `tmp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: user.id,
      content: content.trim() || null,
      media_url: mediaUrl ?? null,
      message_type: type,
      is_read: false,
      created_at: new Date().toISOString(),
    };
    appendMessage(optimisticMsg);
    setInputText('');

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        content: content.trim() || null,
        media_url: mediaUrl ?? null,
        message_type: type,
      })
      .select('id')
      .single();

    if (error) {
      removeMessage(optimisticMsg.id);
      Alert.alert(
        'Message not sent',
        'Could not deliver your message.',
        [
          { text: 'Dismiss', style: 'cancel' },
          { text: 'Retry', onPress: () => void sendMessage(content, type, mediaUrl) },
        ]
      );
    } else if (inserted?.id) {
      replaceMessageId(optimisticMsg.id, inserted.id);
      Analytics.messageSent(conversationId);
      supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId)
        .then(null, () => {});
    }
    setSending(false);
  };

  const handleGifSelected = async (url: string) => {
    await sendMessage('', 'image', url);
  };

  const handleWingwoman = async () => {
    if (!conversationId) return;
    setWingwomanLoading(true);
    try {
      const history = messages
        .filter((m) => m.message_type === 'text' && m.content)
        .slice(-6)
        .map((m) => ({
          sender: m.sender_id === user?.id ? 'Me' : 'Them',
          content: m.content ?? '',
        }));
      const { data, error } = await callEdgeFunction<{ suggestion: string }>('roxy-wingwoman', {
        conversation_id: conversationId,
        message_history: history,
        current_message: inputText || 'I want to keep the conversation going',
      });
      if (error) { Alert.alert('Wingwoman unavailable', error); return; }
      if (data?.suggestion) {
        appendMessage({
          id: `roxy-${Date.now()}`,
          conversation_id: conversationId,
          sender_id: null,
          content: data.suggestion,
          media_url: null,
          message_type: 'roxy_suggestion',
          is_read: true,
          created_at: new Date().toISOString(),
        });
      }
    } catch {
      Alert.alert('Error', 'Failed to get suggestion. Please try again.');
    } finally {
      setWingwomanLoading(false);
    }
  };

  const handleNudge = async () => {
    if (!conversationId) return;
    setNudgeLoading(true);
    try {
      const { data, error } = await callEdgeFunction<{ nudge: string }>('roxy-nudge', {
        conversation_id: conversationId,
      });
      if (error) {
        Alert.alert('Roxy Nudge', "Nudge limit reached for this conversation, but you've got this! 💜");
        return;
      }
      if (data?.nudge) setInputText(data.nudge);
    } catch {
      Alert.alert('Error', 'Failed to get nudge. Please try again.');
    } finally {
      setNudgeLoading(false);
    }
  };

  const handleBlockPress = () => {
    setMenuVisible(false);
    Alert.alert(
      `Block ${partnerName}?`,
      "They won't be able to message you and you won't see their profile.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block', style: 'destructive',
          onPress: async () => {
            if (!partnerProfile?.id) return;
            try {
              await blockUser(partnerProfile.id);
              router.back();
            } catch {
              Alert.alert('Error', 'Could not block user. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleReportPress = () => {
    setMenuVisible(false);
    setReportReason(null);
    setReportDetail('');
    if (partnerProfile?.id) openReportModal({ userId: partnerProfile.id, contentType: 'message' });
    setReportVisible(true);
  };

  const handleReportSubmit = async () => {
    if (!reportReason || !partnerProfile?.id) return;
    setReportSubmitting(true);
    try {
      await submitReport(reportReason, reportDetail.trim() || undefined);
      setReportVisible(false);
      Alert.alert('Report submitted', 'Thank you for keeping our community safe 💜');
    } catch {
      Alert.alert('Error', 'Could not submit report. Please try again.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleLongPress = (messageId: string) => setReactingToMessage(messageId);

  const handleReact = async (emoji: string) => {
    if (!reactingToMessage || !user) return;
    const existing = (reactionsMap[reactingToMessage] ?? []).find(
      (r) => r.user_id === user.id && r.emoji === emoji
    );
    if (existing) {
      await removeReaction(reactingToMessage, emoji, user.id);
    } else {
      await addReaction(reactingToMessage, emoji, user.id);
    }
    setReactingToMessage(null);
  };

  const handleReactionToggle = async (messageId: string, emoji: string, isOwn: boolean) => {
    if (!user) return;
    if (isOwn) {
      await removeReaction(messageId, emoji, user.id);
    } else {
      await addReaction(messageId, emoji, user.id);
    }
  };

  const renderItem: ListRenderItem<MessageWithGroup> = ({ item }) => {
    const isOwn = item.sender_id === user?.id;
    const isRoxy = item.message_type === 'roxy_suggestion';
    const isImage = item.message_type === 'image';
    const reactions = reactionsMap[item.id] ?? [];
    const isHighlighted = searchActive && searchQuery.trim()
      ? (item.content?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      : false;

    // Timestamp separator — in inverted FlatList, isFirstInGroup items are oldest in group
    // and render at the top of the visual group, so timestamp sits above them naturally.
    const timeSep = item.showTimestamp ? (
      <Text style={styles.timeSep}>{formatTimeSep(item.created_at)}</Text>
    ) : null;

    if (isRoxy) {
      return (
        <View>
          {timeSep}
          <Pressable onLongPress={() => handleLongPress(item.id)} delayLongPress={400}>
            <View style={[styles.roxyBubble, isHighlighted && styles.bubbleHighlighted]}>
              <Text style={styles.roxyLabel}>✨ Roxy suggests</Text>
              <Text style={styles.roxyText}>{item.content}</Text>
              <View style={styles.roxyUseBtnRow}>
                <TouchableOpacity style={styles.roxyUseBtn} onPress={() => setInputText(item.content ?? '')}>
                  <Text style={styles.roxyUseBtnText}>Use this</Text>
                </TouchableOpacity>
              </View>
            </View>
            {reactions.length > 0 && (
              <ReactionChips
                reactions={reactions}
                currentUserId={user?.id ?? ''}
                onToggle={(emoji, own) => void handleReactionToggle(item.id, emoji, own)}
              />
            )}
          </Pressable>
        </View>
      );
    }

    return (
      <View>
        {timeSep}
        <Pressable onLongPress={() => handleLongPress(item.id)} delayLongPress={400}>
          <View style={[styles.msgRow, isOwn ? styles.msgRowOwn : styles.msgRowOther]}>
            {/* Avatar slot on left for partner messages; shown only for last in group */}
            {!isOwn && (
              <View style={styles.avaSlot}>
                {item.isLastInGroup && (
                  <LinearGradient colors={partnerGrad} style={styles.msgAva}>
                    <Text style={styles.msgAvaText}>
                      {partnerName[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </LinearGradient>
                )}
              </View>
            )}

            <View style={[
              styles.bubble,
              isOwn ? styles.bubbleOwn : styles.bubbleOther,
              isOwn && item.isLastInGroup && styles.bubbleOwnLast,
              !isOwn && item.isLastInGroup && styles.bubbleOtherLast,
              isHighlighted && styles.bubbleHighlighted,
            ]}>
              {isImage && item.media_url ? (
                <Image source={{ uri: item.media_url }} style={styles.gifImage} resizeMode="cover" />
              ) : (
                <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
                  {item.content}
                </Text>
              )}
              <View style={styles.bubbleMeta}>
                <Text style={[styles.bubbleTime, !isOwn && styles.bubbleTimeOther]}>
                  {format(new Date(item.created_at), 'HH:mm')}
                </Text>
                {isOwn && (
                  <Text style={[styles.readTick, item.is_read && styles.readTickRead]}>
                    {item.is_read ? '✓✓' : '✓'}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {reactions.length > 0 && (
            <View style={{ paddingLeft: isOwn ? 0 : AVA_SIZE + AVA_GAP }}>
              <ReactionChips
                reactions={reactions}
                currentUserId={user?.id ?? ''}
                onToggle={(emoji, own) => void handleReactionToggle(item.id, emoji, own)}
              />
            </View>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      {searchActive ? (
        <View style={styles.header}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search messages..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          <TouchableOpacity onPress={() => { setSearchActive(false); setSearchQuery(''); }}>
            <Text style={styles.searchCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => partnerProfile?.id && router.push(`/user/${partnerProfile.id}` as any)}
            disabled={!partnerProfile?.id}
            style={styles.headerAvaWrap}
          >
            <LinearGradient colors={partnerGrad} style={styles.headerAva}>
              <Text style={styles.headerAvaText}>{partnerName[0]?.toUpperCase() ?? '?'}</Text>
            </LinearGradient>
            {partnerIsOnline && <View style={styles.headerOnlineDot} />}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => partnerProfile?.id && router.push(`/user/${partnerProfile.id}` as any)}
            disabled={!partnerProfile?.id}
            style={styles.headerCenter}
          >
            <Text style={styles.headerName} numberOfLines={1}>{partnerName}</Text>
            <Text style={styles.headerSub}>{partnerIsOnline ? 'Online now' : 'Tap to view profile'}</Text>
          </TouchableOpacity>

          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setSearchActive(true)}>
              <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn} onPress={() => setMenuVisible(true)}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {icebreaker && !searchActive && (
        <View style={styles.iceBanner}>
          <Text style={styles.iceLabel}>✨ Roxy's icebreaker</Text>
          <Text style={styles.iceText}>{icebreaker}</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {loadingInitial ? (
          <ActivityIndicator color={colors.roxy} style={{ flex: 1 }} />
        ) : loadError ? (
          <View style={styles.errorState}>
            <Text style={styles.errorText}>Could not load messages</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void loadMessages()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={styles.listContent}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {searchActive ? 'No messages match your search.' : 'Send your first message 💜'}
              </Text>
            }
          />
        )}

        <TypingIndicator partnerName={partnerName} visible={partnerIsTyping} />

        <View style={styles.inputWrap}>
          {showTray && (
            <ActionTray
              onEmojiPress={() => {
                Keyboard.dismiss();
                setShowEmojiKeyboard((v) => !v);
              }}
              onGifPress={() => {
                setShowTray(false);
                setShowEmojiKeyboard(false);
                setShowGifPicker(true);
              }}
              onWingwomanPress={() => {
                setShowTray(false);
                void handleWingwoman();
              }}
              onNudgePress={() => {
                setShowTray(false);
                void handleNudge();
              }}
              wingwomanLoading={wingwomanLoading}
              nudgeLoading={nudgeLoading}
            />
          )}

          {showEmojiKeyboard && (
            <View style={styles.inlineEmojiContainer}>
              <EmojiKeyboard
                open={showEmojiKeyboard}
                onClose={() => setShowEmojiKeyboard(false)}
                onEmojiSelected={({ emoji }: { emoji: string }) => {
                  setInputText((prev) => prev + emoji);
                }}
                expandable={false}
                styles={{ container: { height: 300 } }}
              />
            </View>
          )}

          <View style={styles.inputBar}>
            <TouchableOpacity
              style={[styles.roxyBtn, showTray && styles.roxyBtnActive]}
              onPress={() => { setShowTray((v) => !v); setShowEmojiKeyboard(false); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Roxy wingwoman tools"
            >
              <Ionicons name="sparkles" size={16} color={colors.roxy} />
            </TouchableOpacity>

            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Say something..."
              placeholderTextColor={colors.textMuted}
              value={inputText}
              onChangeText={(t) => { setInputText(t); sendTyping(); }}
              onFocus={() => setShowEmojiKeyboard(false)}
              multiline
              maxLength={2000}
            />

            <TouchableOpacity
              style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
              onPress={() => void sendMessage(inputText)}
              disabled={!inputText.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={17} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Reaction quick-pick overlay */}
      {reactingToMessage && (
        <Modal transparent animationType="fade" onRequestClose={() => setReactingToMessage(null)}>
          <TouchableOpacity
            style={styles.reactOverlay}
            activeOpacity={1}
            onPress={() => setReactingToMessage(null)}
          >
            <View style={styles.reactBarContainer}>
              <QuickReactBar onReact={(emoji) => void handleReact(emoji)} />
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      <GifPicker
        visible={showGifPicker}
        onGifSelected={(url) => void handleGifSelected(url)}
        onClose={() => setShowGifPicker(false)}
      />

      {/* Context menu */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.actionSheet}>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => { setMenuVisible(false); setSearchActive(true); }}
            >
              <Ionicons name="search-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.actionRowText}>Search messages</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            <TouchableOpacity style={styles.actionRow} onPress={handleBlockPress}>
              <Ionicons name="ban-outline" size={18} color={colors.error} />
              <Text style={styles.actionRowTextDanger}>Block {partnerName}</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            <TouchableOpacity style={styles.actionRow} onPress={handleReportPress}>
              <Ionicons name="flag-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.actionRowText}>Report conversation</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            <TouchableOpacity style={styles.actionRow} onPress={() => setMenuVisible(false)}>
              <Text style={[styles.actionRowText, { textAlign: 'center', flex: 1, color: colors.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report modal */}
      <Modal visible={reportVisible} transparent animationType="slide" onRequestClose={() => setReportVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report</Text>
            <Text style={styles.reportSubtitle}>What's the issue?</Text>
            <FlatList
              data={REPORT_REASONS}
              keyExtractor={(item) => item.key}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.reasonRow, reportReason === item.key && styles.reasonRowSelected]}
                  onPress={() => setReportReason(item.key)}
                >
                  <View style={[styles.reasonRadio, reportReason === item.key && styles.reasonRadioSelected]} />
                  <Text style={styles.reasonLabel}>{item.label}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.reasonSeparator} />}
            />
            <TextInput
              style={styles.reportDetailInput}
              placeholder="Add details (optional)"
              placeholderTextColor={colors.textMuted}
              value={reportDetail}
              onChangeText={setReportDetail}
              multiline
              maxLength={500}
            />
            <View style={styles.reportActions}>
              <TouchableOpacity style={styles.reportCancelBtn} onPress={() => setReportVisible(false)}>
                <Text style={styles.reportCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportSubmitBtn, (!reportReason || !partnerProfile?.id || reportSubmitting) && styles.reportSubmitBtnDisabled]}
                onPress={() => void handleReportSubmit()}
                disabled={!reportReason || !partnerProfile?.id || reportSubmitting}
              >
                {reportSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.reportSubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
