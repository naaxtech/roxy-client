import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { COLORS } from '../../lib/constants';
import { CommentThread } from './CommentThread';
import { submitComment } from '../../lib/comments';
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
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bumpCommentCount = useFeedStore(s => s.bumpCommentCount);

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
      Alert.alert('Comment not saved', error ?? 'Please try again.');
      return;
    }
    setText('');
    onCommentsChange([...comments, comment]);
    bumpCommentCount(postId);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Comments ({comments.length})</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
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
              placeholderTextColor={COLORS.textMuted}
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
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={[styles.send, !text.trim() && styles.sendDisabled]}>↗</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '75%', paddingTop: 12,
  },
  handle: {
    width: 40, height: 4, backgroundColor: COLORS.textMuted,
    borderRadius: 2, alignSelf: 'center', marginBottom: 12,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12,
  },
  title: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  close: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  scroll: { maxHeight: 360 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: COLORS.surface,
  },
  input: {
    flex: 1, backgroundColor: COLORS.surface,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    color: COLORS.textPrimary, fontSize: 14,
  },
  send: { fontSize: 18, color: COLORS.primary, fontWeight: '700' },
  sendDisabled: { color: COLORS.textMuted },
});
