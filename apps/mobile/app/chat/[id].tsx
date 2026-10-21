import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Modal, FlatList, Keyboard, Pressable,
  type ListRenderItem, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { TouchableOpacity } from '../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import EmojiKeyboard from 'rn-emoji-keyboard';
import { supabase, callEdgeFunction } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useConnectStore } from '../../store/connectStore';
import { useSafetyStore } from '../../store/safetyStore';
import { isOnline } from '../../store/friendStore';
import { useRealtime, type ChatMessage } from '../../hooks/useRealtime';
import { useReactions } from '../../hooks/useReactions';
import { useTyping } from '../../hooks/useTyping';
import { useThreadMeta } from '../../hooks/useThreadMeta';
import { useThemeColors } from '../../hooks/useThemeColors';
import { showAlert, confirmAction } from '../../lib/confirm';
import { logError } from '../../lib/errorLogger';
import { Analytics } from '../../lib/analytics';
import { haptic } from '../../lib/haptics';
import { avatarGradient } from '../../lib/avatars';
import { BRAND_GRADIENT, inkOn, inkOnGradient, RADII, type ThemeColors } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { setActivePath as setActivePushPath } from '../../lib/pushRegistration';
import {
  insertMessage, editMessage, unsendMessage, newMessageId, chatErrorMessage,
  respondMessageRequest, muteConversation, fetchChatSettings, MESSAGE_MAX_LENGTH,
} from '../../lib/chat';
import {
  groupMessages, composerState, replyQuote, typingLabel, trustRoxy, threadHeader,
  senderNamer, conversationReportTarget, isMutedUntil, MUTE_FOREVER, groupInfoPath,
  keyboardBehavior, type GroupedMessage,
} from '../../lib/chatThread';
import type { Message } from '../../types';
import { ActionTray } from '../../components/chat/ActionTray';
import { GifPicker } from '../../components/chat/GifPicker';
import { TypingIndicator } from '../../components/chat/TypingIndicator';
import { MessageRow } from '../../components/chat/MessageRow';
import { MessageActionSheet } from '../../components/chat/MessageActionSheet';
import { ReplyBar, RequestGate, ThreadNotice } from '../../components/chat/ComposerBanners';

/** Rows per page, on open and on every scroll back. */
const PAGE_SIZE = 50;
/** Within this many px of the newest message counts as "at the bottom". */
const AT_BOTTOM_PX = 120;

