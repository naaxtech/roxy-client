import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../../../../store/authStore';
import { callEdgeFunction } from '../../../../lib/supabase';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { BRAND_INK } from '../../../../lib/theme';
import { showAlert } from '../../../../lib/confirm';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export default function SisterButtonScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const colors = useThemeColors();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);
  const [resources, setResources] = useState<{ name: string; number?: string; instruction?: string; contact?: string; type?: string }[] | null>(null);
  const [directory, setDirectory] = useState<{ name: string; url?: string; description?: string }[] | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0d0520' },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    headerPlate: {
      width: 38, height: 38, borderRadius: 13,
      alignItems: 'center', justifyContent: 'center',
    },
    backButton: {
      width: 40,
      alignItems: 'center',
    },
    headerCenter: {
      flex: 1,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: '#fff',
    },
    headerSubtitle: {
      fontSize: 11.5,
      color: '#B9A8D8',
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
    emptyPlate: {
      width: 64, height: 64, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#8E7CF7', shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4, shadowRadius: 20, elevation: 8,
    },
    chipsWrap: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 8,
      justifyContent: 'center', marginTop: 10,
    },
    chip: {
      borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
      backgroundColor: 'rgba(142,124,247,0.14)',
      borderWidth: 1, borderColor: 'rgba(142,124,247,0.35)',
    },
    chipText: { color: '#CFC3EE', fontSize: 13, fontWeight: '600' },
    // Sister is always a dark stage — fixed light text, never theme tokens
    // (light-theme tokens would render dark-on-dark here).
    emptyTitle: {
      color: '#FFFFFF',
      fontSize: 20,
      fontWeight: '800',
      marginTop: 6,
    },
    emptyBody: {
      color: '#C9BCE4',
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
      borderBottomRightRadius: 6,
      overflow: 'hidden',
    },
    bubbleAssistant: {
      backgroundColor: 'rgba(255,255,255,0.07)',
      borderBottomLeftRadius: 6,
    },
    messageText: { fontSize: 15, lineHeight: 22 },
    // Her own words sit on the #8E7CF7 → #C86DD7 lilac; white on those is
    // 3.29:1 and 3.17:1. Dark ink is 5.66:1 and 5.88:1.
    messageTextUser: { color: BRAND_INK },
    messageTextAssistant: { color: '#EDE7F8' },

    thinkingWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 8,
      paddingHorizontal: 4,
    },
    thinkingText: {
      color: colors.textMuted,
      fontSize: 13,
      fontStyle: 'italic',
    },

    resourcesCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      marginTop: 16,
      borderWidth: 1,
      borderColor: colors.roxy + '40',
      gap: 10,
    },
    resourcesTitle: {
      color: colors.roxy,
      fontWeight: '700',
      fontSize: 14,
      marginBottom: 4,
    },
    resourceRow: { gap: 2 },
    resourceName: {
      color: colors.textPrimary,
      fontWeight: '600',
      fontSize: 14,
    },
    resourceContact: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    resourceUrl: {
      color: colors.secondary,
      fontSize: 13,
    },
    resourceDivider: {
      height: 1,
      backgroundColor: colors.surfaceLight,
      marginVertical: 4,
    },

    sessionDone: {
      alignItems: 'center',
      paddingVertical: 24,
      paddingHorizontal: 20,
    },
    sessionDoneText: {
      color: colors.textSecondary,
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
      borderTopColor: colors.surface,
      gap: 10,
      backgroundColor: '#0d0520',
    },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 10,
      color: colors.textPrimary,
      fontSize: 15,
      maxHeight: 100,
      borderWidth: 1,
      borderColor: colors.surfaceLight,
    },
    inputDisabled: {
      opacity: 0.5,
    },
    sendButton: {
      width: 42, height: 42, borderRadius: 21,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonInner: {
      width: 42, height: 42, borderRadius: 21,
      alignItems: 'center', justifyContent: 'center',
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
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 24,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primary,
    },
    restartBtnText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  });

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
        showAlert('Something went wrong', 'Please try again.');
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
      showAlert('Something went wrong', 'Please try again.');
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
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <LinearGradient colors={['#8E7CF7', '#C86DD7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.headerPlate}>
            <Ionicons name="moon" size={18} color={BRAND_INK} />
          </LinearGradient>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Sister</Text>
            <Text style={styles.headerSubtitle}>Private - gentle - judgement-free</Text>
          </View>
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
              <LinearGradient colors={['#8E7CF7', '#C86DD7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.emptyPlate}>
                <Ionicons name="moon" size={30} color={BRAND_INK} />
              </LinearGradient>
              <Text style={styles.emptyTitle}>Hi, I'm Sister</Text>
              <Text style={styles.emptyBody}>
                This is a safe space. You can share what's on your mind — I'm here to listen, without judgment.
              </Text>
              <View style={styles.chipsWrap}>
                {["I'm feeling overwhelmed", 'Something happened today', 'I just need to vent'].map((c) => (
                  <TouchableOpacity key={c} style={styles.chip} onPress={() => setInput(c)} activeOpacity={0.8}>
                    <Text style={styles.chipText}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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
              {msg.role === 'user' ? (
                <LinearGradient
                  colors={['#8E7CF7', '#C86DD7']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.messageBubble, styles.bubbleUser]}
                >
                  <Text style={[styles.messageText, styles.messageTextUser]}>{msg.content}</Text>
                </LinearGradient>
              ) : (
                <View style={[styles.messageBubble, styles.bubbleAssistant]}>
                  <Text style={[styles.messageText, styles.messageTextAssistant]}>{msg.content}</Text>
                </View>
              )}
            </View>
          ))}

          {loading && (
            <View style={styles.thinkingWrap}>
              <Text style={styles.thinkingText}>Sister is listening…</Text>
              <ActivityIndicator size="small" color={colors.roxy} style={{ marginLeft: 8 }} />
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
            placeholderTextColor={colors.textMuted}
            multiline
            editable={!loading && !sessionDone}
            returnKeyType="default"
            onKeyPress={(e: any) => {
              if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
                e.preventDefault?.();
                if (input.trim() && !loading && !sessionDone) void handleSend();
              }
            }}
          />
          <TouchableOpacity
            style={[styles.sendButton, (loading || sessionDone || !input.trim()) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={loading || sessionDone || !input.trim()}
            activeOpacity={0.75}
            accessibilityLabel="Send message"
          >
            <LinearGradient colors={['#8E7CF7', '#C86DD7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendButtonInner}>
              <Ionicons name="send" size={16} color={BRAND_INK} />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
