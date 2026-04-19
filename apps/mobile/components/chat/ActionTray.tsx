import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { COLORS } from '../../lib/constants';

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
        {wingwomanLoading ? (
          <ActivityIndicator size="small" color={COLORS.roxy} />
        ) : (
          <>
            <Text style={styles.chipIcon}>✨</Text>
            <Text style={[styles.chipLabel, styles.chipLabelRoxy]}>Wingwoman</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.chip, styles.chipRoxy]}
        onPress={onNudgePress}
        disabled={nudgeLoading}
        hitSlop={4}
      >
        {nudgeLoading ? (
          <ActivityIndicator size="small" color={COLORS.roxy} />
        ) : (
          <>
            <Text style={styles.chipIcon}>💜</Text>
            <Text style={[styles.chipLabel, styles.chipLabelRoxy]}>Nudge</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipRoxy: {
    borderWidth: 1,
    borderColor: COLORS.roxy + '40',
  },
  chipIcon: { fontSize: 14 },
  chipLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500' },
  chipLabelRoxy: { color: COLORS.roxy },
});
