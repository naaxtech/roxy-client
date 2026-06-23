import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator, Share, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useFeedStore } from '../../../../store/feedStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { fetchPostById } from '../../../../lib/posts';
import { routeParam } from '../../../../lib/routeParams';
import { COMMENT_WITH_AUTHOR } from '../../../../lib/supabaseQueries';
import { submitComment } from '../../../../lib/comments';
import { PostMediaCarousel } from '../../../../components/feed/PostMediaCarousel';
import { CommentThread } from '../../../../components/feed/CommentThread';
import type { Comment, Post } from '../../../../types';

export default function PostDetailScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ postId: string | string[] }>();
  const postId = routeParam(params.postId);
  const router = useRouter();
  const { user } = useAuthStore();
  const { likedPostIds, savedPostIds, toggleLike, toggleSave, bumpCommentCount } = useFeedStore();

  const [post, setPost] = useState<Post | null>(null);
  const [loadingPost, setLoadingPost] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [comments, setComments] = useState<Comment[]>([]);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(new Set());
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);

  useEffect(() => {
    if (!postId) {
      setPost(null);
      setLoadError('Invalid post link');
      setLoadingPost(false);
      return;
    }

    const cached = useFeedStore.getState().posts.find(p => p.id === postId) ?? null;
    if (cached) {
      setPost(cached);
      setLoadError(null);
      setLoadingPost(false);
      return;
    }

    let cancelled = false;
    setLoadingPost(true);
    setLoadError(null);
    void fetchPostById(postId).then((p) => {
      if (cancelled) return;
      if (p) useFeedStore.getState().upsertPost(p);
      setPost(p);
      setLoadError(p ? null : 'This post could not be loaded.');
      setLoadingPost(false);
    });
    return () => { cancelled = true; };
  }, [postId]);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    void loadComments(() => cancelled);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const loadComments = async (isCancelled?: () => boolean) => {
    if (!postId) return;
    setLoadingComments(true);
    const { data, error } = await supabase
      .from('comments')
      .select(COMMENT_WITH_AUTHOR)
      .eq('post_id', postId)
      .is('parent_id', null)
      .order('created_at', { ascending: true })
      .limit(20);

    if (isCancelled?.()) return;
    if (error) { setLoadingComments(false); return; }

    const topLevel = (data ?? []) as Comment[];
    const topLevelIds = topLevel.map(c => c.id);

    // Single batch query for all replies — replaces N+1
    const repliesRes = topLevelIds.length
      ? await supabase
          .from('comments')
          .select(COMMENT_WITH_AUTHOR)
          .in('parent_id', topLevelIds)
          .order('created_at', { ascending: true })
      : { data: [] };

    if (isCancelled?.()) return;

    const repliesByParent = new Map<string, Comment[]>();
    for (const r of (repliesRes.data ?? []) as Comment[]) {
      if (!r.parent_id) continue;
      const arr = repliesByParent.get(r.parent_id) ?? [];
      arr.push(r);
      repliesByParent.set(r.parent_id, arr);
    }
    const withReplies = topLevel.map(c => ({ ...c, replies: repliesByParent.get(c.id) ?? [] }));

    if (user?.id) {
      const ids = withReplies.flatMap(c => [c.id, ...c.replies.map(r => r.id)]);
      if (ids.length) {
        const { data: likes } = await supabase
          .from('comment_likes')
          .select('comment_id')
          .in('comment_id', ids)
          .eq('user_id', user.id);
        if (!isCancelled?.()) setLikedCommentIds(new Set(likes?.map(l => l.comment_id) ?? []));
      }
    }

    if (!isCancelled?.()) {
      setComments(withReplies);
      setLoadingComments(false);
    }
  };

  const handleLikeComment = async (commentId: string) => {
    const wasLiked = likedCommentIds.has(commentId);
    setLikedCommentIds(s => {
      const next = new Set(s);
      if (wasLiked) { next.delete(commentId); } else { next.add(commentId); }
      return next;
    });
    if (wasLiked) {
      await supabase.from('comment_likes').delete()
        .eq('comment_id', commentId).eq('user_id', user?.id ?? '');
    } else {
      await supabase.from('comment_likes').insert({ comment_id: commentId });
    }
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !user?.id || !postId || submitting) return;
    setSubmitting(true);
    const { comment, error } = await submitComment({
      postId,
      authorId: user.id,
      content: commentText.trim(),
      parentId: replyingTo?.id ?? null,
    });
    if (error || !comment) {
      Alert.alert('Comment not saved', error ?? 'Please sign in and try again.');
    } else {
      setCommentText('');
      setReplyingTo(null);
      bumpCommentCount(postId);
      await loadComments(undefined);
    }
    setSubmitting(false);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
      borderBottomColor: colors.surface,
    },
    backBtn: { color: colors.primary, fontSize: 15, fontWeight: '600' },
    headerAuthor: { color: colors.textMuted, fontSize: 13 },
    detailImage: { width: '100%', height: 400 },
    captionBlock: { padding: 16 },
    caption: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
    divider: { height: 1, backgroundColor: colors.surface, marginHorizontal: 16 },
    sectionHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    sectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    stickyBar: {
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
      paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.surface,
      backgroundColor: colors.background, gap: 8,
    },
    stickyAction: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    stickyCount: { fontSize: 13, color: colors.textMuted },
    iconActive: { color: colors.primary },
    commentInput: {
      flex: 1, backgroundColor: colors.surface,
      borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
      color: colors.textPrimary, fontSize: 14, maxHeight: 80,
    },
    replyChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.primary + '20',
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    },
    replyChipText: { color: colors.primary, fontSize: 11 },
    errorBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    errorText: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  });

  if (loadingPost) {
    return (
      <SafeAreaView style={styles.container}>
        <View testID="post-detail-loading" style={{ flex: 1 }}>
          <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.container}>
        <View testID="post-detail-error" style={{ flex: 1 }}>
        <TouchableOpacity testID="post-detail-back" onPress={() => router.back()} style={styles.header}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.errorBody}>
          <Text style={styles.errorText}>{loadError ?? 'Post not found'}</Text>
        </View>
        </View>
      </SafeAreaView>
    );
  }

  const isLiked = likedPostIds.has(post.id);
  const isSaved = savedPostIds.has(post.id);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View testID="post-detail-screen" style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity testID="post-detail-back" onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.backBtn}>← Post</Text>
          </TouchableOpacity>
          <Text style={styles.headerAuthor}>@{post.profiles?.display_name ?? ''}</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Media */}
          {(post.post_type === 'photo' || post.post_type === 'gallery') &&
            post.media_urls.length > 0 && (
              <PostMediaCarousel
                urls={post.media_urls}
                blurhash={post.blurhash}
                variant="detail"
              />
            )}

          {/* Caption */}
          <View style={styles.captionBlock}>
            <Text style={styles.caption}>{post.content}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Comments ({loadingComments ? '…' : comments.length})
            </Text>
          </View>

          {loadingComments ? (
            <ActivityIndicator color={colors.primary} style={{ padding: 32 }} />
          ) : (
            <CommentThread
              postId={post.id}
              comments={comments}
              currentUserId={user?.id ?? ''}
              likedCommentIds={likedCommentIds}
              onLikeComment={handleLikeComment}
              onReply={c => setReplyingTo(c)}
            />
          )}

          <View style={{ height: 80 }} />
        </ScrollView>

        {/* Sticky action bar */}
        <View style={styles.stickyBar}>
          <TouchableOpacity
            onPress={() => void toggleLike(post.id)}
            style={styles.stickyAction}
            accessibilityRole="button"
            accessibilityLabel={isLiked ? 'Unlike post' : 'Like post'}
          >
            <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={20} color={isLiked ? colors.primary : colors.textMuted} />
            <Text style={[styles.stickyCount, isLiked && styles.iconActive]}>
              {post.like_count}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => void toggleSave(post.id)}
            style={styles.stickyAction}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? 'Remove from saved' : 'Save post'}
          >
            <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={19} color={isSaved ? colors.primary : colors.textMuted} />
            <Text style={[styles.stickyCount, isSaved && styles.iconActive]}>
              {post.save_count}
            </Text>
          </TouchableOpacity>

          {replyingTo && (
            <TouchableOpacity onPress={() => setReplyingTo(null)} style={styles.replyChip}>
              <Text style={styles.replyChipText}>@{replyingTo.profiles?.display_name}</Text>
              <Ionicons name="close" size={12} color={colors.primary} />
            </TouchableOpacity>
          )}

          <TextInput
            style={styles.commentInput}
            placeholder={replyingTo ? `Reply to ${replyingTo.profiles?.display_name}…` : 'Add a comment…'}
            placeholderTextColor={colors.textMuted}
            value={commentText}
            onChangeText={setCommentText}
            returnKeyType="send"
            onSubmitEditing={handleSubmitComment}
          />

          <TouchableOpacity
            onPress={handleSubmitComment}
            disabled={!commentText.trim() || submitting}
            hitSlop={8}
          >
            {submitting
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Ionicons name="arrow-up-circle" size={26} color={commentText.trim() ? colors.primary : colors.textMuted} />
            }
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => void Share.share({ message: 'Check this out on Roxy!' })}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Share post"
          >
            <Ionicons name="arrow-redo-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

