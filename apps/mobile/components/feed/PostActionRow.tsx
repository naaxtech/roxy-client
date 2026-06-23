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

// Roxy's signature press motion — same spring used by the theme toggle —
// gives every primary tap in the app one consistent, snappy feel.
function usePopAnimation() {
  const scale = useRef(new Animated.Value(1)).current;
  const pop = () => {
    scale.setValue(0.7);
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

  const styles = StyleSheet.create({
    row: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 22,
      alignItems: 'center',
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    count: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    countActive: { color: colors.primary },
    spacer: { flex: 1 },
  });

  const handleLike = () => { likeAnim.pop(); onLike(); };
  const handleSave = () => { saveAnim.pop(); onSave(); };

  return (
    <View style={styles.row}>
      <TouchableOpacity
        testID="action-like"
        style={styles.action}
        onPress={handleLike}
        accessibilityRole="button"
        accessibilityLabel={isLiked ? 'Unlike post' : 'Like post'}
        accessibilityState={{ selected: isLiked }}
        hitSlop={8}
      >
        <Animated.View style={{ transform: [{ scale: likeAnim.scale }] }}>
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={22}
            color={isLiked ? colors.primary : colors.textMuted}
          />
        </Animated.View>
        <Text style={[styles.count, isLiked && styles.countActive]}>{likeCount}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="action-comment"
        style={styles.action}
        onPress={onComment}
        accessibilityRole="button"
        accessibilityLabel="View comments"
        hitSlop={8}
      >
        <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
        <Text style={styles.count}>{commentCount}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="action-share"
        style={styles.action}
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel="Share post"
        hitSlop={8}
      >
        <Ionicons name="arrow-redo-outline" size={20} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.spacer} />

      <TouchableOpacity
        testID="action-save"
        style={styles.action}
        onPress={handleSave}
        accessibilityRole="button"
        accessibilityLabel={isSaved ? 'Remove from saved' : 'Save post'}
        accessibilityState={{ selected: isSaved }}
        hitSlop={8}
      >
        <Animated.View style={{ transform: [{ scale: saveAnim.scale }] }}>
          <Ionicons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={20}
            color={isSaved ? colors.primary : colors.textMuted}
          />
        </Animated.View>
        {saveCount > 0 && <Text style={[styles.count, isSaved && styles.countActive]}>{saveCount}</Text>}
      </TouchableOpacity>
    </View>
  );
}
