import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { avatarGradient } from '../../lib/avatars';
import { authorName, type ChannelMessage as Message } from '../../lib/channels';

interface Props {
  message: Message;
  /** Opens the author's profile. Absent for an author who no longer exists. */
  onPressAuthor?: (userId: string) => void;
  testID?: string;
}

const AVATAR = 34;

/**
 * One message in a community channel (design markup 673–687).
 *
 * A removed message keeps its place in the thread. Migration 105 soft-deletes
 * precisely so moderating one reply does not punch a hole in the conversation
 * around it, and the row has to render that state rather than vanish.
 */
export function ChannelMessage({ message, onPressAuthor, testID }: Props) {
  const colors = useThemeColors();
  const name = authorName(message.author);
  const removed = message.deleted_at !== null;

  const s = StyleSheet.create({
    row: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
    avatarHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'flex-start' },
    avatar: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: 99,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    initial: { ...TYPE.caption, color: '#FFF8FB', fontWeight: '800' },
    body: { flex: 1, minWidth: 0 },
    head: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
    name: { ...TYPE.micro, fontWeight: '700', color: colors.textPrimary },
    time: { ...TYPE.micro, color: colors.textMuted },
    text: { ...TYPE.caption, color: colors.textSecondary, marginTop: 1 },
    // Italic and muted: it reads as an absence rather than as something said.
    removedText: { ...TYPE.caption, color: colors.textMuted, fontStyle: 'italic', marginTop: 1 },
    edited: { ...TYPE.micro, color: colors.textMuted },
  });

  const initial = name.slice(0, 1).toUpperCase();
  const canOpen = !!(onPressAuthor && message.sender_id);

  const avatar = (
    <View style={s.avatar} testID={testID ? `${testID}-avatar` : undefined}>
      <LinearGradient
        colors={[...avatarGradient(message.sender_id ?? name)] as [string, string, ...string[]]}
        style={StyleSheet.absoluteFill}
      />
      <Text style={s.initial}>{initial}</Text>
    </View>
  );

  return (
    <View style={s.row} testID={testID}>
      {canOpen ? (
        <Pressable
          onPress={() => onPressAuthor?.(message.sender_id as string)}
          style={s.avatarHit}
          accessibilityRole="button"
          accessibilityLabel={`Open ${name}'s profile`}
        >
          {avatar}
        </Pressable>
      ) : (
        avatar
      )}

      <View style={s.body}>
        <View style={s.head}>
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          <Text style={s.time}>{formatTime(message.created_at)}</Text>
          {message.edited_at && !removed ? <Text style={s.edited}>edited</Text> : null}
        </View>

        {removed ? (
          <Text style={s.removedText} testID={testID ? `${testID}-removed` : undefined}>
            Message removed by a moderator.
          </Text>
        ) : (
          <Text style={s.text}>{message.body}</Text>
        )}
      </View>
    </View>
  );
}

/**
 * Clock time for today, a date before that.
 *
 * Built from the timestamp's own value rather than by shifting a Date across a
 * month boundary — `setMonth(getMonth() - 1)` overflows on a day the target
 * month does not have, which is the arithmetic `.claude/rules/tests.md` names.
 */
export function formatTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) {
    return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
