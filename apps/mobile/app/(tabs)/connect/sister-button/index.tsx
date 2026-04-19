import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../../store/authStore';
import { callEdgeFunction } from '../../../../lib/supabase';
import { COLORS } from '../../../../lib/constants';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export default function SisterButtonScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [resources, setResources] = useState<{ name: string; number?: string; instruction?: string; contact?: string; type?: string }[] | null>(null);
  const [directory, setDirectory] = useState<{ name: string; url?: string; description?: string }[] | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const conversationId = 'sister-' + (user?.id ?? 'anon');

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading || sessionDone) return;

    setInput('');
    const userMessage: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const { data, error: fnError } = await callEdgeFunction<{
        response: string;
        turn_number: number;
        is_final_turn: boolean;
        resources?: { name: string; contact: string; type: string }[];
        professional_directory?: { name: string; url: string }[];
      }>('roxy-sister', {
        conversation_id: conversationId,
        message: text,
      });

      if (fnError) {
        Alert.alert('Something went wrong', 'Please try again.');
        return;
      }

      if (data?.response) {
        const assistantMessage: Message = { role: 'assistant', content: data.response };
        setMessages((prev) => [...prev, assistantMessage]);
      }

      if (data?.resources && Array.isArray(data.resources)) {
        setResources(data.resources);
      }

      if (data?.professional_directory && Array.isArray(data.professional_directory)) {
        setDirectory(data.professional_directory);
      }

      if (data?.is_final_turn === true) {
        setSessionDone(true);
      }
    } catch {
      Alert.alert('Something went wrong', 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Roxy Sister 💜</Text>
            <Text style={styles.headerSubtitle}>A safe space, just for you</Text>
          </View>
          <View style={styles.backButton} />
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>💜</Text>
              <Text style={styles.emptyTitle}>Hi, I'm Roxy Sister</Text>
              <Text style={styles.emptyBody}>
                This is a safe space. You can share what's on your mind — I'm here to listen, without judgment.
              </Text>
            </View>
          )}

          {messages.map((msg, idx) => (
            <View
              key={idx}
              style={[
                styles.messageBubbleWrap,
                msg.role === 'user' ? styles.bubbleWrapUser : styles.bubbleWrapAssistant,
              ]}
            >
              <View
                style={[
                  styles.messageBubble,
                  msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    msg.role === 'user' ? styles.messageTextUser : styles.messageTextAssistant,
                  ]}
                >
                  {msg.content}
                </Text>
              </View>
            </View>
          ))}

          {loading && (
            <View style={styles.thinkingWrap}>
              <Text style={styles.thinkingText}>Roxy is thinking…</Text>
              <ActivityIndicator size="small" color={COLORS.roxy} style={{ marginLeft: 8 }} />
            </View>
          )}

          {/* Resources card */}
          {resources && resources.length > 0 && (
            <View style={styles.resourcesCard}>
              <Text style={styles.resourcesTitle}>Support Resources</Text>
              {resources.map((r, i) => (
                <View key={i} style={styles.resourceRow}>
                  <Text style={styles.resourceName}>{r.name}</Text>
                  {r.number && <Text style={styles.resourceContact}>{r.number}</Text>}
                  {r.instruction && <Text style={styles.resourceContact}>{r.instruction}</Text>}
                </View>
              ))}

              {directory && directory.length > 0 && (
                <>
                  <View style={styles.resourceDivider} />
                  <Text style={styles.resourcesTitle}>Professional Directory</Text>
                  {directory.map((d, i) => (
                    <View key={i} style={styles.resourceRow}>
                      <Text style={styles.resourceName}>{d.name}</Text>
                      {d.url && <Text style={styles.resourceUrl}>{d.url}</Text>}
                      {d.description && <Text style={styles.resourceContact}>{d.description}</Text>}
                    </View>
                  ))}
                </>
              )}
            </View>
          )}

          {/* Session complete */}
          {sessionDone && (
            <View style={styles.sessionDone}>
              <Text style={styles.sessionDoneText}>
                {'Your session is complete 💜\nPlease reach out to a professional for ongoing support.'}
              </Text>
              <TouchableOpacity
                style={styles.restartBtn}
                onPress={() => {
                  setMessages([]);
                  setInput('');
                  setSessionDone(false);
                  setResources(null);
                  setDirectory(null);
                }}
              >
                <Text style={styles.restartBtnText}>Start new session</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* Input area */}
        <View style={styles.inputArea}>
          <TextInput
            style={[styles.input, (loading || sessionDone) && styles.inputDisabled]}
            value={input}
            onChangeText={setInput}
            placeholder={sessionDone ? 'Session complete' : 'Share what\'s on your mind…'}
            placeholderTextColor={COLORS.textMuted}
            multiline
            editable={!loading && !sessionDone}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendButton, (loading || sessionDone || !input.trim()) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={loading || sessionDone || !input.trim()}
            activeOpacity={0.75}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0520' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  backButton: {
    width: 40,
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 32,
    color: COLORS.textPrimary,
    lineHeight: 36,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 1,
  },

  messageList: { flex: 1 },
  messageListContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 10,
    flexGrow: 1,
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
    paddingHorizontal: 16,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  emptyBody: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 15,
  },

  messageBubbleWrap: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  bubbleWrapUser: { justifyContent: 'flex-end' },
  bubbleWrapAssistant: { justifyContent: 'flex-start' },

  messageBubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 4,
  },
  messageText: { fontSize: 15, lineHeight: 22 },
  messageTextUser: { color: '#fff' },
  messageTextAssistant: { color: COLORS.roxy },

  thinkingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 4,
  },
  thinkingText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },

  resourcesCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.roxy + '40',
    gap: 10,
  },
  resourcesTitle: {
    color: COLORS.roxy,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  resourceRow: { gap: 2 },
  resourceName: {
    color: COLORS.textPrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  resourceContact: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  resourceUrl: {
    color: COLORS.secondary,
    fontSize: 13,
  },
  resourceDivider: {
    height: 1,
    backgroundColor: COLORS.surfaceLight,
    marginVertical: 4,
  },

  sessionDone: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  sessionDoneText: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 15,
  },

  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
    gap: 10,
    backgroundColor: '#0d0520',
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 15,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  sendButton: {
    backgroundColor: COLORS.roxy,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  restartBtn: {
    marginTop: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  restartBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 15 },
});
