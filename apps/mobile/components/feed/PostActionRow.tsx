import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';

interface PostActionRowProps {
  likeCount: number;
  saveCount: number;
  commentCount: number;
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onComment: () => void;
  onShare: () => void;
}

export function PostActionRow({
  likeCount, saveCount, commentCount,
  isLiked, isSaved, onLike, onSave, onComment, onShare,
}: PostActionRowProps) {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        testID="action-like"
        style={styles.action}
        onPress={onLike}
        accessibilityState={{ selected: isLiked }}
        hitSlop={8}
      >
        <Text style={[styles.icon, isLiked && styles.iconLiked]}>
          {isLiked ? '♥' : '♡'}
        </Text>
        <Text style={[styles.count, isLiked && styles.countLiked]}>{likeCount}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="action-save"
        style={styles.action}
        onPress={onSave}
        accessibilityState={{ selected: isSaved }}
        hitSlop={8}
      >
        <Text style={[styles.icon, isSaved && styles.iconSaved]}>
          {isSaved ? '✦' : '✧'}
        </Text>
        <Text style={[styles.count, isSaved && styles.countSaved]}>{saveCount}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="action-comment"
        style={styles.action}
        onPress={onComment}
        hitSlop={8}
      >
        <Text style={styles.icon}>💬</Text>
        <Text style={styles.count}>{commentCount}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="action-share"
        style={styles.action}
        onPress={onShare}
        hitSlop={8}
      >
        <Text style={styles.icon}>↗</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 20,
    alignItems: 'center',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  icon: { fontSize: 18, color: COLORS.textMuted },
  iconLiked: { color: COLORS.primary },
  iconSaved: { color: COLORS.primary },
  count: { fontSize: 13, color: COLORS.textMuted },
  countLiked: { color: COLORS.primary },
  countSaved: { color: COLORS.primary },
});
