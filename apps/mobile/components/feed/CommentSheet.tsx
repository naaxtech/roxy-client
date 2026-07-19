import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { CommentThread } from './CommentThread';
import { submitComment } from '../../lib/comments';
import { showAlert } from '../../lib/confirm';
import { useFeedStore } from '../../store/feedStore';
import type { Comment } from '../../types';

interface CommentSheetProps {
  visible: boolean;
  postId: string;
  comments: Comment[];
  likedCommentIds: Set<string>;
  currentUserId: string;
  onClose: () => void;
  onLikeComment: (id: string) => void;
  onReply: (comment: Comment) => void;
  onCommentsChange: (comments: Comment[]) => void;
}

export function CommentSheet({
  visible, postId, comments, likedCommentIds, currentUserId,
  onClose, onLikeComment, onReply, onCommentsChange,
}: CommentSheetProps) {
  const colors = useThemeColors();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bumpCommentCount = useFeedStore(s => s.bumpCommentCount);

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      maxHeight: '75%', paddingTop: 12,
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
    inputRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 16, paddingVertical: 12,
      borderTopWidth: 1, borderTopColor: colors.surface,
    },
    input: {
      flex: 1, backgroundColor: colors.surface,
      borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
      color: colors.textPrimary, fontSize: 14,
    },
  });

  const handleSubmit = async () => {
    if (!text.trim() || !currentUserId || submitting) return;
    setSubmitting(true);
    const { comment, error } = await submitComment({
      postId,
      authorId: currentUserId,
      content: text.trim(),
    });
    setSubmitting(false);
    if (error || !comment) {
      showAlert('Comment not saved', error ?? 'Please try again.');
      return;
    }
    setText('');
    onCommentsChange([...comments, comment]);
    bumpCommentCount(postId);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Comments ({comments.length})</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close comments">
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
            <CommentThread
              postId={postId}
              comments={comments}
              currentUserId={currentUserId}
              likedCommentIds={likedCommentIds}
              onLikeComment={onLikeComment}
              onReply={onReply}
            />
            <View style={{ height: 8 }} />
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Add a comment…"
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              returnKeyType="send"
              onSubmitEditing={() => void handleSubmit()}
            />
            <TouchableOpacity
              onPress={() => void handleSubmit()}
              disabled={!text.trim() || submitting}
              hitSlop={8}
            >
              {submitting
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Ionicons name="arrow-up-circle" size={26} color={text.trim() ? colors.primary : colors.textMuted} />
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
