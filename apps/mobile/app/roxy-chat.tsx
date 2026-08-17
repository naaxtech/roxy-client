import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../store/authStore';
import { callEdgeFunction } from '../lib/supabase';
import { Analytics } from '../lib/analytics';
import { useThemeColors } from '../hooks/useThemeColors';
import { showAlert } from '../lib/confirm';
import { BRAND_GRADIENT } from '../lib/theme';

type Message = { role: 'user' | 'roxy'; content: string };

// Roxy's brand identity gradient — used for her wordmark, avatar mark, and
// the "what's on your mind" suggestion chips. Keeps her visually distinct
// from the plain user/partner bubbles used elsewhere in Connect.

type Suggestion = { label: string; emoji: string; prompt: string; gradient: [string, string] };

const SUGGESTIONS: Suggestion[] = [
  { label: 'Dating Advice', emoji: '💕', prompt: 'Give me some dating advice', gradient: ['#FF6A2E', '#FF2F71'] },
  { label: 'Her Texts', emoji: '💬', prompt: 'Help me decode her last text', gradient: ['#FF2F71', '#FF6A2E'] },
  { label: 'Confidence Tips', emoji: '🤝', prompt: 'Give me some confidence tips', gradient: ['#FF6A2E', '#E81C8E'] },
  { label: 'Queer Events', emoji: '🌈', prompt: 'What queer events are happening?', gradient: ['#8B5CF6', '#E81C8E'] },
];

