import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { usePopIn } from '../ui/popIn';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { CommentThread } from './CommentThread';
import { appendComment, submitComment } from '../../lib/comments';
import { showAlert } from '../../lib/confirm';
import { useFeedStore } from '../../store/feedStore';
import type { Comment } from '../../types';

const ON_COLOR = '#FFFFFF';

interface CommentSheetProps {
  visible: boolean;
  postId: string;
  comments: Comment[];
  likedCommentIds: Set<string>;
  currentUserId: string;
  onClose: () => void;
  onLikeComment: (id: string) => void;
  onCommentsChange: (comments: Comment[]) => void;
}

export function CommentSheet({
  visible, postId, comments, likedCommentIds, currentUserId,
  onClose, onLikeComment, onCommentsChange,
}: CommentSheetProps) {
  const colors = useThemeColors();
  const pop = usePopIn(visible);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const bumpCommentCount = useFeedStore((s) => s.bumpCommentCount);

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
      maxHeight: '75%', paddingTop: 12,
      width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
    },
    handle: {
      width: 40, height: 4, backgroundColor: colors.textMuted,
      borderRadius: 2, alignSelf: 'center', marginBottom: 12,
    },
    header: {
      flexDirection: 'row', justifyContent: 'space-between',
      alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12,
    },
    title: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    scroll: { maxHeight: 360 },
    empty: { paddingHorizontal: 20, paddingVertical: 28 },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
    replyBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 8,
      backgroundColor: colors.surface,
      gap: 8,
    },
    replyBarText: { flex: 1, color: colors.textSecondary, fontSize: 12 },
    inputRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 16, paddingVertical: 12,
      borderTopWidth: 1, borderTopColor: colors.surface,
    },
    input: {
      flex: 1, backgroundColor: colors.surface,
      borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
      color: colors.textPrimary, fontSize: 14, maxHeight: 80,
    },
    send: {
      width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: 22,
      backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    sendOff: { backgroundColor: colors.surfaceLight },
  });

  const handleSubmit = async () => {
    if (!text.trim() || !currentUserId || submitting) return;
    setSubmitting(true);
    const parentId = replyingTo?.parent_id ?? replyingTo?.id ?? null;
    const { comment, error } = await submitComment({
      postId,
      authorId: currentUserId,
      content: text.trim(),
      parentId,
    });
    setSubmitting(false);
    if (error || !comment) {
      showAlert('Comment not saved', error ?? 'Please try again.');
      return;
    }
    setText('');
    setReplyingTo(null);
    onCommentsChange(appendComment(comments, { ...comment, parent_id: parentId }));
    bumpCommentCount(postId);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.sheet, pop]} testID="comment-sheet">
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>
              {comments.length === 0 ? 'Comments' : `Comments (${comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0)})`}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close comments">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll} keyboardShouldPersistTaps="handled">
            {comments.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Be the first to comment</Text>
              </View>
            ) : (
              <CommentThread
                postId={postId}
                comments={comments}
                currentUserId={currentUserId}
                likedCommentIds={likedCommentIds}
                onLikeComment={onLikeComment}
                onReply={setReplyingTo}
              />
            )}
            <View style={{ height: 8 }} />
          </ScrollView>
          {replyingTo ? (
            <View style={styles.replyBar} testID="comment-reply-bar">
              <Text style={styles.replyBarText} numberOfLines={1}>
                Replying to {replyingTo.profiles?.display_name ?? 'her'}
              </Text>
              <TouchableOpacity
                onPress={() => setReplyingTo(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={replyingTo ? 'Add a reply…' : 'Add a comment…'}
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              returnKeyType="send"
              onSubmitEditing={() => void handleSubmit()}
              testID="comment-input"
            />
            <TouchableOpacity
              style={[styles.send, (!text.trim() || submitting) && styles.sendOff]}
              onPress={() => void handleSubmit()}
              disabled={!text.trim() || submitting}
              accessibilityRole="button"
              accessibilityLabel="Send comment"
              testID="comment-send"
            >
              {submitting
                ? <ActivityIndicator size="small" color={ON_COLOR} />
                : <Ionicons name="arrow-up" size={18} color={text.trim() ? ON_COLOR : colors.textMuted} />}
            </TouchableOpacity>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
