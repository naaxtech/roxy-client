import React from 'react';
import {
  View, Text, StyleSheet,
} from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { BusySwap } from '../messages/LoadingShapes';

interface ActionTrayProps {
  onEmojiPress: () => void;
  onGifPress: () => void;
  onWingwomanPress: () => void;
  onNudgePress: () => void;
  wingwomanLoading: boolean;
  nudgeLoading: boolean;
}

export function ActionTray({
  onEmojiPress,
  onGifPress,
  onWingwomanPress,
  onNudgePress,
  wingwomanLoading,
  nudgeLoading,
}: ActionTrayProps) {
  const colors = useThemeColors();
  const styles = StyleSheet.create({
    tray: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.surface,
      backgroundColor: colors.background,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    chipRoxy: {
      borderWidth: 1,
      borderColor: colors.roxy + '40',
    },
    chipIcon: { fontSize: 14 },
    chipLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    chipLabelRoxy: { color: colors.roxy },
  });

  return (
    <View style={styles.tray}>
      <TouchableOpacity style={styles.chip} onPress={onEmojiPress} hitSlop={4}>
        <Text style={styles.chipIcon}>😊</Text>
        <Text style={styles.chipLabel}>Emoji</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.chip} onPress={onGifPress} hitSlop={4}>
        <Text style={styles.chipLabel}>GIF</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.chip, styles.chipRoxy]}
        onPress={onWingwomanPress}
        disabled={wingwomanLoading}
        hitSlop={4}
      >
        <BusySwap busy={wingwomanLoading} label="Roxy is thinking">
          <Text style={styles.chipIcon}>✨</Text>
          <Text style={[styles.chipLabel, styles.chipLabelRoxy]}>Wingwoman</Text>
        </BusySwap>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.chip, styles.chipRoxy]}
        onPress={onNudgePress}
        disabled={nudgeLoading}
        hitSlop={4}
      >
        <BusySwap busy={nudgeLoading} label="Roxy is thinking">
          <Text style={styles.chipIcon}>💜</Text>
          <Text style={[styles.chipLabel, styles.chipLabelRoxy]}>Nudge</Text>
        </BusySwap>
      </TouchableOpacity>
    </View>
  );
}
