import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { avatarGradient, isPresetAvatar, presetColor, presetEmoji } from '../../lib/avatars';
import { authorName, type ChannelMessage as Message } from '../../lib/channels';

interface Props {
  message: Message;
  /** Opens the author's profile. Absent for an author who no longer exists. */
  onPressAuthor?: (userId: string) => void;
  /**
   * The safety menu: report, block, and — for her own message or a moderator's
   * — remove. A group message surface without this is one a woman cannot get
   * out of, which is the one thing this app cannot ship.
   */
  onLongPress?: (message: Message) => void;
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
export function ChannelMessage({ message, onPressAuthor, onLongPress, testID }: Props) {
  const colors = useThemeColors();
  const name = authorName(message.author);
  const removed = message.deleted_at !== null;
  const avatarUrl = message.author?.avatar_url ?? null;

  const s = StyleSheet.create({
    row: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
    // Square, not just tall. A 48-high target 34 wide fails the width half of
    // the Play Console pre-launch check, which is what lib/touchTargets.ts is
    // there to stop.
    avatarHit: {
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -(MIN_TOUCH_TARGET - AVATAR) / 2,
    },
    avatar: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: 99,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    initial: { ...TYPE.caption, color: '#FFF8FB', fontWeight: '800' },
    emoji: { fontSize: 17 },
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

  let face: ReactNode;
  if (avatarUrl && isPresetAvatar(avatarUrl)) {
    face = (
      <View style={[s.avatar, { backgroundColor: presetColor(avatarUrl) }]}>
        <Text style={s.emoji}>{presetEmoji(avatarUrl)}</Text>
      </View>
    );
  } else if (avatarUrl) {
    // Her actual face. The gradient initial was rendered for everyone while
    // avatar_url was fetched on all 50 rows and thrown away.
    face = (
      <ExpoImage
        source={{ uri: avatarUrl }}
        contentFit="cover"
        recyclingKey={message.id}
        style={s.avatar}
        testID={testID ? `${testID}-avatar-image` : undefined}
      />
    );
  } else {
    face = (
      <View style={s.avatar}>
        <LinearGradient
          colors={[...avatarGradient(message.sender_id ?? name)] as [string, string, ...string[]]}
          style={StyleSheet.absoluteFill}
        />
        <Text style={s.initial}>{initial}</Text>
      </View>
    );
  }

  const avatar = (
    <View style={s.avatar} testID={testID ? `${testID}-avatar` : undefined}>{face}</View>
  );

  return (
    <Pressable
      onLongPress={onLongPress ? () => onLongPress(message) : undefined}
      // A long-press-only Pressable must not swallow the row's own semantics,
      // so the identity stays on the pieces inside it.
      accessible={false}
      testID={testID}
    >
      <View style={s.row}>
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
          <View style={s.avatarHit}>{avatar}</View>
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
    </Pressable>
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
