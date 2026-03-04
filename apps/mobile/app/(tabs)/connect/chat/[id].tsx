import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useConnectStore } from '../../../../store/connectStore';
import { useRealtime } from '../../../../hooks/useRealtime';
import { COLORS } from '../../../../lib/constants';
import { Message } from '../../../../types';

function MessageBubble({
  message,
  isOwn,
  onUseWingwoman,
}: {
  message: Message;
  isOwn: boolean;
  onUseWingwoman?: () => void;
}) {
  const isRoxySuggestion = message.message_type === 'roxy_suggestion';

  return (
    <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, isRoxySuggestion && styles.bubbleRoxy]}>
      {isRoxySuggestion && (
        <Text style={styles.roxyLabel}>✨ Roxy suggests</Text>
      )}
      <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
        {message.content}
      </Text>
      {isRoxySuggestion && onUseWingwoman && (
        <View style={styles.roxyActions}>
          <TouchableOpacity style={styles.roxyUseBtn} onPress={onUseWingwoman}>
            <Text style={styles.roxyUseBtnText}>Use this</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={styles.bubbleTime}>{format(new Date(message.created_at), 'HH:mm')}</Text>
    </View>
  );
}

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { clearUnread } = useConnectStore();
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [wingwomanLoading, setWingwomanLoading] = useState(false);
  const [icebreaker, setIcebreaker] = useState<string | null>(null);
  const flashListRef = useRef<FlashList<Message>>(null);

  const { messages, isSubscribed, appendMessage } = useRealtime({
    conversationId: conversationId ?? '',
    initialMessages,
  });

  // Load initial messages
  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      setLoadingInitial(true);
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (data) setInitialMessages(data as Message[]);

      // Load icebreaker (first roxy_suggestion message)
      const icebreakerMsg = data?.find((m) => m.message_type === 'roxy_suggestion');
      if (icebreakerMsg) setIcebreaker(icebreakerMsg.content);

      // Mark messages as read
      if (user) {
        await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('conversation_id', conversationId)
          .neq('sender_id', user.id)
          .eq('is_read', false);
        clearUnread(conversationId);
      }

      setLoadingInitial(false);
    })();
  }, [conversationId, user]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flashListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const sendMessage = async (content: string, type: Message['message_type'] = 'text') => {
    if (!content.trim() || !user || !conversationId) return;
    setSending(true);
    const optimisticMsg: Message = {
      id: `tmp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: user.id,
      content: content.trim(),
      media_url: null,
      message_type: type,
      is_read: false,
      created_at: new Date().toISOString(),
    };
    appendMessage(optimisticMsg);
    setInputText('');

    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: content.trim(),
      message_type: type,
    });

    if (error) Alert.alert('Error', 'Failed to send message. Please try again.');
    setSending(false);
  };

  const handleWingwoman = async () => {
    if (!conversationId) return;
    setWingwomanLoading(true);

    // Build history from last 6 text messages
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

    setWingwomanLoading(false);

    if (error) {
      Alert.alert('Wingwoman unavailable', error);
      return;
    }

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
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isOwn = item.sender_id === user?.id;
    const isRoxy = item.message_type === 'roxy_suggestion';
    return (
      <MessageBubble
        message={item}
        isOwn={isOwn && !isRoxy}
        onUseWingwoman={isRoxy ? () => {
          setInputText(item.content ?? '');
        } : undefined}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Chat</Text>
        <View style={styles.statusDot}>
          <View style={[styles.dot, isSubscribed ? styles.dotConnected : styles.dotDisconnected]} />
        </View>
      </View>

      {/* Icebreaker banner */}
      {icebreaker && (
        <View style={styles.icebreakerBanner}>
          <Text style={styles.icebreakerLabel}>✨ Roxy's icebreaker</Text>
          <Text style={styles.icebreakerText}>{icebreaker}</Text>
        </View>
      )}

      {/* Messages */}
      {loadingInitial ? (
        <ActivityIndicator color={COLORS.roxy} style={{ flex: 1 }} />
      ) : (
        <FlashList
          ref={flashListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          estimatedItemSize={60}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Send your first message!</Text>
          }
        />
      )}

      {/* Input bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.wingwomanBtn}
            onPress={handleWingwoman}
            disabled={wingwomanLoading}
          >
            {wingwomanLoading ? (
              <ActivityIndicator size="small" color={COLORS.roxy} />
            ) : (
              <Text style={styles.wingwomanIcon}>✨</Text>
            )}
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Say something..."
            placeholderTextColor={COLORS.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
          />

          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim() || sending}
          >
            <Text style={styles.sendBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  headerTitle: { flex: 1, color: COLORS.textPrimary, fontWeight: '700', fontSize: 17, textAlign: 'center' },
  statusDot: { width: 40, alignItems: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotConnected: { backgroundColor: COLORS.success },
  dotDisconnected: { backgroundColor: COLORS.textMuted },
  icebreakerBanner: {
    backgroundColor: COLORS.roxy + '20', borderBottomWidth: 1, borderBottomColor: COLORS.roxy + '40',
    padding: 12,
  },
  icebreakerLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  icebreakerText: { color: COLORS.textPrimary, fontSize: 14, fontStyle: 'italic' },
  messageList: { padding: 16, gap: 8 },
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 12, marginVertical: 2 },
  bubbleOwn: { alignSelf: 'flex-end', backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  bubbleRoxy: { alignSelf: 'center', backgroundColor: COLORS.roxy + '20', borderRadius: 12, borderWidth: 1, borderColor: COLORS.roxy + '60', width: '90%' },
  roxyLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: '#fff' },
  bubbleTextOther: { color: COLORS.textPrimary },
  roxyActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roxyUseBtn: { backgroundColor: COLORS.roxy, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  roxyUseBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  bubbleTime: { color: COLORS.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 12, borderTopWidth: 1, borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  wingwomanBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  wingwomanIcon: { fontSize: 20 },
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
});
