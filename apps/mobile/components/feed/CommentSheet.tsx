import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';
import { CommentThread } from './CommentThread';
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
}

export function CommentSheet({
  visible, postId, comments, likedCommentIds, currentUserId,
  onClose, onLikeComment, onReply,
}: CommentSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
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
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '70%', paddingTop: 12,
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
  scroll: { flexGrow: 0 },
});
