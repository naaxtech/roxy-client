import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useThemeColors } from '../../hooks/useThemeColors';
import { getPostImageUrl } from '../../lib/media';
import { PostActionRow } from './PostActionRow';
import type { Post } from '../../types';

interface VideoPostCardProps {
  post: Post;
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onPress: () => void;
  onAuthorPress?: () => void;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const ASPECT_HEIGHTS: Record<string, number> = { '4:5': 375, '16:9': 210, '1:1': 300 };

export function VideoPostCard({
  post, isLiked, isSaved, onLike, onSave, onComment, onShare, onPress, onAuthorPress,
}: VideoPostCardProps) {
  const colors = useThemeColors();

  const styles = StyleSheet.create({
    card: { backgroundColor: colors.background, marginBottom: 8 },
    authorRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 10, gap: 10,
    },
    avatarCircle: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: colors.primary + '30',
      alignItems: 'center', justifyContent: 'center',
    },
    avatarLetter: { color: colors.primary, fontWeight: '700', fontSize: 15 },
    authorName: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    thumbContainer: { width: '100%', backgroundColor: colors.surface, overflow: 'hidden' },
    thumbPlaceholder: { backgroundColor: colors.surface },
    playOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center', justifyContent: 'center',
    },
    playIcon: { fontSize: 48, color: 'rgba(255,255,255,0.9)' },
    durationBadge: {
      position: 'absolute', bottom: 10, right: 12,
      backgroundColor: 'rgba(0,0,0,0.6)',
      paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    },
    durationText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    caption: {
      color: colors.textSecondary, fontSize: 14,
      paddingHorizontal: 16, paddingTop: 8,
    },
  });

  const thumbUri = post.video_thumbnail_url
    ? getPostImageUrl(post.video_thumbnail_url, 'feed')
    : null;
  const thumbHeight = ASPECT_HEIGHTS[post.video_aspect_ratio ?? '4:5'] ?? 375;

  return (
    <View testID="video-card" style={styles.card}>
      <TouchableOpacity onPress={onAuthorPress ?? onPress} activeOpacity={0.95} style={styles.authorRow}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>
            {(post.profiles?.display_name?.[0] ?? '?').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.authorName}>{post.profiles?.display_name ?? ''}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="video-thumbnail"
        onPress={onPress}
        activeOpacity={0.95}
        style={[styles.thumbContainer, { height: thumbHeight }]}
      >
        {thumbUri ? (
          <Image
            source={{ uri: thumbUri }}
            placeholder={post.blurhash ?? undefined}
            contentFit="cover"
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.thumbPlaceholder]} />
        )}
        <View testID="play-icon" style={styles.playOverlay}>
          <Text style={styles.playIcon}>▶</Text>
        </View>
        {post.video_duration_secs != null && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>
              {formatDuration(post.video_duration_secs)}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {post.content ? (
        <TouchableOpacity onPress={onPress} activeOpacity={0.95}>
          <Text style={styles.caption} numberOfLines={1}>{post.content}</Text>
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
