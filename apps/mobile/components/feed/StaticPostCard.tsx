import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { formatDistanceToNowStrict } from 'date-fns';
import { useThemeColors } from '../../hooks/useThemeColors';
import { PostActionRow } from './PostActionRow';
import { PostMediaCarousel } from './PostMediaCarousel';
import { avatarGradient } from '../../lib/avatars';
import type { Post } from '../../types';

interface StaticPostCardProps {
  post: Post;
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onPress: () => void;
}

const CAPTION_THRESHOLD = 120;

export function StaticPostCard({
  post, isLiked, isSaved, onLike, onSave, onComment, onShare, onPress,
}: StaticPostCardProps) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const authorName = post.profiles?.display_name ?? '?';
  const grad = useMemo(() => avatarGradient(authorName), [authorName]);

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      marginHorizontal: 10,
      marginBottom: 12,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
      elevation: 2,
    },
    authorRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingVertical: 12, gap: 10,
    },
    avatarCircle: {
      width: 38, height: 38, borderRadius: 19,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 15 },
    nameBlock: { flex: 1 },
    authorName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    timestamp: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    textCard: {
      minHeight: 160, marginHorizontal: 14, marginVertical: 4,
      backgroundColor: colors.surfaceLight, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', padding: 20,
    },
    typeBadge: {
      color: colors.primary, fontSize: 12, fontWeight: '700',
      marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
    },
    textCardContent: {
      color: colors.textPrimary, fontSize: 18,
      fontWeight: '600', textAlign: 'center', lineHeight: 26,
    },
    captionArea: { paddingHorizontal: 16, paddingTop: 8 },
    caption: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    showMore: { color: colors.primary, fontSize: 13, marginTop: 2 },
  });

  const postedAt = new Date(post.created_at);
  const timestamp = Number.isNaN(postedAt.getTime())
    ? ''
    : formatDistanceToNowStrict(postedAt, { addSuffix: true });

  const mediaUrls = post.media_urls ?? [];
  const hasImage =
    mediaUrls.length > 0 &&
    post.post_type !== 'video' &&
    post.post_type !== 'roxy_link';
  const isTextOnly =
    !hasImage &&
    (post.post_type === 'standard' ||
      post.post_type === 'poll' ||
      post.post_type === 'resource' ||
      post.post_type === 'event');
  const typeBadge =
    post.post_type === 'poll' ? '🗳️ Poll' :
    post.post_type === 'resource' ? '📚 Resource' :
    post.post_type === 'event' ? '📅 Event' :
    null;

  return (
    <View testID="static-card" style={styles.card}>
      <TouchableOpacity testID="static-card-press" onPress={onPress} activeOpacity={0.95} style={styles.authorRow}>
        <LinearGradient colors={grad} style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>
            {(authorName[0] ?? '?').toUpperCase()}
          </Text>
        </LinearGradient>
        <View style={styles.nameBlock}>
          <Text style={styles.authorName}>{post.profiles?.display_name ?? ''}</Text>
          {timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
        </View>
      </TouchableOpacity>

      {hasImage && (
        <PostMediaCarousel
          urls={mediaUrls}
          blurhash={post.blurhash}
          variant="feed"
          onOpen={onPress}
        />
      )}

      {isTextOnly && (
        <TouchableOpacity onPress={onPress} activeOpacity={0.95}>
          <View style={styles.textCard}>
            {typeBadge ? <Text style={styles.typeBadge}>{typeBadge}</Text> : null}
            <Text style={styles.textCardContent}>{post.content}</Text>
          </View>
        </TouchableOpacity>
      )}

      {!isTextOnly && post.content ? (
        <TouchableOpacity onPress={onPress} activeOpacity={0.95} style={styles.captionArea}>
          <Text style={styles.caption} numberOfLines={expanded ? undefined : 3}>
            {post.content}
          </Text>
          {!expanded && post.content.length > CAPTION_THRESHOLD && (
            <TouchableOpacity onPress={() => setExpanded(true)}>
              <Text style={styles.showMore}>Show more</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      ) : null}

      <PostActionRow
        likeCount={post.like_count}
        saveCount={post.save_count}
        commentCount={post.comment_count}
        isLiked={isLiked}
        isSaved={isSaved}
        onLike={onLike}
        onSave={onSave}
        onComment={onComment}
        onShare={onShare}
      />
    </View>
  );
}
