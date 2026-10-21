import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, View, Text, StyleSheet, Image,
} from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { hideMutedComments } from '../../lib/comments';
import type { CommentRemoval } from '../../lib/comments';
import { tapLight } from '../../lib/haptics';
import { useSafetyStore } from '../../store/safetyStore';
import { CommentActionsSheet } from './CommentActionsSheet';
import { Avatar } from '../ui/Avatar';
import type { Comment } from '../../types';

const REPLY_PREVIEW_COUNT = 2;
const EMPTY: readonly string[] = [];

interface CommentThreadProps {
  postId: string;
  comments: Comment[];
  currentUserId: string;
  likedCommentIds: Set<string>;
  onLikeComment: (commentId: string) => void;
  onReply: (comment: Comment) => void;
  /**
   * Her own comment was deleted from the actions sheet. Without it the
   * thread still offers Report/Mute/Block, but not Delete.
   */
  onRemoved?: (commentId: string, outcome: CommentRemoval) => void;
  /** There are older top-level comments than the first one shown. */
  hasEarlier?: boolean;
  loadingEarlier?: boolean;
  onLoadEarlier?: () => void;
}

function CommentRow({
  comment, isLiked, onLike, onReply, onActions, indent = false,
}: {
  comment: Comment;
  isLiked: boolean;
  onLike: () => void;
  onReply: () => void;
  onActions: () => void;
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
    more: { marginLeft: 'auto', paddingHorizontal: 4, minHeight: MIN_TOUCH_TARGET - 16, justifyContent: 'center' },
  });

  const isDeleted = comment.deleted_at !== null;
  const isMutedPlaceholder = comment.mutedPlaceholder === true;
  const handleLike = () => {
    heartScale.setValue(0.7);
    Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, tension: 260, friction: 12 }).start();
    onLike();
  };

  if (isMutedPlaceholder) {
    return (
      <View style={[styles.commentRow, indent && styles.replyRow]} testID={`comment-${comment.id}-muted`}>
        <View style={styles.commentBody}>
          <Text style={styles.deletedText}>A comment from someone you muted.</Text>
        </View>
      </View>
    );
  }

  const openActions = () => {
    tapLight();
    onActions();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      // Long-press is the gesture people already know from every other app;
      // the ⋯ below is the same menu for anyone who does not long-press and for
      // screen readers, which announce it as an action.
      onLongPress={isDeleted ? undefined : openActions}
      delayLongPress={350}
      accessible={false}
      testID={`comment-${comment.id}`}
      style={[styles.commentRow, indent && styles.replyRow]}
    >
      <Avatar uri={avatarUrl} name={authorName} seed={comment.author_id} size={32} testID={`comment-${comment.id}-avatar`} />
      <View style={styles.commentBody}>
        <Text style={styles.commentAuthor}>{authorName}</Text>
        {isDeleted ? (
          <Text style={styles.deletedText}>This comment was removed.</Text>
        ) : comment.gif_url || comment.media_url ? (
          <Image
            source={{ uri: (comment.gif_url ?? comment.media_url)! }}
            style={{ width: 180, height: 135, borderRadius: 10, marginTop: 2 }}
            resizeMode="cover"
          />
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
            <TouchableOpacity
              style={styles.more}
              onPress={openActions}
              accessibilityRole="button"
              accessibilityLabel={`More options for ${authorName}'s comment`}
              testID={`comment-${comment.id}-more`}
              hitSlop={10}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function CommentWithReplies({
  comment, likedCommentIds, onLikeComment, onReply, onActions,
}: {
  comment: Comment;
  likedCommentIds: Set<string>;
  onLikeComment: (id: string) => void;
  onReply: (c: Comment) => void;
  onActions: (c: Comment) => void;
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
        onActions={() => onActions(comment)}
      />
      {visibleReplies.map((r) => (
        <CommentRow
          key={r.id}
          comment={r}
          isLiked={likedCommentIds.has(r.id)}
          onLike={() => onLikeComment(r.id)}
          onReply={() => onReply(r)}
          onActions={() => onActions(r)}
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

/**
 * A post's comments, with Like, Reply and — on long-press or ⋯ — Report,
 * Mute, Block, or Delete for her own.
 *
 * Muted and blocked authors are filtered here, from `safetyStore`, so every
 * host (the feed's sheet, the post page, the video page) gets the same rule
 * and a block or mute from the actions sheet takes effect in the thread at
 * once. RLS already withholds blocked authors' comments on the next fetch
 * (088); muting is a client-side courtesy (127) and lives only here.
 */
export function CommentThread({
  comments, likedCommentIds, onLikeComment, onReply, currentUserId,
  onRemoved, hasEarlier = false, loadingEarlier = false, onLoadEarlier,
}: CommentThreadProps) {
  const colors = useThemeColors();
  const mutedIds = useSafetyStore((s) => s.mutedUserIds) ?? EMPTY;
  const blockedIds = useSafetyStore((s) => s.blockedUserIds) ?? EMPTY;
  const [actionsFor, setActionsFor] = useState<Comment | null>(null);

  const visible = useMemo(() => {
    const blocked = new Set(blockedIds);
    const unblocked = comments
      .filter((c) => !blocked.has(c.author_id))
      .map((c) => {
        const replies = (c.replies ?? []).filter((r) => !blocked.has(r.author_id));
        return replies.length === (c.replies ?? []).length ? c : { ...c, replies };
      });
    return hideMutedComments(unblocked, mutedIds);
  }, [comments, mutedIds, blockedIds]);

  const styles = StyleSheet.create({
    earlier: { paddingHorizontal: 16, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    earlierText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  });

  return (
    <View>
      {hasEarlier && onLoadEarlier ? (
        <TouchableOpacity
          testID="comments-load-earlier"
          style={styles.earlier}
          onPress={loadingEarlier ? undefined : onLoadEarlier}
          accessibilityRole="button"
          accessibilityLabel="See earlier comments"
          accessibilityState={{ busy: loadingEarlier }}
        >
          {loadingEarlier
            ? <ActivityIndicator size="small" color={colors.roxy} />
            : <Text style={styles.earlierText}>See earlier comments</Text>}
        </TouchableOpacity>
      ) : null}
      {visible.map((c) => (
        <CommentWithReplies
          key={c.id}
          comment={c}
          likedCommentIds={likedCommentIds}
          onLikeComment={onLikeComment}
          onReply={onReply}
          onActions={setActionsFor}
        />
      ))}
      <CommentActionsSheet
        comment={actionsFor}
        currentUserId={currentUserId}
        canDelete={!!onRemoved}
        onClose={() => setActionsFor(null)}
        onRemoved={(id, outcome) => onRemoved?.(id, outcome)}
      />
    </View>
  );
}
