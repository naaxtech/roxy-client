import React, { useRef } from 'react';
import { Animated, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';

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


function usePopAnimation() {
  const scale = useRef(new Animated.Value(1)).current;
  const pop = () => {
    scale.setValue(0.65);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 260, friction: 12 }).start();
  };
  return { scale, pop };
}

export function PostActionRow({
  likeCount, saveCount, commentCount,
  isLiked, isSaved, onLike, onSave, onComment, onShare,
}: PostActionRowProps) {
  const colors = useThemeColors();
  const likeAnim = usePopAnimation();
  const saveAnim = usePopAnimation();

  const s = StyleSheet.create({
    row: {
      flexDirection: 'row',
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 12,
      alignItems: 'center',
      gap: 4,
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 20,
    },
    actionActive: {
      backgroundColor: colors.primary + '14',
    },
    count: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    countActive: { color: colors.primary },
    spacer: { flex: 1 },

  });

  const handleLikePress = () => {
    likeAnim.pop();
    onLike();
  };

  const handleSave = () => {
    saveAnim.pop();
    onSave();
  };

  return (
    <View style={s.row}>
      {/* Like — plain tap, the Instagram/TikTok model. Roxy's like is the
          flower, rendered as a vector (no emoji chrome). */}
      <TouchableOpacity
        testID="action-like"
        style={[s.action, isLiked && s.actionActive]}
        onPress={handleLikePress}
        accessibilityRole="button"
        accessibilityLabel={isLiked ? 'Unlike post' : 'Like post'}
        accessibilityState={{ selected: isLiked }}
        hitSlop={6}
      >
        <Animated.View style={{ transform: [{ scale: likeAnim.scale }] }}>
          <Ionicons
            name={isLiked ? 'flower' : 'flower-outline'}
            size={20}
            color={isLiked ? colors.roxy : colors.textMuted}
          />
        </Animated.View>
        <Text style={[s.count, isLiked && s.countActive]}>
          {likeCount > 0 ? likeCount : ''}
        </Text>
      </TouchableOpacity>

      {/* Comment */}
      <TouchableOpacity
        testID="action-comment"
        style={s.action}
        onPress={onComment}
        accessibilityRole="button"
        accessibilityLabel="View comments"
        hitSlop={6}
      >
        <Ionicons name="chatbubble-outline" size={19} color={colors.textMuted} />
        <Text style={s.count}>{commentCount > 0 ? commentCount : ''}</Text>
      </TouchableOpacity>

      {/* Share */}
      <TouchableOpacity
        testID="action-share"
        style={s.action}
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel="Share post"
        hitSlop={6}
      >
        <Ionicons name="arrow-redo-outline" size={19} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={s.spacer} />

      {/* Save / Bookmark */}
      <TouchableOpacity
        testID="action-save"
        style={[s.action, isSaved && s.actionActive]}
        onPress={handleSave}
        accessibilityRole="button"
        accessibilityLabel={isSaved ? 'Remove from saved' : 'Save post'}
        hitSlop={6}
      >
        <Animated.View style={{ transform: [{ scale: saveAnim.scale }] }}>
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={19}
            color={isSaved ? colors.primary : colors.textMuted}
          />
        </Animated.View>
        {saveCount > 0 && <Text style={[s.count, isSaved && s.countActive]}>{saveCount}</Text>}
      </TouchableOpacity>

    </View>
  );
}
