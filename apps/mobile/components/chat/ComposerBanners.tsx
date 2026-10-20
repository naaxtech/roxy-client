import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/** "Replying to Ana" / "Editing message" strip above the input. */
export function ReplyBar({
  mode, name, text, onCancel,
}: { mode: 'reply' | 'edit'; name: string; text: string; onCancel: () => void }) {
  const colors = useThemeColors();
  const s = styles(colors);
  return (
    <View style={s.replyBar} testID={`composer-${mode}-bar`}>
      <View style={[s.replyAccent, mode === 'edit' && { backgroundColor: colors.secondary }]} />
      <Ionicons
        name={mode === 'reply' ? 'arrow-undo' : 'create-outline'}
        size={16}
        color={mode === 'reply' ? colors.primary : colors.secondary}
      />
      <View style={{ flex: 1 }}>
        <Text style={s.replyTitle} numberOfLines={1}>
          {mode === 'reply' ? `Replying to ${name}` : 'Editing message'}
        </Text>
        <Text style={s.replyText} numberOfLines={1}>{text}</Text>
      </View>
      <TouchableOpacity
        onPress={onCancel}
        style={s.close}
        accessibilityRole="button"
        accessibilityLabel={mode === 'reply' ? 'Cancel reply' : 'Cancel edit'}
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

/**
 * A stranger wrote to her (CHAT-02). She decides before anything else
 * happens: her reading it is never reported back (no receipts on requests),
 * and Delete is silent — the sender is never told.
 */
export function RequestGate({
  name, busy, onAccept, onDelete, onBlock,
}: { name: string; busy: boolean; onAccept: () => void; onDelete: () => void; onBlock: () => void }) {
  const colors = useThemeColors();
  const s = styles(colors);
  const guard = (fn: () => void) => () => { if (!busy) fn(); };
  return (
    <View style={s.gate} testID="request-gate">
      <Text style={s.gateTitle}>{name} wants to message you</Text>
      <Text style={s.gateBody}>
        You&apos;re not friends yet. They won&apos;t know you&apos;ve seen this unless you accept.
        Photos and GIFs stay off until you do.
      </Text>
      <View style={s.gateRow}>
        <TouchableOpacity
          style={[s.gateBtn, s.gateGhost]}
          onPress={guard(onBlock)}
          accessibilityRole="button"
          accessibilityLabel={`Block ${name}`}
          accessibilityState={{ disabled: busy }}
          testID="request-gate-block"
        >
          <Text style={[s.gateBtnText, { color: colors.errorInk }]}>Block</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.gateBtn, s.gateGhost]}
          onPress={guard(onDelete)}
          accessibilityRole="button"
          accessibilityLabel="Delete request"
          accessibilityState={{ disabled: busy }}
          testID="request-gate-delete"
        >
          <Text style={s.gateBtnText}>Delete</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.gateBtn, s.gatePrimary, busy && { opacity: 0.6 }]}
          onPress={guard(onAccept)}
          accessibilityRole="button"
          accessibilityLabel={`Accept message request from ${name}`}
          accessibilityState={{ disabled: busy }}
          testID="request-gate-accept"
        >
          <Text style={[s.gateBtnText, { color: inkOn(colors.primary) }]}>Accept</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

type NoticeProps =
  | { kind: 'outgoing_request'; remaining: number; name: string }
  | { kind: 'gone'; reason: 'left' | 'removed' };

/** One line where the composer is limited or gone. */
export function ThreadNotice(props: NoticeProps) {
  const colors = useThemeColors();
  const s = styles(colors);
  if (props.kind === 'gone') {
    return (
      <View style={s.notice} testID="thread-notice-gone">
        <Ionicons name="exit-outline" size={16} color={colors.textMuted} />
        <Text style={s.noticeText}>
          {props.reason === 'left' ? 'You left this group' : "You're no longer in this group"}
        </Text>
      </View>
    );
  }
  const { remaining, name } = props;
  return (
    <View style={s.noticeSoft} testID="thread-notice-request">
      <Ionicons name="paper-plane-outline" size={14} color={colors.textSecondary} />
      <Text style={s.noticeSmall}>
        <Text style={{ fontWeight: '700' }}>Message request · </Text>
        {remaining > 0
          ? `${remaining} message${remaining === 1 ? '' : 's'} left until ${name} accepts. Text only for now.`
          : `Waiting for ${name} to accept.`}
      </Text>
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingLeft: 14, paddingRight: 6, paddingVertical: 6,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
  },
  replyAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.primary },
  replyTitle: { ...TYPE.micro, color: colors.textPrimary, fontWeight: '700' },
  replyText: { ...TYPE.caption, color: colors.textSecondary },
  close: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  gate: {
    margin: 12, padding: 16, gap: 8, borderRadius: RADII.lg,
    backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
  },
  gateTitle: { ...TYPE.title, color: colors.textPrimary },
  gateBody: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 18 },
  gateRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  gateBtn: {
    flex: 1, minHeight: MIN_TOUCH_TARGET, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  gateGhost: { backgroundColor: colors.surfaceLight },
  gatePrimary: { backgroundColor: colors.primary, flex: 1.3 },
  gateBtnText: { ...TYPE.body, fontWeight: '700', color: colors.textPrimary },
  notice: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
  },
  noticeText: { ...TYPE.body, color: colors.textMuted },
  noticeSoft: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingTop: 8,
  },
  noticeSmall: { ...TYPE.micro, color: colors.textSecondary, flex: 1 },
});
