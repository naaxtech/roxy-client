import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { COLORS } from '../../lib/constants';
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
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const ASPECT_HEIGHTS: Record<string, number> = { '4:5': 375, '16:9': 210, '1:1': 300 };

export function VideoPostCard({
  post, isLiked, isSaved, onLike, onSave, onComment, onShare, onPress,
}: VideoPostCardProps) {
  const thumbUri = post.video_thumbnail_url
    ? getPostImageUrl(post.video_thumbnail_url, 'feed')
    : null;
  const thumbHeight = ASPECT_HEIGHTS[post.video_aspect_ratio ?? '4:5'] ?? 375;

  return (
    <TouchableOpacity
      testID="video-card"
      onPress={onPress}
      activeOpacity={0.95}
      style={styles.card}
    >
      {/* Author row */}
      <View style={styles.authorRow}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>
            {(post.profiles?.display_name?.[0] ?? '?').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.authorName}>{post.profiles?.display_name ?? ''}</Text>
      </View>

      {/* Thumbnail */}
      <View style={[styles.thumbContainer, { height: thumbHeight }]}>
        {thumbUri ? (
          <Image
            testID="video-thumbnail"
            source={{ uri: thumbUri }}
            placeholder={post.blurhash ?? undefined}
            contentFit="cover"
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View testID="video-thumbnail" style={[StyleSheet.absoluteFill, styles.thumbPlaceholder]} />
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
      </View>

      {post.content ? (
        <Text style={styles.caption} numberOfLines={1}>{post.content}</Text>
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
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.background, marginBottom: 8 },
  authorRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, gap: 10,
  },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  authorName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  thumbContainer: { width: '100%', backgroundColor: COLORS.surface, overflow: 'hidden' },
  thumbPlaceholder: { backgroundColor: COLORS.surface },
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
    color: COLORS.textSecondary, fontSize: 14,
    paddingHorizontal: 16, paddingTop: 8,
  },
});
