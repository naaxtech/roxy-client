import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { PostActionRow } from './PostActionRow';
import type { Post, LinkType } from '../../types';

interface RoxyLinkCardProps {
  post: Post;
  entityName: string;
  participantCount: number;
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
  onPress: () => void;
  /** The CTA button (Join Game etc.) — routes into the linked entity, not the post. */
  onCtaPress?: () => void;
  onAuthorPress?: () => void;
}

const VARIANT_CONFIG: Record<LinkType, { icon: string; ctaLabel: string; countLabel: string }> = {
  game:  { icon: '🎮', ctaLabel: 'Join Game',  countLabel: 'playing' },
  room:  { icon: '🎙', ctaLabel: 'Join Room',  countLabel: 'in room' },
  event: { icon: '📅', ctaLabel: 'View Event', countLabel: 'going' },
};

export function RoxyLinkCard({
  post, entityName, participantCount,
  isLiked, isSaved, onLike, onSave, onComment, onShare, onPress, onCtaPress, onAuthorPress,
}: RoxyLinkCardProps) {
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
    linkBox: {
      marginHorizontal: 16, padding: 14,
      backgroundColor: colors.surface,
      borderRadius: 12, flexDirection: 'row',
      alignItems: 'center', gap: 12,
    },
    linkIcon: { fontSize: 28 },
    linkInfo: { flex: 1 },
    linkName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    linkMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    ctaBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    },
    ctaText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    caption: {
      color: colors.textSecondary, fontSize: 14,
      paddingHorizontal: 16, paddingTop: 8,
    },
  });

  const type = post.link_type ?? 'game';
  const config = VARIANT_CONFIG[type];

  return (
    <View testID="roxy-link-card" style={styles.card}>
      <TouchableOpacity
        style={styles.authorRow}
        onPress={onAuthorPress ?? onPress}
        activeOpacity={0.8}
        accessibilityLabel={`View ${post.profiles?.display_name ?? 'author'}'s profile`}
      >
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>
            {(post.profiles?.display_name?.[0] ?? '?').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.authorName}>{post.profiles?.display_name ?? ''}</Text>
      </TouchableOpacity>

      <View style={styles.linkBox}>
        <Text style={styles.linkIcon}>{config.icon}</Text>
        <View style={styles.linkInfo}>
          <Text style={styles.linkName}>{entityName}</Text>
          <Text style={styles.linkMeta}>
            {participantCount} {config.countLabel}
          </Text>
        </View>
        <TouchableOpacity
          testID="roxy-link-cta"
          style={styles.ctaBtn}
          onPress={onCtaPress ?? onPress}
          accessibilityLabel={config.ctaLabel}
        >
          <Text style={styles.ctaText}>{config.ctaLabel}</Text>
        </TouchableOpacity>
      </View>

      {post.content ? (
        <Text style={styles.caption}>{post.content}</Text>
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
