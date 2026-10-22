import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { ChatMessage } from '../../hooks/useRealtime';
import { canStillEdit } from '../../lib/chat';
import { haptic } from '../../lib/haptics';
import { TYPE } from '../../lib/typography';
import { RADII, type ThemeColors, scrim } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';

/** Same six as the quick bar, so muscle memory carries. */
export const SHEET_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '💜'];

interface Props {
  message: ChatMessage | null;
  currentUserId: string;
  /** Injected for tests; defaults to Date.now(). */
  now?: number;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onMoreReactions: (messageId: string) => void;
  onReply: (message: ChatMessage) => void;
  onCopy: (text: string) => void;
  onEdit: (message: ChatMessage) => void;
  onUnsend: (message: ChatMessage) => void;
  onReport: (message: ChatMessage) => void;
}

type Action = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  run: () => void;
};

/**
 * The long-press menu (CHAT-11, CHAT-17): react, reply, copy, edit, unsend,
 * report — one sheet, iMessage-style, with the message it acts on shown at
 * the top so she never reports or unsends the wrong one.
 *
 * Offers follow the server's rules so a tap is never a dead end: edit and
 * unsend only on her own message inside 15 minutes (the trigger is still the
 * judge), edit only on text, report only on someone else's. A bubble still
 * sending has no server row yet, so nothing that needs one is offered.
 */
export function MessageActionSheet({
  message, currentUserId, now, onClose, onReact, onMoreReactions,
  onReply, onCopy, onEdit, onUnsend, onReport,
}: Props) {
  const colors = useThemeColors();
  const s = styles(colors);
  if (!message) return null;

  const isOwn = message.sender_id === currentUserId;
  const settled = (message.deliveryStatus ?? 'sent') === 'sent';
  const isText = message.message_type === 'text';
  const canChange = isOwn && settled && !message.deleted_at
    && (message.message_type === 'text' || message.message_type === 'image')
    && canStillEdit(message.created_at, now ?? Date.now());
  const text = message.content ?? '';

  const close = (fn: () => void) => () => { onClose(); fn(); };

  const actions: Action[] = [];
  if (settled && !message.deleted_at) {
    actions.push({ key: 'reply', label: 'Reply', icon: 'arrow-undo-outline', run: close(() => onReply(message)) });
  }
  if (isText && text && !message.deleted_at) {
    actions.push({ key: 'copy', label: 'Copy', icon: 'copy-outline', run: close(() => onCopy(text)) });
  }
  if (canChange && isText) {
    actions.push({ key: 'edit', label: 'Edit', icon: 'create-outline', run: close(() => onEdit(message)) });
  }
  if (canChange) {
    actions.push({ key: 'unsend', label: 'Unsend', icon: 'arrow-undo-circle-outline', danger: true, run: close(() => onUnsend(message)) });
  }
  if (!isOwn && settled && message.sender_id) {
    actions.push({ key: 'report', label: 'Report message', icon: 'flag-outline', danger: true, run: close(() => onReport(message)) });
  }

  const preview = message.deleted_at
    ? 'Message unsent'
    : message.message_type === 'image' ? 'GIF' : text;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close message actions" />
      <View style={s.sheet} testID="message-action-sheet">
        <View style={s.grabber} />
        <View style={[s.preview, isOwn ? s.previewOwn : s.previewOther]}>
          <Text style={[s.previewText, isOwn && s.previewTextOwn]} numberOfLines={3}>{preview}</Text>
        </View>

        {settled && !message.deleted_at && message.message_type !== 'system' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.reacts}>
            {SHEET_EMOJIS.map((e) => (
              <TouchableOpacity
                key={e}
                style={s.react}
                // A committed reaction: the light tap (§3.3).
                onPress={close(() => { haptic('tap'); onReact(message.id, e); })}
                accessibilityRole="button"
                accessibilityLabel={`React ${e}`}
                testID={`msg-react-${e}`}
              >
                <Text style={s.reactText}>{e}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={s.react}
              onPress={close(() => onMoreReactions(message.id))}
              accessibilityRole="button"
              accessibilityLabel="More reactions"
              testID="msg-react-more"
            >
              <Ionicons name="add" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </ScrollView>
        ) : null}

        <View style={s.list}>
          {actions.map((a, i) => (
            <TouchableOpacity
              key={a.key}
              style={[s.row, i > 0 && s.rowBorder]}
              onPress={a.run}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              testID={`msg-action-${a.key}`}
            >
              <Text style={[s.rowText, a.danger && s.rowDanger]}>{a.label}</Text>
              <Ionicons name={a.icon} size={19} color={a.danger ? colors.errorInk : colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
        {canChange ? (
          <Text style={s.hint}>Edits and unsends are visible to everyone in the chat. Moderators can still see the original if it&apos;s reported.</Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: scrim(0.55) },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 30, gap: 12,
    width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line },
  preview: { maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  previewOwn: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  previewOther: { alignSelf: 'flex-start', backgroundColor: colors.surfaceLight, borderBottomLeftRadius: 6 },
  previewText: { ...TYPE.body, color: colors.textPrimary },
  previewTextOwn: { color: '#fff' },
  reacts: {
    gap: 6, padding: 6, borderRadius: RADII.pill, backgroundColor: colors.surfaceLight,
  },
  react: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  reactText: { fontSize: 24 },
  list: { borderRadius: RADII.lg, backgroundColor: colors.surfaceLight, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET + 4, paddingHorizontal: 16,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowText: { ...TYPE.bodyLg, color: colors.textPrimary },
  rowDanger: { color: colors.errorInk, fontWeight: '600' },
  hint: { ...TYPE.micro, color: colors.textMuted, lineHeight: 15, paddingHorizontal: 4 },
});
