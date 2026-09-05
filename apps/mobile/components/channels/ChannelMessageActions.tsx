import { Modal, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

export interface ChannelAction {
  key: string;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  /** The message's author, so she can see who the actions apply to. */
  title: string;
  actions: ChannelAction[];
  visible: boolean;
  onClose: () => void;
  testID?: string;
}

/**
 * The safety menu on a channel message: report, block, and remove.
 *
 * A group message surface without report and block is one a woman cannot get
 * out of. The DM screen has had both since it shipped; channels launched with
 * neither, so the only route out of harassment in `#general` was to open his
 * profile and hope there was a control on it.
 *
 * A Modal, not `ActionSheetIOS`: that API is iOS-only and this app ships to
 * Android and web from the same tree.
 */
export function ChannelMessageActions({
  title, actions, visible, onClose, testID = 'channel-actions',
}: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 18,
      paddingBottom: 28,
      paddingHorizontal: 16,
      gap: 4,
    },
    title: { ...TYPE.caption, color: colors.textMuted, paddingHorizontal: 4, paddingBottom: 8 },
    action: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      paddingHorizontal: 4,
      borderRadius: RADII.sm,
    },
    label: { ...TYPE.body, color: colors.textPrimary },
    destructive: { color: colors.errorInk },
    cancel: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 10,
      borderRadius: RADII.md,
      backgroundColor: colors.backgroundAlt,
    },
    cancelText: { ...TYPE.body, fontWeight: '700', color: colors.textSecondary },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={s.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      >
        {/* Stops a tap inside the sheet from closing it via the scrim. */}
        <Pressable style={s.sheet} onPress={() => {}} accessible={false} testID={testID}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>

          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={s.action}
              onPress={() => {
                // Closed FIRST: an action that opens the report modal cannot
                // present it underneath a sheet that is still up.
                onClose();
                action.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              testID={`${testID}-${action.key}`}
            >
              <Text style={[s.label, action.destructive && s.destructive]}>{action.label}</Text>
            </Pressable>
          ))}

          <Pressable
            style={s.cancel}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            testID={`${testID}-cancel`}
          >
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
