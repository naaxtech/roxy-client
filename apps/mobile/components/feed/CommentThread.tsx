import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { Comment } from '../../types';

const REPLY_PREVIEW_COUNT = 2;

interface CommentThreadProps {
  postId: string;
  comments: Comment[];
  currentUserId: string;
  likedCommentIds: Set<string>;
  onLikeComment: (commentId: string) => void;
  onReply: (comment: Comment) => void;
}

function CommentRow({
  comment, isLiked, onLike, onReply, indent = false,
}: {
  comment: Comment;
  isLiked: boolean;
  onLike: () => void;
  onReply: () => void;
  indent?: boolean;
}) {
  const colors = useThemeColors();

  const styles = StyleSheet.create({
    commentRow: {
      flexDirection: 'row', paddingHorizontal: 16,
      paddingVertical: 10, gap: 10,
    },
    replyRow: { paddingLeft: 48 },
    avatarCircle: {
      width: 30, height: 30, borderRadius: 15,
      backgroundColor: colors.primary + '30',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    avatarLetter: { color: colors.primary, fontWeight: '700', fontSize: 12 },
    commentBody: { flex: 1 },
    commentAuthor: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
    commentContent: { color: colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
    deletedText: { color: colors.textMuted, fontStyle: 'italic', fontSize: 13, marginTop: 2 },
    commentActions: { flexDirection: 'row', gap: 16, marginTop: 6 },
    actionText: { color: colors.textMuted, fontSize: 12 },
    likedText: { color: colors.primary },
  });

  const isDeleted = comment.deleted_at !== null;
  return (
    <View style={[styles.commentRow, indent && styles.replyRow]}>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarLetter}>
          {(comment.profiles?.display_name?.[0] ?? '?').toUpperCase()}
        </Text>
      </View>
      <View style={styles.commentBody}>
        <Text style={styles.commentAuthor}>{comment.profiles?.display_name ?? ''}</Text>
        {isDeleted ? (
          <Text style={styles.deletedText}>This comment was removed.</Text>
        ) : (
          <Text style={styles.commentContent}>{comment.content}</Text>
        )}
        {!isDeleted && (
          <View style={styles.commentActions}>
            <TouchableOpacity onPress={onLike}>
              <Text style={[styles.actionText, isLiked && styles.likedText]}>
                {isLiked ? '♥' : '♡'} {comment.like_count}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onReply}>
              <Text style={styles.actionText}>Reply</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

function CommentWithReplies({
  comment, likedCommentIds, onLikeComment, onReply,
}: {
  comment: Comment;
  likedCommentIds: Set<string>;
  onLikeComment: (id: string) => void;
  onReply: (c: Comment) => void;
}) {
  const colors = useThemeColors();
  const [showAllReplies, setShowAllReplies] = useState(false);

  const styles = StyleSheet.create({
    viewMore: { paddingLeft: 48, paddingBottom: 8 },
    viewMoreText: { color: colors.primary, fontSize: 12 },
  });

  const replies = comment.replies ?? [];
  const visibleReplies = showAllReplies ? replies : replies.slice(0, REPLY_PREVIEW_COUNT);
  const hiddenCount = replies.length - REPLY_PREVIEW_COUNT;

  return (
    <View>
      <CommentRow
        comment={comment}
        isLiked={likedCommentIds.has(comment.id)}
        onLike={() => onLikeComment(comment.id)}
        onReply={() => onReply(comment)}
      />
      {visibleReplies.map(r => (
        <CommentRow
          key={r.id}
          comment={r}
          isLiked={likedCommentIds.has(r.id)}
          onLike={() => onLikeComment(r.id)}
          onReply={() => onReply(comment)}
          indent
        />
      ))}
      {!showAllReplies && hiddenCount > 0 && (
        <TouchableOpacity
          testID="view-more-replies"
          style={styles.viewMore}
          onPress={() => setShowAllReplies(true)}
        >
          <Text style={styles.viewMoreText}>View {hiddenCount} more replies</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function CommentThread({
  comments, likedCommentIds, onLikeComment, onReply,
}: CommentThreadProps) {
  return (
    <View>
      {comments.map(c => (
        <CommentWithReplies
          key={c.id}
          comment={c}
          likedCommentIds={likedCommentIds}
          onLikeComment={onLikeComment}
          onReply={onReply}
        />
      ))}
    </View>
  );
}
