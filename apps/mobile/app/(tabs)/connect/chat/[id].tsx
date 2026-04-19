import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
  Modal, FlatList, Image, Pressable, Keyboard,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useConnectStore } from '../../../../store/connectStore';
import { useRealtime } from '../../../../hooks/useRealtime';
import { useReactions } from '../../../../hooks/useReactions';
import { useTyping } from '../../../../hooks/useTyping';
import { useSafetyStore } from '../../../../store/safetyStore';
import { COLORS } from '../../../../lib/constants';
import { Analytics } from '../../../../lib/analytics';
import { Message } from '../../../../types';
import EmojiKeyboard from 'rn-emoji-keyboard';
import { ActionTray } from '../../../../components/chat/ActionTray';
import { GifPicker } from '../../../../components/chat/GifPicker';
import { QuickReactBar, ReactionChips } from '../../../../components/chat/ReactionBar';
import { TypingIndicator } from '../../../../components/chat/TypingIndicator';

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

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { clearUnread, conversations, setActiveConversation } = useConnectStore();
  const { blockUser, openReportModal, submitReport } = useSafetyStore();

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [wingwomanLoading, setWingwomanLoading] = useState(false);
  const [nudgeLoading, setNudgeLoading] = useState(false);
  const [icebreaker, setIcebreaker] = useState<string | null>(null);
  const flashListRef = useRef<FlashList<Message>>(null);

  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>('Chat');

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

  useEffect(() => {
    setActiveConversation(conversationId ?? null);
    return () => setActiveConversation(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Reset messages when navigating to a different conversation
  useEffect(() => {
    setInitialMessages([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !user) return;
    const resolvePartner = async (participantIds: string[]) => {
      const pid = participantIds.find((id) => id !== user.id) ?? null;
      setPartnerId(pid);
      if (!pid) return;
      const { data } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', pid)
        .single();
      if (data) setPartnerName(data.display_name || data.username || 'Chat');
    };
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      void resolvePartner(conv.participant_ids);
    } else {
      void (async () => {
        try {
          const { data } = await supabase
            .from('conversations')
            .select('participant_ids')
            .eq('id', conversationId)
            .single();
          if (data) void resolvePartner(data.participant_ids);
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

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flashListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const displayedMessages = searchActive && searchQuery.trim()
    ? messages.filter((m) =>
        m.content?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

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
      // Update conversation list order (fire-and-forget, non-critical)
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
        const suggestionMsg: Message = {
          id: `roxy-${Date.now()}`,
          conversation_id: conversationId,
          sender_id: null,
          content: data.suggestion,
          media_url: null,
          message_type: 'roxy_suggestion',
          is_read: true,
          created_at: new Date().toISOString(),
        };
        appendMessage(suggestionMsg);
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
            if (!partnerId) return;
            try {
              await blockUser(partnerId);
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
    if (partnerId) openReportModal({ userId: partnerId, contentType: 'message' });
    setReportVisible(true);
  };

  const handleReportSubmit = async () => {
    if (!reportReason || !partnerId) return;
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

  const handleLongPress = (messageId: string) => {
    setReactingToMessage(messageId);
  };

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

  const renderItem = ({ item }: { item: Message }) => {
    const isOwn = item.sender_id === user?.id;
    const isRoxy = item.message_type === 'roxy_suggestion';
    const isImage = item.message_type === 'image';
    const reactions = reactionsMap[item.id] ?? [];
    const isHighlighted = searchActive && searchQuery.trim()
      ? (item.content?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      : false;

    return (
      <Pressable
        onLongPress={() => !isRoxy && handleLongPress(item.id)}
        delayLongPress={400}
      >
        <View style={[
          styles.bubble,
          isOwn && !isRoxy ? styles.bubbleOwn : styles.bubbleOther,
          isRoxy && styles.bubbleRoxy,
          isHighlighted && styles.bubbleHighlighted,
        ]}>
          {isRoxy && <Text style={styles.roxyLabel}>✨ Roxy suggests</Text>}

          {isImage && item.media_url ? (
            <Image
              source={{ uri: item.media_url }}
              style={styles.gifImage}
              resizeMode="cover"
            />
          ) : (
            <Text style={[styles.bubbleText, isOwn && !isRoxy ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
              {item.content}
            </Text>
          )}

          {isRoxy && (
            <View style={styles.roxyActions}>
              <TouchableOpacity style={styles.roxyUseBtn} onPress={() => setInputText(item.content ?? '')}>
                <Text style={styles.roxyUseBtnText}>Use this</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.bubbleMeta}>
            <Text style={styles.bubbleTime}>{format(new Date(item.created_at), 'HH:mm')}</Text>
            {isOwn && !isRoxy && (
              <Text style={[styles.readTick, item.is_read && styles.readTickRead]}>
                {item.is_read ? '✓✓' : '✓'}
              </Text>
            )}
          </View>
        </View>

        {reactions.length > 0 && (
          <ReactionChips
            reactions={reactions}
            currentUserId={user?.id ?? ''}
            onToggle={(emoji, isOwn) => void handleReactionToggle(item.id, emoji, isOwn)}
          />
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        {searchActive ? (
          <>
            <TextInput
              style={styles.searchInput}
              placeholder="Search messages..."
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            <TouchableOpacity onPress={() => { setSearchActive(false); setSearchQuery(''); }}>
              <Text style={styles.searchCancelText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backText}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => partnerId && router.push(`/user/${partnerId}` as any)}
              disabled={!partnerId}
              style={{ flex: 1 }}
            >
              <Text style={styles.headerTitle} numberOfLines={1}>{partnerName}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => setMenuVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.menuBtnText}>•••</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {icebreaker && !searchActive && (
        <View style={styles.icebreakerBanner}>
          <Text style={styles.icebreakerLabel}>✨ Roxy's icebreaker</Text>
          <Text style={styles.icebreakerText}>{icebreaker}</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loadingInitial ? (
          <ActivityIndicator color={COLORS.roxy} style={{ flex: 1 }} />
        ) : loadError ? (
          <View style={styles.errorState}>
            <Text style={styles.errorText}>Could not load messages</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void loadMessages()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlashList
            ref={flashListRef}
            data={displayedMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            estimatedItemSize={60}
            contentContainerStyle={styles.messageList}
            style={{ flex: 1 }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {searchActive ? 'No messages match your search.' : 'Send your first message!'}
              </Text>
            }
          />
        )}

        <TypingIndicator partnerName={partnerName} visible={partnerIsTyping} />

        <View>
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
              onPress={() => {
                setShowTray((v) => !v);
                setShowEmojiKeyboard(false);
              }}
              hitSlop={8}
            >
              <Text style={styles.roxyBtnText}>✦</Text>
            </TouchableOpacity>

            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Say something..."
              placeholderTextColor={COLORS.textMuted}
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
                <Text style={styles.sendBtnText}>›</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

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

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.actionSheet}>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => { setMenuVisible(false); setSearchActive(true); }}
            >
              <Text style={styles.actionRowIcon}>⌕</Text>
              <Text style={styles.actionRowText}>Search messages</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            <TouchableOpacity style={styles.actionRow} onPress={handleBlockPress}>
              <Text style={styles.actionRowIconDanger}>⛔</Text>
              <Text style={styles.actionRowTextDanger}>Block {partnerName}</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            <TouchableOpacity style={styles.actionRow} onPress={handleReportPress}>
              <Text style={styles.actionRowIcon}>🚩</Text>
              <Text style={styles.actionRowText}>Report conversation</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            <TouchableOpacity style={styles.actionRow} onPress={() => setMenuVisible(false)}>
              <Text style={[styles.actionRowText, { textAlign: 'center', flex: 1, color: COLORS.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
              placeholderTextColor={COLORS.textMuted}
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
                style={[styles.reportSubmitBtn, (!reportReason || !partnerId || reportSubmitting) && styles.reportSubmitBtnDisabled]}
                onPress={() => void handleReportSubmit()}
                disabled={!reportReason || !partnerId || reportSubmitting}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { width: 40 },
  backText: { color: COLORS.textPrimary, fontSize: 28, lineHeight: 30 },
  headerTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 17, textAlign: 'center' },
  menuBtn: { padding: 4 },
  menuBtnText: { color: COLORS.textPrimary, fontSize: 16, letterSpacing: 1 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, color: COLORS.textPrimary, fontSize: 14,
  },
  searchCancelText: { color: COLORS.primary, fontWeight: '600', marginLeft: 10 },
  icebreakerBanner: {
    backgroundColor: COLORS.roxy + '20', borderBottomWidth: 1, borderBottomColor: COLORS.roxy + '40',
    padding: 12,
  },
  icebreakerLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  icebreakerText: { color: COLORS.textPrimary, fontSize: 14, fontStyle: 'italic' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { color: COLORS.textMuted, fontSize: 15 },
  retryBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 10,
  },
  retryBtnText: { color: '#fff', fontWeight: '700' },
  messageList: { padding: 16, gap: 8 },
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 12, marginVertical: 2 },
  bubbleOwn: { alignSelf: 'flex-end', backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  bubbleRoxy: { alignSelf: 'center', backgroundColor: COLORS.roxy + '20', borderRadius: 12, borderWidth: 1, borderColor: COLORS.roxy + '60', width: '90%' },
  bubbleHighlighted: { borderWidth: 2, borderColor: COLORS.primary + '80' },
  roxyLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: '#fff' },
  bubbleTextOther: { color: COLORS.textPrimary },
  gifImage: { width: 200, height: 150, borderRadius: 8 },
  roxyActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roxyUseBtn: { backgroundColor: COLORS.roxy, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  roxyUseBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  bubbleTime: { color: COLORS.textMuted, fontSize: 10 },
  readTick: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700' },
  readTickRead: { color: COLORS.primary },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  roxyBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.roxy + '50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  roxyBtnActive: {
    backgroundColor: COLORS.roxy + '18',
    borderColor: COLORS.roxy,
  },
  roxyBtnText: {
    color: COLORS.roxy,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  inlineEmojiContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
  },
  input: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    color: COLORS.textPrimary, fontSize: 15, maxHeight: 120,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.surface },
  sendBtnText: { color: '#fff', fontSize: 24, lineHeight: 28 },
  reactOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  reactBarContainer: { position: 'absolute', bottom: 120, alignSelf: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  actionSheet: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 32, paddingTop: 8,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16, gap: 14 },
  actionRowIcon: { fontSize: 18 },
  actionRowIconDanger: { fontSize: 18 },
  actionRowText: { color: COLORS.textPrimary, fontSize: 16 },
  actionRowTextDanger: { color: COLORS.error, fontSize: 16, fontWeight: '600' },
  actionSeparator: { height: 1, backgroundColor: COLORS.surfaceLight, marginHorizontal: 16 },
  reportCard: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  reportTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  reportSubtitle: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 16 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 10 },
  reasonRowSelected: { backgroundColor: COLORS.primary + '20' },
  reasonRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: COLORS.textMuted },
  reasonRadioSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  reasonLabel: { color: COLORS.textPrimary, fontSize: 15 },
  reasonSeparator: { height: 1, backgroundColor: COLORS.surfaceLight },
  reportDetailInput: {
    backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 12,
    color: COLORS.textPrimary, fontSize: 14, minHeight: 72, marginTop: 16, textAlignVertical: 'top',
  },
  reportActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  reportCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: COLORS.surfaceLight, alignItems: 'center' },
  reportCancelText: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
  reportSubmitBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center' },
  reportSubmitBtnDisabled: { backgroundColor: COLORS.textMuted },
  reportSubmitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