export default function RoxyChatScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const heroAnim = useRef(new Animated.Value(0)).current;

  const conversationId = `roxy-${user?.id ?? 'anon'}`;

  useEffect(() => {
    Analytics.roxyChatOpened();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  // Hero "pop" entrance for the greeting card + suggestion chips — no slide,
  // just a soft scale/opacity spring on first mount.
  useEffect(() => {
    Animated.spring(heroAnim, {
      toValue: 1, friction: 7, tension: 60, useNativeDriver: true,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared send path so both the composer and the suggestion chips funnel
  // through identical request/response/error handling.
  const sendText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setLoading(true);

    try {
      const { data, error: fnError } = await callEdgeFunction<{ response: string }>('roxy-chat', {
        conversation_id: conversationId,
        message: trimmed,
      });

      if (fnError) {
        showAlert('Roxy is unavailable', fnError);
        return;
      }

      if (data?.response) {
        setMessages((prev) => [...prev, { role: 'roxy', content: data.response }]);
      }
    } catch {
      showAlert('Something went wrong', 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    await sendText(input);
  };

  const handleSuggestion = (prompt: string) => {
    void sendText(prompt);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    backBtn: { minWidth: 60, minHeight: 44, flexDirection: 'row', alignItems: 'center' },
    backLabel: { fontSize: 15, color: colors.roxy, fontWeight: '600', marginLeft: 2 },
    headerCenter: {
      flex: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 4,
    },
    headerTitle: { fontSize: 20, fontWeight: '800', color: colors.roxy, letterSpacing: 0.5 },
    headerSpacer: { minWidth: 60 },

    messageList: { flex: 1 },
    messageListContent: { paddingHorizontal: 16, paddingVertical: 20, gap: 10, flexGrow: 1 },

    // Empty-state hero: avatar mark + greeting card + suggestion chips
    heroWrap: { alignItems: 'center', paddingTop: 20, paddingHorizontal: 12, paddingBottom: 8 },
    heroAvatarRing: {
      width: 92, height: 92, borderRadius: 46,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#FF2F71', shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
    },
    greetingCard: {
      backgroundColor: colors.surface, borderRadius: 22,
      paddingHorizontal: 20, paddingVertical: 18,
      marginTop: -18, width: '100%',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    },
    greetingTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: 6 },
    greetingBody: { color: colors.textSecondary, fontSize: 14.5, lineHeight: 21 },
    heroCaret: { marginTop: 4 },
    promptLabel: {
      color: colors.textPrimary, fontSize: 16, fontWeight: '700',
      textAlign: 'center', marginTop: 16, marginBottom: 12,
    },
    chipsGrid: {
      flexDirection: 'row', flexWrap: 'wrap',
      gap: 10, width: '100%',
    },
    chip: { flexBasis: '47%', flexGrow: 1, borderRadius: 18, minHeight: 48, overflow: 'hidden' },
    chipInner: {
      flex: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 12, gap: 6,
    },
    chipEmoji: { fontSize: 15 },
    chipLabel: { color: '#fff', fontWeight: '700', fontSize: 13.5 },

    // Roxy's small avatar mark shown beside her bubbles — the identity cue
    // that makes her messages read as distinct from the user's own.
    roxyAvaSlot: { width: 26, marginRight: 8, alignSelf: 'flex-end' },
    roxyAva: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

    bubbleWrap: { flexDirection: 'row', marginVertical: 4, alignItems: 'flex-end' },
    bubbleWrapUser: { justifyContent: 'flex-end' },
    bubbleWrapRoxy: { justifyContent: 'flex-start' },
    bubble: { maxWidth: '78%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 11 },
    bubbleUser: {
      backgroundColor: colors.primary, borderBottomRightRadius: 6,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 1,
    },
    bubbleRoxy: {
      backgroundColor: colors.surface, borderBottomLeftRadius: 6,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
    },
    bubbleText: { fontSize: 15, lineHeight: 22 },
    bubbleTextUser: { color: '#fff' },
    bubbleTextRoxy: { color: colors.textPrimary },

    thinkingWrap: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 4 },
    thinkingBubble: {
      backgroundColor: colors.surface, borderRadius: 20, borderBottomLeftRadius: 6,
      paddingHorizontal: 14, paddingVertical: 10,
      flexDirection: 'row', alignItems: 'center', gap: 8,
    },
    thinkingText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },

    inputArea: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
      borderTopWidth: 1, borderTopColor: colors.surfaceLight, gap: 10,
    },
    input: {
      flex: 1, backgroundColor: colors.surface, borderRadius: 24,
      paddingHorizontal: 18, paddingVertical: 12,
      color: colors.textPrimary, fontSize: 15, maxHeight: 100, minHeight: 44,
    },
    inputDisabled: { opacity: 0.5 },
    sendBtn: { borderRadius: 24, minHeight: 44, minWidth: 76, overflow: 'hidden' },
    sendBtnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
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
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.roxy} />
            <Text style={styles.backLabel}>Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>ROXY</Text>
            <Ionicons name="sparkles" size={16} color={colors.roxy} />
          </View>
          <View style={styles.headerSpacer} />
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <Animated.View
              style={[
                styles.heroWrap,
                {
                  opacity: heroAnim,
                  transform: [{ scale: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
                },
              ]}
            >
              <LinearGradient colors={BRAND_GRADIENT} style={styles.heroAvatarRing}>
                <Ionicons name="sparkles" size={38} color="#fff" />
              </LinearGradient>

              <View style={styles.greetingCard}>
                <Text style={styles.greetingTitle}>Hey! I'm Roxy 😄</Text>
                <Text style={styles.greetingBody}>
                  Your WLW wingwoman 💜{'\n'}Ask me anything — dating, confidence… or decoding her last text 👀
                </Text>
              </View>

              <Ionicons name="caret-down" size={16} color={colors.roxy} style={styles.heroCaret} />

              <Text style={styles.promptLabel}>What's on your mind today?</Text>

              <View style={styles.chipsGrid}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity
                    key={s.label}
                    style={styles.chip}
                    onPress={() => handleSuggestion(s.prompt)}
                    disabled={loading}
                    accessibilityRole="button"
                    accessibilityLabel={`Ask Roxy about ${s.label}`}
                  >
                    <LinearGradient colors={s.gradient} style={styles.chipInner}>
                      <Text style={styles.chipEmoji}>{s.emoji}</Text>
                      <Text style={styles.chipLabel}>{s.label}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </View>
            </Animated.View>
          )}

          {messages.map((msg, idx) => (
            <View
              key={idx}
              style={[
                styles.bubbleWrap,
                msg.role === 'user' ? styles.bubbleWrapUser : styles.bubbleWrapRoxy,
              ]}
            >
              {msg.role === 'roxy' && (
                <View style={styles.roxyAvaSlot}>
                  <LinearGradient colors={BRAND_GRADIENT} style={styles.roxyAva}>
                    <Ionicons name="sparkles" size={12} color="#fff" />
                  </LinearGradient>
                </View>
              )}
              <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleRoxy]}>
                <Text style={[styles.bubbleText, msg.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextRoxy]}>
                  {msg.content}
                </Text>
              </View>
            </View>
          ))}

          {loading && (
            <View style={styles.thinkingWrap}>
              <View style={styles.roxyAvaSlot}>
                <LinearGradient colors={BRAND_GRADIENT} style={styles.roxyAva}>
                  <Ionicons name="sparkles" size={12} color="#fff" />
                </LinearGradient>
              </View>
              <View style={styles.thinkingBubble}>
                <Text style={styles.thinkingText}>Roxy is thinking…</Text>
                <ActivityIndicator size="small" color={colors.roxy} />
              </View>
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
            accessibilityLabel="Message Roxy"
            // Web: Enter sends, Shift+Enter inserts a newline (chat convention).
            onKeyPress={(e: any) => {
              if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
                e.preventDefault?.();
                if (input.trim() && !loading) void handleSend();
              }
            }}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (loading || !input.trim()) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={loading || !input.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <LinearGradient colors={BRAND_GRADIENT} style={styles.sendBtnGradient}>
              <Text style={styles.sendBtnText}>Send</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
