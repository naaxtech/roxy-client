import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MessageReaction } from '../../types';
import { useThemeColors } from '../../hooks/useThemeColors';

const QUICK_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '💜'];

interface ReactionBarProps {
  onReact: (emoji: string) => void;
}

export function QuickReactBar({ onReact }: ReactionBarProps) {
  const colors = useThemeColors();
  const styles = StyleSheet.create({
    quickBar: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: 24,
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 4,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    quickEmoji: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 18,
    },
    quickEmojiText: { fontSize: 22 },
  });

  return (
    <View style={styles.quickBar}>
      {QUICK_EMOJIS.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          onPress={() => onReact(emoji)}
          hitSlop={8}
          style={styles.quickEmoji}
        >
          <Text style={styles.quickEmojiText}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

interface ReactionChipsProps {
  reactions: MessageReaction[];
  currentUserId: string;
  onToggle: (emoji: string, isOwn: boolean) => void;
}

export function ReactionChips({ reactions, currentUserId, onToggle }: ReactionChipsProps) {
  const colors = useThemeColors();
  const styles = StyleSheet.create({
    chipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      marginTop: 4,
      marginHorizontal: 4,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: colors.surfaceLight,
    },
    chipOwn: {
      backgroundColor: colors.primary + '20',
      borderColor: colors.primary + '60',
    },
    chipEmoji: { fontSize: 14 },
    chipCount: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    chipCountOwn: { color: colors.primary },
  });

  if (!reactions || reactions.length === 0) return null;

  const grouped: Record<string, { count: number; isOwn: boolean }> = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, isOwn: false };
    grouped[r.emoji].count += 1;
    if (r.user_id === currentUserId) grouped[r.emoji].isOwn = true;
  }

  return (
    <View style={styles.chipsRow}>
      {Object.entries(grouped).map(([emoji, { count, isOwn }]) => (
        <TouchableOpacity
          key={emoji}
          style={[styles.chip, isOwn && styles.chipOwn]}
          onPress={() => onToggle(emoji, isOwn)}
          hitSlop={4}
        >
          <Text style={styles.chipEmoji}>{emoji}</Text>
          {count > 1 && <Text style={[styles.chipCount, isOwn && styles.chipCountOwn]}>{count}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}
