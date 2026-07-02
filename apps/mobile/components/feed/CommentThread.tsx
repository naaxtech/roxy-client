import React, { useRef, useState } from 'react';
import { Animated, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { Comment } from '../../types';

const REPLY_PREVIEW_COUNT = 2;

const COMMENT_GRADS: [string, string][] = [
  ['#FF6A2E', '#E81C8E'], ['#8B5CF6', '#E879A6'], ['#FF2F71', '#8B5CF6'],
  ['#C4476A', '#8B5CF6'], ['#FF8A3D', '#FF2F71'],
];
function commentGrad(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return COMMENT_GRADS[Math.abs(h) % COMMENT_GRADS.length];
}

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
  const authorName = comment.profiles?.display_name ?? '?';
  const grad = commentGrad(authorName);

  const styles = StyleSheet.create({
    commentRow: {
      flexDirection: 'row', paddingHorizontal: 16,
      paddingVertical: 10, gap: 10,
    },
    replyRow: { paddingLeft: 48 },
    avatarCircle: {
      width: 30, height: 30, borderRadius: 15,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 12 },
    commentBody: { flex: 1 },
    commentAuthor: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
    commentContent: { color: colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
    deletedText: { color: colors.textMuted, fontStyle: 'italic', fontSize: 13, marginTop: 2 },
    commentActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
    likeAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    actionText: { color: colors.textMuted, fontSize: 12 },
    likedText: { color: colors.primary },
  });

  const isDeleted = comment.deleted_at !== null;
  const handleLike = () => {
    heartScale.setValue(0.7);
    Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, tension: 260, friction: 12 }).start();
    onLike();
  };
  return (
    <View style={[styles.commentRow, indent && styles.replyRow]}>
      <LinearGradient colors={grad} style={styles.avatarCircle}>
        <Text style={styles.avatarLetter}>
          {authorName[0]?.toUpperCase() ?? '?'}
        </Text>
      </LinearGradient>
      <View style={styles.commentBody}>
        <Text style={styles.commentAuthor}>{comment.profiles?.display_name ?? ''}</Text>
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
              hitSlop={6}
            >
              <Animated.Text style={{ transform: [{ scale: heartScale }] }}>
                <Text style={{ fontSize: 14, opacity: isLiked ? 1 : 0.5 }}>🌸</Text>
              </Animated.Text>
              <Text style={[styles.actionText, isLiked && styles.likedText]}>{comment.like_count}</Text>
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
