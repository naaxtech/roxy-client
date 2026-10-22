import { useMemo, type ReactNode } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Sheet } from '../feedback';
import { PressableScale } from '../ui/PressableScale';
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
  /** Above the actions: the one-tap reaction row (CHAT-17). */
  header?: ReactNode;
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
 * The shared Sheet (F5), not `ActionSheetIOS`: that API is iOS-only and this app ships to
 * Android and web from the same tree.
 */
export function ChannelMessageActions({
  title, actions, visible, onClose, header, testID = 'channel-actions',
}: Props) {
  const colors = useThemeColors();

  // Built once per theme, not on every render (jank audit #8).
  const s = useMemo(() => StyleSheet.create({
    sheet: { paddingTop: 4, paddingBottom: 16, paddingHorizontal: 16, gap: 4 },
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
  }), [colors]);

  return (
    // F5: the shared Sheet (spring rise, drag, only the scrim fades; the
    // scrim is the Close target, so no tap-swallower is needed).
    <Sheet visible={visible} onClose={onClose} accessibilityLabel={title} closeLabel="Close menu" dragFrom="sheet" testID={testID} style={s.sheet}>
      <Text style={s.title} numberOfLines={1}>{title}</Text>
      {header ?? null}

      {actions.map((action) => (
        <PressableScale
          key={action.key}
          feedback="layer"
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
        </PressableScale>
      ))}

      <PressableScale
        style={s.cancel}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        testID={`${testID}-cancel`}
      >
        <Text style={s.cancelText}>Cancel</Text>
      </PressableScale>
    </Sheet>
  );
}
