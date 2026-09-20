import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MiniWinsCard } from '../grow/MiniWinsCard';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

interface Props {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}

/**
 * Today's Mini Wins, as a sheet.
 *
 * The Grow tab used to be a place you went to see your progress. Three small
 * daily asks do not deserve a fifth of the navigation, so they become this: a
 * sheet the streak chip opens, and that opens itself once on the first launch of
 * a day. `MiniWinsCard` is reused unchanged — the quests, their counts and their
 * routes were already right; only their home moved.
 *
 * Unlike the pager behind it this is ordinary themed chrome, so it reads
 * `useThemeColors()` rather than the stage palette.
 */
export function MiniWinsSheet({ visible, userId, onClose }: Props) {
  const colors = useThemeColors();

  if (!userId) return null;

  const s = StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(8,3,18,0.66)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: RADII.sheet,
      borderTopRightRadius: RADII.sheet,
      paddingHorizontal: 18,
      paddingTop: 10,
      paddingBottom: 30,
      gap: 12,
    },
    grabber: {
      alignSelf: 'center', width: 38, height: 4, borderRadius: 2,
      backgroundColor: colors.line,
    },
    headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { ...TYPE.headline, color: colors.textPrimary },
    sub: { ...TYPE.caption, color: colors.textSecondary },
    close: {
      width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
      alignItems: 'center', justifyContent: 'center', borderRadius: RADII.pill,
    },
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Dismiss" testID="mini-wins-scrim">
        {/* Swallow taps inside the sheet so they do not dismiss it. */}
        <Pressable onPress={() => undefined} testID="mini-wins-sheet">
          <View style={s.sheet}>
            <View style={s.grabber} />
            <View style={s.headRow}>
              <View>
                <Text style={s.title}>Today&apos;s Mini Wins</Text>
                <Text style={s.sub}>Three small things. No streak police.</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                testID="mini-wins-close"
                style={s.close}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <MiniWinsCard userId={userId} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
