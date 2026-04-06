// apps/mobile/app/(tabs)/discover/community/post/[postId].tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView,
  Platform, FlatList, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../../../lib/supabase';
import { useAuthStore } from '../../../../../store/authStore';
import { COLORS } from '../../../../../lib/constants';
import { Analytics } from '../../../../../lib/analytics';
import type { Comment } from '../../../../../types';

const MAX_CHARS = 500;

type PostRow = {
  id: string;
  content: string;
  created_at: string;
  comment_count: number;
  profiles: { display_name: string; avatar_url: string | null } | null;
};

type CommentRow = Comment & {
  profiles: { display_name: string; avatar_url: string | null } | null;
};

export default function PostDetailScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const listRef = useRef<FlatList>(null);

  const [post, setPost] = useState<PostRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadPost = useCallback(async () => {
    if (!postId) return;
    const { data } = await supabase
      .from('posts')
      .select('id, content, created_at, comment_count, profiles(display_name, avatar_url)')
      .eq('id', postId)
      .single();
    if (data) setPost(data as unknown as PostRow);
  }, [postId]);

  const loadComments = useCallback(async () => {
    if (!postId) return;
    const { data } = await supabase
      .from('comments')
      .select('*, profiles(display_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) setComments(data as CommentRow[]);
  }, [postId]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadPost(), loadComments()]);
      setLoading(false);
      if (postId) Analytics.postViewed(postId);
    })();
  }, [loadPost, loadComments]);

  const handleSubmit = async () => {
    if (!draft.trim() || !user || !postId || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('comments')
        .insert({ post_id: postId, author_id: user.id, content: draft.trim() })
        .select('*, profiles(display_name, avatar_url)')
        .single();
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        setComments((prev) => [...prev, data as CommentRow]);
        setPost((prev) => prev ? { ...prev, comment_count: prev.comment_count + 1 } : prev);
        setDraft('');
        Analytics.commentCreated(postId);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const userInitial = user?.email?.[0]?.toUpperCase() ?? '?';

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.errorText}>Post not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={52}
      >
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View>
              {/* Original post */}
              <View style={styles.postCard}>
                <View style={styles.authorRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {post.profiles?.display_name?.[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.authorName}>{post.profiles?.display_name ?? 'Anonymous'}</Text>
                    <Text style={styles.postTime}>{format(new Date(post.created_at), 'dd MMM · HH:mm')}</Text>
                  </View>
                </View>
                <Text style={styles.postContent}>{post.content}</Text>
                <Text style={styles.commentCountLabel}>
                  {post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}
                </Text>
              </View>

              <View style={styles.divider} />

              {comments.length === 0 && (
                <View style={styles.emptyComments}>
                  <Text style={styles.emptyIcon}>💬</Text>
                  <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.commentRow}>
              <View style={styles.commentAvatar}>
                <Text style={styles.commentAvatarText}>
                  {item.profiles?.display_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              </View>
              <View style={styles.commentBody}>
                <Text style={styles.commentText}>
                  <Text style={styles.commentAuthor}>{item.profiles?.display_name ?? 'Anonymous'} </Text>
                  {item.content}
                </Text>
                <Text style={styles.commentTime}>{format(new Date(item.created_at), 'dd MMM · HH:mm')}</Text>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 16 }}
        />

        {/* Instagram-style composer */}
        <View style={styles.composer}>
          <View style={styles.composerAvatar}>
            <Text style={styles.composerAvatarText}>{userInitial}</Text>
          </View>
          <TextInput
            style={styles.composerInput}
            placeholder="Add a comment…"
            placeholderTextColor={COLORS.textMuted}
            value={draft}
            onChangeText={(t) => setDraft(t.slice(0, MAX_CHARS))}
            multiline
            maxLength={MAX_CHARS}
          />
          {draft.trim().length > 0 && (
            <TouchableOpacity onPress={handleSubmit} disabled={submitting}>
              {submitting
                ? <ActivityIndicator size="small" color={COLORS.roxy} />
                : <Text style={styles.postBtn}>Post</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
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
  backRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },

  // Post
  postCard: { backgroundColor: COLORS.surface, padding: 14, marginBottom: 0 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 14 },
  authorName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  postTime: { color: COLORS.textMuted, fontSize: 12 },
  postContent: { color: COLORS.textPrimary, fontSize: 16, lineHeight: 24, marginBottom: 12 },
  commentCountLabel: { color: COLORS.textMuted, fontSize: 13 },

  divider: { height: 1, backgroundColor: COLORS.surface, marginVertical: 8 },

  // Empty
  emptyComments: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyIcon: { fontSize: 36 },
  emptyText: { color: COLORS.textMuted, fontSize: 14 },

  // Comments — Instagram flat style
  commentRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  commentAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
    marginTop: 2, flexShrink: 0,
  },
  commentAvatarText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: 12 },
  commentBody: { flex: 1 },
  commentText: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  commentAuthor: { fontWeight: '700', color: COLORS.textPrimary },
  commentTime: { color: COLORS.textMuted, fontSize: 11, marginTop: 3 },

  // Composer — Instagram style
  composer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  composerAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.primary + '40',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  composerAvatarText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  composerInput: {
    flex: 1, color: COLORS.textPrimary, fontSize: 14,
    maxHeight: 80, paddingVertical: 4,
  },
  postBtn: { color: COLORS.roxy, fontWeight: '700', fontSize: 14 },

  errorText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 48, fontSize: 16 },
});
