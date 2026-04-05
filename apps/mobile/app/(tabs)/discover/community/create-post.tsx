import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';
import { logError } from '../../../../lib/errorLogger';
import { Analytics } from '../../../../lib/analytics';

const MAX_CHARS = 500;

export default function CreatePostScreen() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handlePost = async () => {
    if (!content.trim() || !user || !communityId) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('posts').insert({
        author_id: user.id,
        community_id: communityId,
        content: content.trim(),
      });
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Analytics.postCreated(communityId);
        router.back();
      }
    } catch (e: any) {
      logError(e, 'handlePost');
      Alert.alert('Error', e?.message ?? 'Could not create post');
    } finally {
      setSubmitting(false);
    }
  };

  const remaining = MAX_CHARS - content.length;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Post</Text>
        <TouchableOpacity
          style={[styles.postBtn, (!content.trim() || submitting) && styles.postBtnDisabled]}
          onPress={handlePost}
          disabled={!content.trim() || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.postBtnText}>Post</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Input */}
      <TextInput
        style={styles.input}
        multiline
        placeholder="What's on your mind?"
        placeholderTextColor={COLORS.textMuted}
        value={content}
        onChangeText={(t) => setContent(t.slice(0, MAX_CHARS))}
        autoFocus
        textAlignVertical="top"
      />

      {/* Character counter */}
      <View style={styles.footer}>
        <Text style={[styles.charCount, remaining < 50 && styles.charCountWarn]}>
          {remaining} characters remaining
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  postBtn: {
    backgroundColor: COLORS.roxy, borderRadius: 16,
    paddingHorizontal: 18, paddingVertical: 8,
    minWidth: 60, alignItems: 'center',
  },
  postBtnDisabled: { opacity: 0.4 },
  postBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  input: {
    flex: 1, color: COLORS.textPrimary, fontSize: 16, lineHeight: 24,
    padding: 20, textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: 20, paddingBottom: 16,
    borderTopWidth: 1, borderTopColor: COLORS.surface,
  },
  charCount: { color: COLORS.textMuted, fontSize: 13, textAlign: 'right', paddingTop: 8 },
  charCountWarn: { color: COLORS.primary },
});