/**
 * One DM or private group thread (migration 132).
 *
 * The screen draws; the rules live in lib/chatThread.ts and the writes in
 * lib/chat.ts. What changed from the old screen, and why:
 *  - Each message gets its id on the phone before the first attempt, and a
 *    retry re-sends that same id (CHAT-06): a lost response can no longer
 *    become a second bubble with the first one spinning forever.
 *  - No write to `conversations` (CHAT-03): last_message_at is the trigger's
 *    job and the table grant is gone.
 *  - Message requests (CHAT-02): a request she received is answered before she
 *    can type; one she sent is text-only and capped.
 *  - One report path (CHAT-11): the global ReportSheet, with a message id.
 *  - History pages in as she scrolls up, and a new message while she reads
 *    back shows a pill instead of pulling her down (CHAT-16).
 */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = id ?? '';
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const me = user?.id ?? '';
  const markRead = useConnectStore((s) => s.markRead);
  const refreshInbox = useConnectStore((s) => s.refresh);
  const setActiveConversation = useConnectStore((s) => s.setActiveConversation);
  const openReportModal = useSafetyStore((s) => s.openReportModal);
  const blockUser = useSafetyStore((s) => s.blockUser);
  const colors = useThemeColors();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const { meta, loading: metaLoading, unavailable, reload: reloadMeta } = useThreadMeta(conversationId, me);

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [sheetFor, setSheetFor] = useState<ChatMessage | null>(null);
  const [reactAnyFor, setReactAnyFor] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTray, setShowTray] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [wingwomanLoading, setWingwomanLoading] = useState(false);
  const [nudgeLoading, setNudgeLoading] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [readReceipts, setReadReceipts] = useState(true);

  const listRef = useRef<FlatList<GroupedMessage>>(null);
  const inputRef = useRef<TextInput>(null);
  const atBottomRef = useRef(true);
  const newestIdRef = useRef<string | null>(null);

  const {
    messages, appendMessage, appendOptimistic, settleSend, retryMessage, failMessage,
    loadOlder, hasMoreOlder, loadingOlder, patchMessage,
  } = useRealtime({ conversationId, initialMessages, currentUserId: me, pageSize: PAGE_SIZE });

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const { reactionsMap, addReaction, removeReaction } = useReactions({ conversationId, messageIds });

  const header = useMemo(() => threadHeader(meta, me), [meta, me]);
  const nameOf = useMemo(() => senderNamer(meta, me), [meta, me]);
  const other = meta?.type === 'direct' ? meta.others[0] ?? null : null;
  const isGroup = header.isGroup;
  const muted = isMutedUntil(meta?.me?.muted_until);

  const { partnerIsTyping, typingNames, sendTyping, stopTyping } = useTyping({
    conversationId,
    currentUserId: me,
    partnerName: header.title,
    selfName: meta?.me?.display_name ?? meta?.me?.username ?? undefined,
  });

  const composer = useMemo(
    () => (meta ? composerState(meta, messages, me) : null),
    [meta, messages, me],
  );
  const capped = composer?.kind === 'outgoing_request' && composer.remaining <= 0;
  const inRequest = composer?.kind === 'outgoing_request';

  // ── lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    setActiveConversation(conversationId || null);
    // No banner for this chat while it is on screen (push pipeline, 129).
    setActivePushPath(conversationId ? `/chat/${conversationId}` : null);
    return () => {
      setActiveConversation(null);
      setActivePushPath(null);
    };
  }, [conversationId]);

  useEffect(() => {
    let alive = true;
    fetchChatSettings()
      .then((cs) => { if (alive) setReadReceipts(cs.read_receipts); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const loadMessages = useCallback(async () => {
    if (!conversationId || !me) return;
    setLoadingInitial(true);
    setLoadError(false);
    try {
      // Newest page first, shown oldest → newest; older pages arrive on scroll.
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      setInitialMessages([...((data ?? []) as Message[])].reverse());
      // Server-owned unread (CHAT-13): moves her cursor, clears the bell rows
      // for this link, refreshes the badge. Never a receipt on a request.
      void markRead(conversationId);
    } catch (e) {
      logError(e, 'chat_loadMessages');
      setLoadError(true);
    } finally {
      setLoadingInitial(false);
    }
  }, [conversationId, me]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  useEffect(() => {
    // A different thread: nothing seen, nothing pending, nothing half-typed.
    newestIdRef.current = null;
    atBottomRef.current = true;
    setUnseen(0);
    setReplyTo(null);
    setEditing(null);
    setSendError(null);
  }, [conversationId]);

  const scrollToBottom = useCallback((animated = true) => {
    atBottomRef.current = true;
    setUnseen(0);
    try {
      listRef.current?.scrollToOffset({ offset: 0, animated });
    } catch {
      // list not mounted yet
    }
  }, []);

  // A new newest message: hers → go to it; someone else's → follow only if she
  // is already at the bottom, otherwise count it on the pill (CHAT-16).
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (!newest) return;
    const prev = newestIdRef.current;
    newestIdRef.current = newest.id;
    if (prev === null || prev === newest.id) return;
    if (newest.sender_id === me) {
      scrollToBottom();
      return;
    }
    if (atBottomRef.current) scrollToBottom();
    else setUnseen((n) => n + 1);
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => { void markRead(conversationId); }, 800);
  }, [messages]);

  useEffect(() => () => { if (markReadTimer.current) clearTimeout(markReadTimer.current); }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!flashId) return undefined;
    const t = setTimeout(() => setFlashId(null), 1500);
    return () => clearTimeout(t);
  }, [flashId]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Inverted list: offset 0 is the newest message.
    const atBottom = (e.nativeEvent?.contentOffset?.y ?? 0) < AT_BOTTOM_PX;
    atBottomRef.current = atBottom;
    if (atBottom) setUnseen(0);
  }, []);

  const onEndReached = useCallback(() => {
    if (loadingInitial || !hasMoreOlder) return;
    void loadOlder();
  }, [loadingInitial, hasMoreOlder, loadOlder]);

  // ── send / retry / edit ──────────────────────────────────────────────────

  const deliver = useCallback(async (msg: ChatMessage) => {
    try {
      const result = await insertMessage({
        id: msg.id,
        conversationId: msg.conversation_id,
        senderId: me,
        content: msg.content,
        type: msg.message_type === 'image' ? 'image' : 'text',
        mediaUrl: msg.media_url,
        replyToId: msg.reply_to_id ?? null,
      });
      if (settleSend(msg.id, result)) {
        Analytics.messageSent(conversationId);
        setSendError(null);
      } else {
        // The bubble stays with Retry on it; the reason is said once, in words.
        setSendError(chatErrorMessage(result.error));
      }
    } catch (e) {
      logError(e, 'chat_sendMessage');
      failMessage(msg.id);
      setSendError(chatErrorMessage(e));
    }
  }, [me, conversationId, settleSend, failMessage]);

  const send = useCallback(async (content: string, type: 'text' | 'image' = 'text', mediaUrl?: string) => {
    const text = content.trim();
    if ((!text && !mediaUrl) || !me || !conversationId || capped) return;
    stopTyping();
    const msg: ChatMessage = {
      // Minted once, here. Retry re-sends this exact id (CHAT-06).
      id: newMessageId(),
      conversation_id: conversationId,
      sender_id: me,
      content: text || null,
      media_url: mediaUrl ?? null,
      message_type: type,
      is_read: false,
      created_at: new Date().toISOString(),
      reply_to_id: replyTo?.id ?? null,
    };
    appendOptimistic(msg);
    setInputText('');
    setReplyTo(null);
    haptic('tap');
    scrollToBottom();
    await deliver(msg);
  }, [me, conversationId, capped, replyTo, appendOptimistic, deliver, scrollToBottom, stopTyping]);

  const retry = useCallback((m: ChatMessage) => {
    const again = retryMessage(m.id);
    if (again) void deliver(again);
  }, [retryMessage, deliver]);

  const saveEdit = useCallback(async () => {
    const target = editing;
    if (!target) return;
    const text = inputText.trim();
    setEditing(null);
    setInputText('');
    if (!text || text === target.content) return;
    patchMessage(target.id, { content: text, edited_at: new Date().toISOString() });
    try {
      await editMessage(target.id, text);
      haptic('select');
    } catch (e) {
      patchMessage(target.id, { content: target.content, edited_at: target.edited_at ?? null });
      setSendError(e instanceof Error ? e.message : chatErrorMessage(e));
    }
  }, [editing, inputText, patchMessage]);

  const submit = useCallback(() => {
    if (editing) void saveEdit();
    else void send(inputText);
  }, [editing, saveEdit, send, inputText]);

  // ── message actions ──────────────────────────────────────────────────────

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    if (!me) return;
    // The sheet and the chips tick on tap themselves; this only writes.
    const mine = (reactionsMap[messageId] ?? []).some((r) => r.user_id === me && r.emoji === emoji);
    if (mine) await removeReaction(messageId, emoji, me);
    else await addReaction(messageId, emoji, me);
  }, [me, reactionsMap, addReaction, removeReaction]);

  const onToggleReaction = useCallback((messageId: string, emoji: string, own: boolean) => {
    if (!me) return;
    if (own) void removeReaction(messageId, emoji, me);
    else void addReaction(messageId, emoji, me);
  }, [me, addReaction, removeReaction]);

  const startReply = useCallback((m: ChatMessage) => {
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus?.();
  }, []);

  const startEdit = useCallback((m: ChatMessage) => {
    setReplyTo(null);
    setEditing(m);
    setInputText(m.content ?? '');
    inputRef.current?.focus?.();
  }, []);

  const cancelComposerMode = useCallback(() => {
    if (editing) setInputText('');
    setEditing(null);
    setReplyTo(null);
  }, [editing]);

  const unsend = useCallback(async (m: ChatMessage) => {
    const ok = await confirmAction(
      'Unsend this message?',
      'Everyone in the chat will see "Message unsent" instead.',
      'Unsend',
    );
    if (!ok) return;
    patchMessage(m.id, { deleted_at: new Date().toISOString() });
    try {
      await unsendMessage(m.id);
      haptic('select');
    } catch (e) {
      patchMessage(m.id, { deleted_at: null });
      showAlert("Couldn't unsend", e instanceof Error ? e.message : chatErrorMessage(e));
    }
  }, [patchMessage]);

  const copy = useCallback(async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      haptic('select');
      setToast('Copied');
    } catch (e) {
      logError(e, 'chat_copy');
    }
  }, []);

  const reportMessage = useCallback((m: ChatMessage) => {
    if (!m.sender_id) return;
    // The one global ReportSheet, pointed at this exact message (CHAT-11).
    openReportModal({ userId: m.sender_id, contentType: 'message', contentId: m.id });
  }, [openReportModal]);

  // ── header menu ──────────────────────────────────────────────────────────

  const toggleMute = useCallback(async () => {
    setMenuOpen(false);
    try {
      await muteConversation(conversationId, muted ? null : MUTE_FOREVER);
      haptic('select');
      void reloadMeta();
      void refreshInbox();
    } catch (e) {
      showAlert("Couldn't update", e instanceof Error ? e.message : chatErrorMessage(e));
    }
  }, [conversationId, muted, reloadMeta, refreshInbox]);

  const reportFromHeader = useCallback(() => {
    setMenuOpen(false);
    // The whole thread (content_type 'conversation', migration 132), DM or group.
    const target = conversationReportTarget(meta, me);
    if (!target) return;
    openReportModal(target);
  }, [meta, me, openReportModal]);

  const blockFromHeader = useCallback(async () => {
    setMenuOpen(false);
    if (!other) return;
    const ok = await confirmAction(
      `Block ${header.title}?`,
      "They won't be able to message you and you won't see their profile.",
      'Block',
    );
    if (!ok) return;
    try {
      await blockUser(other.id);
      router.back();
    } catch {
      showAlert('Error', 'Could not block. Please try again.');
    }
  }, [other, header.title, blockUser, router]);

  const openHeaderTarget = useCallback(() => {
    if (isGroup) router.push(groupInfoPath(conversationId) as never);
    else if (other) router.push(`/user/${other.id}` as never);
  }, [isGroup, other, conversationId, router]);

  // ── message requests (CHAT-02) ───────────────────────────────────────────

  const answerRequest = useCallback(async (accept: boolean, alsoBlock = false) => {
    if (requestBusy) return;
    if (alsoBlock) {
      const ok = await confirmAction(
        `Block ${header.title}?`,
        "They won't be told. They won't be able to message you again.",
        'Block',
      );
      if (!ok) return;
    }
    setRequestBusy(true);
    try {
      await respondMessageRequest(conversationId, accept);
      const sender = meta?.others[0]?.id;
      if (alsoBlock && sender) await blockUser(sender);
      haptic(accept ? 'success' : 'tap');
      void refreshInbox();
      if (accept) {
        await reloadMeta();
      } else {
        router.back();
      }
    } catch (e) {
      showAlert("Couldn't answer that", e instanceof Error ? e.message : chatErrorMessage(e));
    } finally {
      setRequestBusy(false);
    }
  }, [requestBusy, header.title, conversationId, meta, blockUser, refreshInbox, reloadMeta, router]);

  // ── Roxy (wingwoman) ─────────────────────────────────────────────────────

  const handleWingwoman = async () => {
    if (!conversationId) return;
    setWingwomanLoading(true);
    try {
      const history = messages
        .filter((m) => m.message_type === 'text' && m.content && !m.deleted_at)
        .slice(-6)
        .map((m) => ({ sender: m.sender_id === me ? 'Me' : 'Them', content: m.content ?? '' }));
      const { data, error } = await callEdgeFunction<{ suggestion: string }>('roxy-wingwoman', {
        conversation_id: conversationId,
        message_history: history,
        current_message: inputText || 'I want to keep the conversation going',
      });
      if (error) { showAlert('Roxy is busy', error); return; }
      if (data?.suggestion) {
        // Local only, sender null: the one row allowed to wear Roxy's card.
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
      showAlert('Error', 'Failed to get a suggestion. Please try again.');
    } finally {
      setWingwomanLoading(false);
    }
  };

  const handleNudge = async () => {
    if (!conversationId) return;
    setNudgeLoading(true);
    try {
      const { data, error } = await callEdgeFunction<{ nudge: string }>('roxy-nudge', { conversation_id: conversationId });
      if (error) {
        showAlert('Roxy Nudge', "Nudge limit reached for this conversation, but you've got this! 💜");
        return;
      }
      if (data?.nudge) setInputText(data.nudge);
    } catch {
      showAlert('Error', 'Failed to get a nudge. Please try again.');
    } finally {
      setNudgeLoading(false);
    }
  };

  // ── list ─────────────────────────────────────────────────────────────────

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const query = searchActive ? searchQuery.trim().toLowerCase() : '';

  const rows = useMemo(() => {
    const trusted = trustRoxy(messages);
    const base = query
      ? trusted.filter((m) => !m.deleted_at && (m.content ?? '').toLowerCase().includes(query))
      : trusted;
    // Inverted list: newest first renders at the visual bottom.
    return groupMessages(base, { me, isGroup }).reverse();
  }, [messages, query, me, isGroup]);

  const showReadState = !isGroup && readReceipts;

  // Tap a quote → scroll to the original and flash it. One further back than
  // what is loaded says so rather than doing nothing.
  const goToQuoted = useCallback((messageId: string) => {
    const index = rows.findIndex((r) => r.id === messageId);
    if (index < 0) {
      setToast('That message is further back');
      return;
    }
    setFlashId(messageId);
    try {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    } catch {
      // onScrollToIndexFailed handles the unmeasured case
    }
  }, [rows]);

  const renderItem: ListRenderItem<GroupedMessage> = useCallback(({ item }) => (
    <MessageRow
      message={item}
      replyTo={item.reply_to_id ? byId.get(item.reply_to_id) : undefined}
      currentUserId={me}
      isGroup={isGroup}
      nameOf={nameOf}
      reactions={reactionsMap[item.id] ?? []}
      showReadState={showReadState}
      highlighted={flashId === item.id || (!!query && !!item.content?.toLowerCase().includes(query))}
      onLongPress={setSheetFor}
      onReply={startReply}
      onQuotePress={goToQuoted}
      onToggleReaction={onToggleReaction}
      onRetry={retry}
      onUseSuggestion={setInputText}
    />
  ), [byId, me, isGroup, nameOf, reactionsMap, showReadState, flashId, query, startReply, goToQuoted, onToggleReaction, retry]);

  // ── render ───────────────────────────────────────────────────────────────

  if (unavailable && !meta) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.header}>
          <BackButton s={s} colors={colors} onPress={() => router.back()} />
        </View>
        <View style={s.center} testID="chat-unavailable">
          <Ionicons name="chatbubbles-outline" size={32} color={colors.textMuted} />
          <Text style={s.centerTitle}>This chat isn&apos;t available</Text>
          <Text style={s.centerBody}>It may have been deleted, or you&apos;re no longer in it.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const canType = composer?.kind === 'open' || composer?.kind === 'outgoing_request';
  const sendDisabled = !inputText.trim() || capped;
  const replyName = replyTo ? nameOf(replyTo.sender_id) : '';
  const headerGrad = avatarGradient(header.title);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {searchActive ? (
        <View style={s.header}>
          <TextInput
            style={s.searchInput}
            placeholder="Search messages..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            accessibilityLabel="Search messages"
          />
          <TouchableOpacity
            style={s.headerBtn}
            onPress={() => { setSearchActive(false); setSearchQuery(''); }}
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
          >
            <Text style={s.searchCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.header}>
          <BackButton s={s} colors={colors} onPress={() => router.back()} />
          <TouchableOpacity
            style={s.headerMain}
            onPress={openHeaderTarget}
            disabled={!meta}
            accessibilityRole="button"
            accessibilityLabel={isGroup ? `${header.title}, group info` : `${header.title}, view profile`}
            testID="chat-header-title"
          >
            <View>
              {isGroup && header.emoji ? (
                <View style={[s.headerAva, s.headerEmojiAva]}>
                  <Text style={s.headerEmoji}>{header.emoji}</Text>
                </View>
              ) : (
                <LinearGradient colors={headerGrad} style={s.headerAva}>
                  <Text style={[s.headerAvaText, { color: inkOnGradient(headerGrad) }]}>
                    {isGroup ? (header.title[0]?.toUpperCase() ?? '#') : (header.title[0]?.toUpperCase() ?? '?')}
                  </Text>
                </LinearGradient>
              )}
              {other && isOnline(other.last_seen_at) ? <View style={s.onlineDot} /> : null}
            </View>
            <View style={s.headerText}>
              <View style={s.headerTitleRow}>
                <Text style={s.headerName} numberOfLines={1}>{header.title}</Text>
                {muted ? (
                  <Ionicons name="notifications-off" size={13} color={colors.textMuted} accessibilityLabel="Muted" />
                ) : null}
              </View>
              <Text style={s.headerSub} numberOfLines={1}>
                {isGroup
                  ? header.subtitle
                  : other && isOnline(other.last_seen_at) ? 'Online now' : 'Tap to view profile'}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.headerBtn}
            onPress={() => setSearchActive(true)}
            accessibilityRole="button"
            accessibilityLabel="Search messages"
          >
            <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.headerBtn}
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Conversation options"
            testID="chat-menu"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView style={s.flex} behavior={keyboardBehavior(Platform.OS)} keyboardVerticalOffset={0}>
        {loadingInitial ? (
          <ActivityIndicator color={colors.roxy} style={s.flex} accessibilityLabel="Loading messages" />
        ) : loadError ? (
          <View style={s.center}>
            <Text style={s.centerBody}>Could not load messages</Text>
            <TouchableOpacity
              style={s.retryBtn}
              onPress={() => void loadMessages()}
              accessibilityRole="button"
              accessibilityLabel="Try loading messages again"
            >
              <Text style={s.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.flex}>
            <FlatList
              ref={listRef}
              testID="chat-list"
              data={rows}
              keyExtractor={(m) => m.id}
              renderItem={renderItem}
              inverted
              style={s.flex}
              contentContainerStyle={s.listContent}
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={64}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.3}
              onScrollToIndexFailed={(info) => {
                listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
              }}
              maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: AT_BOTTOM_PX }}
              ListFooterComponent={loadingOlder ? (
                <ActivityIndicator color={colors.textMuted} style={s.olderSpinner} accessibilityLabel="Loading earlier messages" />
              ) : null}
              ListEmptyComponent={
                <Text style={s.empty}>
                  {searchActive ? 'No messages match your search.' : 'Say hi 💜'}
                </Text>
              }
            />
            {unseen > 0 ? (
              <TouchableOpacity
                style={s.pill}
                onPress={() => scrollToBottom()}
                accessibilityRole="button"
                accessibilityLabel={`${unseen} new message${unseen === 1 ? '' : 's'}. Jump to latest`}
                testID="new-messages-pill"
              >
                <Ionicons name="arrow-down" size={14} color={inkOn(colors.primary)} />
                <Text style={s.pillText}>{unseen === 1 ? 'New message' : `${unseen} new messages`}</Text>
              </TouchableOpacity>
            ) : null}
            {toast ? (
              <View style={s.toast} pointerEvents="none" accessibilityLiveRegion="polite">
                <Text style={s.toastText}>{toast}</Text>
              </View>
            ) : null}
          </View>
        )}

        <TypingIndicator
          partnerName={header.title}
          visible={partnerIsTyping}
          label={isGroup ? typingLabel(typingNames) : undefined}
        />

        {composer?.kind === 'incoming_request' ? (
          <RequestGate
            name={header.title}
            busy={requestBusy}
            onAccept={() => void answerRequest(true)}
            onDelete={() => void answerRequest(false)}
            onBlock={() => void answerRequest(false, true)}
          />
        ) : composer?.kind === 'gone' ? (
          <ThreadNotice kind="gone" reason={composer.reason} />
        ) : !meta && !metaLoading ? (
          // Who's in this thread didn't load, so whether she may type (request,
          // left, removed) is unknown. Ask again rather than guess.
          <View style={s.metaError}>
            <Text style={s.centerBody}>Couldn&apos;t load this chat&apos;s details.</Text>
            <TouchableOpacity
              style={s.metaRetry}
              onPress={() => void reloadMeta()}
              accessibilityRole="button"
              accessibilityLabel="Try loading chat details again"
              testID="chat-meta-retry"
            >
              <Text style={s.metaRetryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : canType ? (
          <View style={s.inputWrap}>
            {composer?.kind === 'outgoing_request' ? (
              <ThreadNotice kind="outgoing_request" remaining={composer.remaining} name={header.title} />
            ) : null}
            {sendError ? (
              <Text style={s.sendError} accessibilityLiveRegion="polite" testID="chat-send-error">{sendError}</Text>
            ) : null}
            {replyTo ? (
              <ReplyBar mode="reply" name={replyName} text={replyQuote(replyTo, nameOf).text} onCancel={cancelComposerMode} />
            ) : editing ? (
              <ReplyBar mode="edit" name="" text={editing.content ?? ''} onCancel={cancelComposerMode} />
            ) : null}

            {showTray ? (
              <ActionTray
                onEmojiPress={() => { Keyboard.dismiss(); setShowEmoji((v) => !v); }}
                onGifPress={() => {
                  setShowTray(false);
                  setShowEmoji(false);
                  if (inRequest) setSendError(chatErrorMessage({ message: 'request_text_only' }));
                  else setShowGifs(true);
                }}
                onWingwomanPress={() => { setShowTray(false); void handleWingwoman(); }}
                onNudgePress={() => { setShowTray(false); void handleNudge(); }}
                wingwomanLoading={wingwomanLoading}
                nudgeLoading={nudgeLoading}
              />
            ) : null}

            {showEmoji ? (
              <View style={s.emojiWrap}>
                <EmojiKeyboard
                  open={showEmoji}
                  onClose={() => setShowEmoji(false)}
                  onEmojiSelected={({ emoji }: { emoji: string }) => setInputText((prev) => prev + emoji)}
                  expandable={false}
                  styles={{ container: { height: 300 } }}
                />
              </View>
            ) : null}

            <View style={s.inputBar}>
              <TouchableOpacity
                style={[s.roxyBtn, showTray && s.roxyBtnOn]}
                onPress={() => { setShowTray((v) => !v); setShowEmoji(false); }}
                accessibilityRole="button"
                accessibilityLabel="Roxy wingwoman tools"
              >
                <Ionicons name="sparkles" size={16} color={colors.roxy} />
              </TouchableOpacity>
              <TextInput
                ref={inputRef}
                testID="chat-input"
                style={[s.input, capped && s.inputOff]}
                placeholder={capped ? 'Waiting for her to accept' : editing ? 'Edit message' : 'Say something...'}
                placeholderTextColor={colors.textMuted}
                value={inputText}
                editable={!capped}
                onChangeText={(t) => {
                  setInputText(t);
                  if (sendError) setSendError(null);
                  if (!editing) sendTyping();
                }}
                onFocus={() => setShowEmoji(false)}
                onBlur={stopTyping}
                multiline
                maxLength={MESSAGE_MAX_LENGTH}
                accessibilityLabel={editing ? 'Edit message' : 'Message input'}
                // Web: Enter sends, Shift+Enter is a new line.
                onKeyPress={(e) => {
                  const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
                  if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                    (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                    if (!sendDisabled) submit();
                  }
                }}
              />
              <TouchableOpacity
                testID="chat-send"
                style={[s.sendBtn, sendDisabled && s.sendOff]}
                onPress={submit}
                disabled={sendDisabled}
                accessibilityRole="button"
                accessibilityLabel={editing ? 'Save edit' : 'Send message'}
                accessibilityState={{ disabled: sendDisabled }}
              >
                <LinearGradient colors={BRAND_GRADIENT} style={s.sendFill}>
                  <Ionicons name={editing ? 'checkmark' : 'send'} size={17} color={inkOnGradient(BRAND_GRADIENT)} />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <MessageActionSheet
        message={sheetFor}
        currentUserId={me}
        onClose={() => setSheetFor(null)}
        onReact={(messageId, emoji) => void toggleReaction(messageId, emoji)}
        onMoreReactions={setReactAnyFor}
        onReply={startReply}
        onCopy={(text) => void copy(text)}
        onEdit={startEdit}
        onUnsend={(m) => void unsend(m)}
        onReport={reportMessage}
      />

      {reactAnyFor ? (
        <EmojiKeyboard
          open
          onClose={() => setReactAnyFor(null)}
          onEmojiSelected={({ emoji }: { emoji: string }) => {
            const target = reactAnyFor;
            setReactAnyFor(null);
            haptic('select');
            if (target) void toggleReaction(target, emoji);
          }}
        />
      ) : null}

      <GifPicker
        visible={showGifs}
        onGifSelected={(url) => { setShowGifs(false); void send('', 'image', url); }}
        onClose={() => setShowGifs(false)}
      />

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={s.scrim} onPress={() => setMenuOpen(false)} accessibilityLabel="Close options" />
        <View style={s.sheet} testID="chat-menu-sheet">
          <MenuRow s={s} colors={colors} icon="search-outline" label="Search messages" testID="chat-menu-search"
            onPress={() => { setMenuOpen(false); setSearchActive(true); }} />
          {isGroup ? (
            <MenuRow s={s} colors={colors} icon="people-outline" label="Group info" testID="chat-menu-info"
              onPress={() => { setMenuOpen(false); openHeaderTarget(); }} />
          ) : other ? (
            <MenuRow s={s} colors={colors} icon="person-outline" label="View profile" testID="chat-menu-profile"
              onPress={() => { setMenuOpen(false); openHeaderTarget(); }} />
          ) : null}
          {meta?.me && (meta.me.status === 'active' || meta.me.status === 'request') ? (
            <MenuRow s={s} colors={colors}
              icon={muted ? 'notifications-outline' : 'notifications-off-outline'}
              label={muted ? 'Unmute notifications' : 'Mute notifications'}
              testID="chat-menu-mute"
              onPress={() => void toggleMute()} />
          ) : null}
          {conversationReportTarget(meta, me) ? (
            <MenuRow s={s} colors={colors} icon="flag-outline" label="Report conversation" testID="chat-menu-report"
              onPress={reportFromHeader} danger />
          ) : null}
          {other ? (
            <MenuRow s={s} colors={colors} icon="ban-outline" label={`Block ${header.title}`} testID="chat-menu-block"
              onPress={() => void blockFromHeader()} danger />
          ) : null}
          <MenuRow s={s} colors={colors} label="Cancel" testID="chat-menu-cancel" onPress={() => setMenuOpen(false)} muted />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function BackButton({ s, colors, onPress }: { s: Styles; colors: ThemeColors; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.headerBtn} onPress={onPress} accessibilityRole="button" accessibilityLabel="Go back">
      <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
    </TouchableOpacity>
  );
}

function MenuRow({
  s, colors, icon, label, onPress, testID, danger, muted,
}: {
  s: Styles; colors: ThemeColors; icon?: keyof typeof Ionicons.glyphMap; label: string;
  onPress: () => void; testID: string; danger?: boolean; muted?: boolean;
}) {
  return (
    <TouchableOpacity style={s.menuRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      {icon ? <Ionicons name={icon} size={19} color={danger ? colors.errorInk : colors.textSecondary} /> : null}
      <Text style={[s.menuText, danger && s.menuDanger, muted && s.menuMuted]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 4, paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  headerBtn: { minWidth: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: MIN_TOUCH_TARGET },
  headerAva: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  headerEmojiAva: { backgroundColor: colors.surfaceLight },
  headerEmoji: { fontSize: 20 },
  headerAvaText: { fontWeight: '800', fontSize: 15 },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6,
    backgroundColor: colors.success, borderWidth: 2, borderColor: colors.background,
  },
  headerText: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerName: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  headerSub: { ...TYPE.caption, color: colors.textMuted },
  searchInput: {
    flex: 1, backgroundColor: colors.surface, borderRadius: RADII.pill, marginLeft: 8,
    paddingHorizontal: 14, paddingVertical: 8, color: colors.textPrimary, fontSize: 14,
  },
  searchCancel: { ...TYPE.body, color: colors.primary, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  centerTitle: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  centerBody: { ...TYPE.body, color: colors.textMuted, textAlign: 'center' },
  retryBtn: {
    backgroundColor: colors.primary, borderRadius: RADII.pill, paddingHorizontal: 24,
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
  },
  retryText: { ...TYPE.body, color: inkOn(colors.primary), fontWeight: '700' },
  listContent: { paddingVertical: 12, paddingHorizontal: 12 },
  olderSpinner: { marginVertical: 12 },
  empty: { ...TYPE.body, color: colors.textMuted, textAlign: 'center', marginTop: 40 },
  pill: {
    position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: RADII.pill, paddingHorizontal: 16, minHeight: 40,
  },
  pillText: { ...TYPE.caption, color: inkOn(colors.primary), fontWeight: '700' },
  toast: {
    position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: colors.surface,
    borderRadius: RADII.pill, paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  toastText: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700' },
  inputWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.background },
  metaError: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
  },
  metaRetry: { minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 14, justifyContent: 'center' },
  metaRetryText: { ...TYPE.body, color: colors.primary, fontWeight: '700' },
  sendError: { ...TYPE.caption, color: colors.errorInk, paddingHorizontal: 16, paddingTop: 8 },
  emojiWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  roxyBtn: {
    width: 40, height: 40, borderRadius: 20, marginBottom: 2,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.roxy + '50',
    alignItems: 'center', justifyContent: 'center',
  },
  roxyBtnOn: { backgroundColor: colors.roxy + '18', borderColor: colors.roxy },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, maxHeight: 120,
    color: colors.textPrimary, fontSize: 16,
  },
  inputOff: { opacity: 0.55 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden' },
  sendFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
  scrim: { flex: 1, backgroundColor: 'rgba(8,3,18,0.55)' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet,
    paddingTop: 10, paddingBottom: 30, width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, minHeight: MIN_TOUCH_TARGET + 4,
  },
  menuText: { ...TYPE.bodyLg, color: colors.textPrimary },
  menuDanger: { color: colors.errorInk, fontWeight: '600' },
  menuMuted: { color: colors.textMuted, textAlign: 'center', flex: 1 },
});
