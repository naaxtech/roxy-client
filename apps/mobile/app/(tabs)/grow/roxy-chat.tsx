import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../../store/authStore';
import { callEdgeFunction } from '../../../lib/supabase';
import { Analytics } from '../../../lib/analytics';
import { useThemeColors } from '../../../hooks/useThemeColors';

type Message = { role: 'user' | 'roxy'; content: string };

export default function RoxyChatScreen() {
  const colors = useThemeColors();
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

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { width: 60, flexDirection: 'row', alignItems: 'center' },
    backLabel: { fontSize: 15, color: colors.textPrimary, marginLeft: 2 },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
    messageList: { flex: 1 },
    messageListContent: { paddingHorizontal: 16, paddingVertical: 20, gap: 10, flexGrow: 1 },
    emptyState: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingVertical: 60, gap: 12, paddingHorizontal: 16,
    },
    emptyIcon: { fontSize: 48 },
    emptyTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
    emptyBody: { color: colors.textSecondary, textAlign: 'center', lineHeight: 22, fontSize: 15 },
    bubbleWrap: { flexDirection: 'row', marginVertical: 4 },
    bubbleWrapUser: { justifyContent: 'flex-end' },
    bubbleWrapRoxy: { justifyContent: 'flex-start' },
    bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
    bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
    bubbleRoxy: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.roxy + '40' },
    bubbleText: { fontSize: 15, lineHeight: 22 },
    bubbleTextUser: { color: '#fff' },
    bubbleTextRoxy: { color: colors.textPrimary },
    thinkingWrap: { flexDirection: 'row', alignItems: 'center', marginVertical: 8, paddingHorizontal: 4 },
    thinkingText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
    inputArea: {
      flexDirection: 'row', alignItems: 'flex-end',
      paddingHorizontal: 16, paddingVertical: 12,
      borderTopWidth: 1, borderTopColor: colors.surface, gap: 10,
    },
    input: {
      flex: 1, backgroundColor: colors.surface, borderRadius: 20,
      paddingHorizontal: 16, paddingVertical: 10,
      color: colors.textPrimary, fontSize: 15, maxHeight: 100,
      borderWidth: 1, borderColor: colors.surfaceLight,
    },
    inputDisabled: { opacity: 0.5 },
    sendBtn: { backgroundColor: colors.roxy, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
    sendBtnDisabled: { opacity: 0.4 },
    sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  });

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
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
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
              <ActivityIndicator size="small" color={colors.roxy} style={{ marginLeft: 8 }} />
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
            placeholderTextColor={colors.textMuted}
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

