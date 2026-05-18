import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { COLORS } from '../../lib/constants';
import { getPostImageUrl } from '../../lib/media';
import { PostActionRow } from './PostActionRow';
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
  const [expanded, setExpanded] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const mediaUrls = post.media_urls ?? [];
  const isGallery = post.post_type === 'gallery' && mediaUrls.length > 1;
  const isPhoto = post.post_type === 'photo' && mediaUrls.length > 0;
  const hasImage =
    isPhoto ||
    isGallery ||
    (mediaUrls.length > 0 && post.post_type !== 'video' && post.post_type !== 'roxy_link');
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
    <TouchableOpacity
      testID="static-card"
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

      {/* Image zone */}
      {hasImage && (
        <View>
          {isGallery ? (
            <View>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={e => {
                  const idx = Math.round(
                    e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width
                  );
                  setGalleryIndex(idx);
                }}
                scrollEventThrottle={16}
              >
                {mediaUrls.map((path, i) => (
                  <View
                    key={i}
                    testID={i === 0 ? 'post-image' : undefined}
                    style={styles.image}
                  >
                    <Image
                      source={{ uri: getPostImageUrl(path, 'feed') }}
                      placeholder={post.blurhash ?? undefined}
                      contentFit="cover"
                      style={StyleSheet.absoluteFill}
                    />
                  </View>
                ))}
              </ScrollView>
              <View testID="gallery-dots" style={styles.dots}>
                {mediaUrls.map((_, i) => (
                  <View
                    key={i}
                    style={[styles.dot, i === galleryIndex && styles.dotActive]}
                  />
                ))}
              </View>
            </View>
          ) : (
            <View testID="post-image" style={styles.image}>
              <Image
                source={{ uri: getPostImageUrl(mediaUrls[0], 'feed') }}
                placeholder={post.blurhash ?? undefined}
                contentFit="cover"
                style={StyleSheet.absoluteFill}
              />
            </View>
          )}
        </View>
      )}

      {/* Text post — styled card */}
      {isTextOnly && (
        <View style={styles.textCard}>
          {typeBadge ? <Text style={styles.typeBadge}>{typeBadge}</Text> : null}
          <Text style={styles.textCardContent}>{post.content}</Text>
        </View>
      )}

      {/* Caption (non-text posts) */}
      {!isTextOnly && post.content ? (
        <View style={styles.captionArea}>
          <Text
            style={styles.caption}
            numberOfLines={expanded ? undefined : 3}
          >
            {post.content}
          </Text>
          {!expanded && post.content.length > CAPTION_THRESHOLD && (
            <TouchableOpacity onPress={() => setExpanded(true)}>
              <Text style={styles.showMore}>Show more</Text>
            </TouchableOpacity>
          )}
        </View>
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
  image: { width: '100%', height: 300, overflow: 'hidden' },
  dots: {
    flexDirection: 'row', justifyContent: 'center',
    gap: 4, paddingVertical: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.textMuted },
  dotActive: { backgroundColor: COLORS.primary },
  textCard: {
    minHeight: 160, marginHorizontal: 16, marginVertical: 4,
    backgroundColor: COLORS.surface, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  typeBadge: {
    color: COLORS.primary, fontSize: 12, fontWeight: '700',
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  textCardContent: {
    color: COLORS.textPrimary, fontSize: 18,
    fontWeight: '600', textAlign: 'center', lineHeight: 26,
  },
  captionArea: { paddingHorizontal: 16, paddingTop: 8 },
  caption: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  showMore: { color: COLORS.primary, fontSize: 13, marginTop: 2 },
});
