import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { callEdgeFunction } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';
import { Analytics } from '../../../lib/analytics';

type Message = { role: 'user' | 'roxy'; content: string };

export default function RoxyChatScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const conversationId = `roxy-${user?.id ?? 'anon'}`;

  useEffect(() => {
    Analytics.roxyChatOpened();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const { data, error: fnError } = await callEdgeFunction<{ response: string }>('roxy-chat', {
        conversation_id: conversationId,
        message: text,
      });

      if (fnError) {
        Alert.alert('Roxy is unavailable', fnError);
        return;
      }

      if (data?.response) {
        setMessages((prev) => [...prev, { role: 'roxy', content: data.response }]);
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backIcon}>‹</Text>
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Roxy ✨</Text>
            <Text style={styles.headerSub}>Your wingwoman</Text>
          </View>
          <View style={styles.backBtn} />
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
              <Text style={styles.emptyIcon}>✨</Text>
              <Text style={styles.emptyTitle}>Hey! I'm Roxy</Text>
              <Text style={styles.emptyBody}>
                Your WLW wingwoman 💜{'\n'}Ask me anything — dating, community, confidence. I've got you.
              </Text>
            </View>
          )}

          {messages.map((msg, idx) => (
            <View
              key={idx}
              style={[
                styles.bubbleWrap,
                msg.role === 'user' ? styles.bubbleWrapUser : styles.bubbleWrapRoxy,
              ]}
            >
              <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleRoxy]}>
                <Text style={[styles.bubbleText, msg.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextRoxy]}>
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
        </ScrollView>

        {/* Input */}
        <View style={styles.inputArea}>
          <TextInput
            style={[styles.input, loading && styles.inputDisabled]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Roxy anything…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            editable={!loading}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (loading || !input.trim()) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={loading || !input.trim()}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { width: 60, flexDirection: 'row', alignItems: 'center' },
  backLabel: { fontSize: 15, color: COLORS.textPrimary, marginLeft: 2 },
  backIcon: { fontSize: 32, color: COLORS.textPrimary, lineHeight: 36 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  headerSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
  messageList: { flex: 1 },
  messageListContent: { paddingHorizontal: 16, paddingVertical: 20, gap: 10, flexGrow: 1 },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 60, gap: 12, paddingHorizontal: 16,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, fontSize: 15 },
  bubbleWrap: { flexDirection: 'row', marginVertical: 4 },
  bubbleWrapUser: { justifyContent: 'flex-end' },
  bubbleWrapRoxy: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleRoxy: { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.roxy + '40' },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  bubbleTextRoxy: { color: COLORS.textPrimary },
  thinkingWrap: { flexDirection: 'row', alignItems: 'center', marginVertical: 8, paddingHorizontal: 4 },
  thinkingText: { color: COLORS.textMuted, fontSize: 13, fontStyle: 'italic' },
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: COLORS.surface, gap: 10,
  },
  input: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    color: COLORS.textPrimary, fontSize: 15, maxHeight: 100,
    borderWidth: 1, borderColor: COLORS.surfaceLight,
  },
  inputDisabled: { opacity: 0.5 },
  sendBtn: { backgroundColor: COLORS.roxy, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
