import React, { useRef, useState } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
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
  const heartScale = useRef(new Animated.Value(1)).current;
  const authorName = comment.profiles?.display_name ?? 'Someone';
  const avatarUrl = comment.profiles?.avatar_url;

  const styles = StyleSheet.create({
    commentRow: {
      flexDirection: 'row', paddingHorizontal: 16,
      paddingVertical: 10, gap: 10,
    },
    replyRow: { paddingLeft: 48 },
    avatar: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: colors.surfaceLight,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      overflow: 'hidden',
    },
    avatarLetter: { color: colors.textPrimary, fontWeight: '800', fontSize: 12 },
    commentBody: { flex: 1 },
    commentAuthor: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
    commentContent: { color: colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
    deletedText: { color: colors.textMuted, fontStyle: 'italic', fontSize: 13, marginTop: 2 },
    commentActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
    likeAction: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      minHeight: MIN_TOUCH_TARGET - 16,
    },
    actionText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    likedText: { color: colors.roxy },
  });

  const isDeleted = comment.deleted_at !== null;
  const handleLike = () => {
    heartScale.setValue(0.7);
    Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, tension: 260, friction: 12 }).start();
    onLike();
  };
  return (
    <View style={[styles.commentRow, indent && styles.replyRow]}>
      <View style={styles.avatar}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={{ width: 32, height: 32 }} />
        ) : (
          <Text style={styles.avatarLetter}>{authorName[0]?.toUpperCase() ?? '?'}</Text>
        )}
      </View>
      <View style={styles.commentBody}>
        <Text style={styles.commentAuthor}>{authorName}</Text>
        {isDeleted ? (
          <Text style={styles.deletedText}>This comment was removed.</Text>
        ) : (
          <Text style={styles.commentContent}>{comment.content}</Text>
        )}
        {!isDeleted && (
          <View style={styles.commentActions}>
            <TouchableOpacity
              style={styles.likeAction}
              onPress={handleLike}
              accessibilityRole="button"
              accessibilityLabel={isLiked ? 'Unlike comment' : 'Like comment'}
              testID={`comment-like-${comment.id}`}
              hitSlop={6}
            >
              <Animated.View style={{ transform: [{ scale: heartScale }] }}>
                <Ionicons
                  name={isLiked ? 'heart' : 'heart-outline'}
                  size={16}
                  color={isLiked ? colors.roxy : colors.textMuted}
                />
              </Animated.View>
              {comment.like_count > 0 ? (
                <Text style={[styles.actionText, isLiked && styles.likedText]}>{comment.like_count}</Text>
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onReply}
              accessibilityRole="button"
              accessibilityLabel={`Reply to ${authorName}`}
              hitSlop={8}
            >
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
    viewMore: { paddingLeft: 48, paddingBottom: 8, minHeight: MIN_TOUCH_TARGET - 8, justifyContent: 'center' },
    viewMoreText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
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
      {visibleReplies.map((r) => (
        <CommentRow
          key={r.id}
          comment={r}
          isLiked={likedCommentIds.has(r.id)}
          onLike={() => onLikeComment(r.id)}
          onReply={() => onReply(r)}
          indent
        />
      ))}
      {!showAllReplies && hiddenCount > 0 && (
        <TouchableOpacity
          testID="view-more-replies"
          style={styles.viewMore}
          onPress={() => setShowAllReplies(true)}
        >
          <Text style={styles.viewMoreText}>View {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}</Text>
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
      {comments.map((c) => (
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
