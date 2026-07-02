import React, { useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, View, StyleSheet, Modal, Pressable } from 'react-native';
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

const REACTIONS = ['🌸', '💜', '🔥', '✨', '🥹'];

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
  const [showReactions, setShowReactions] = useState(false);
  const likeRef = useRef<View>(null);

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
    emoji: { fontSize: 19 },
    emojiActive: { fontSize: 20 },
    count: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    countActive: { color: colors.primary },
    spacer: { flex: 1 },

    // Reaction picker popover
    pickerOverlay: { flex: 1 },
    picker: {
      position: 'absolute',
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: 28,
      paddingVertical: 8,
      paddingHorizontal: 6,
      gap: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.14,
      shadowRadius: 14,
      elevation: 12,
      // positioned dynamically below
      bottom: 80,
      left: 12,
    },
    pickerBtn: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
    },
    pickerEmoji: { fontSize: 24 },
    separator: {
      width: StyleSheet.hairlineWidth,
      backgroundColor: colors.surfaceLight,
      marginHorizontal: 8,
      alignSelf: 'stretch',
    },
  });

  const handleLikePress = () => {
    likeAnim.pop();
    onLike();
  };

  const handleLikeLong = () => {
    setShowReactions(true);
  };

  const handleReact = (emoji: string) => {
    setShowReactions(false);
    if (!isLiked) {
      likeAnim.pop();
      onLike();
    }
  };

  const handleSave = () => {
    saveAnim.pop();
    onSave();
  };

  return (
    <View style={s.row}>
      {/* Like / Emoji react */}
      <TouchableOpacity
        testID="action-like"
        style={[s.action, isLiked && s.actionActive]}
        onPress={handleLikePress}
        onLongPress={handleLikeLong}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={isLiked ? 'Unlike post' : 'Like post'}
        accessibilityState={{ selected: isLiked }}
        hitSlop={6}
      >
        <Animated.Text style={{ transform: [{ scale: likeAnim.scale }] }}>
          <Text style={isLiked ? s.emojiActive : s.emoji}>{isLiked ? '🌸' : '🌸'}</Text>
        </Animated.Text>
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

      {/* Emoji reaction picker (long-press on 🌸) */}
      {showReactions && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowReactions(false)}>
          <Pressable style={s.pickerOverlay} onPress={() => setShowReactions(false)}>
            <View style={s.picker}>
              {REACTIONS.map((emoji, i) => (
                <TouchableOpacity
                  key={emoji}
                  style={s.pickerBtn}
                  onPress={() => handleReact(emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={s.pickerEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
