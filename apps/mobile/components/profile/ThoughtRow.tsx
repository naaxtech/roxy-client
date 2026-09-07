import type { ReactNode } from 'react';
import { View, Text, Pressable, TouchableOpacity, Share, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { avatarGradient, isPresetAvatar, presetColor, presetEmoji } from '../../lib/avatars';
import type { PostType } from '../../types';

export type ThoughtAuthor = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

export type Thought = {
  id: string;
  content: string;
  post_type: PostType;
  created_at: string;
  replyCount: number;
  likeCount: number;
  author: ThoughtAuthor | null;
};

interface Props {
  thought: Thought;
  liked: boolean;
  /** True while this is not the last row — draws the continuity rail. */
  connected: boolean;
  onOpen: () => void;
  onReply: () => void;
  onLike: () => void;
  onPressAuthor: (userId: string) => void;
  testID?: string;
}

const AVATAR = 38;

/**
 * One thought, laid out the way X and Threads lay out a post.
 *
 * The first version showed a timestamp and a body and nothing else. That reads
 * as a log, not as something somebody said to people: there was no face, no
 * name, and — the part that matters — no way to answer. A post you cannot reply
 * to is a broadcast, and this tab is supposed to be the conversational half of
 * the profile.
 *
 * So: avatar and name at the top, the words at reading size beneath, and a
 * three-action row under that. Reply opens the post's own page, where the
 * composer and the existing comment thread already live — a second comment
 * system on this screen would be a second place for a reply to go missing.
 */
export function ThoughtRow({
  thought, liked, connected, onOpen, onReply, onLike, onPressAuthor, testID,
}: Props) {
  const colors = useThemeColors();
  const name = thought.author?.display_name?.trim()
    || thought.author?.username?.trim()
    || 'Someone who left';
  const handle = thought.author?.username?.trim();
  const avatarUrl = thought.author?.avatar_url ?? null;

  const s = StyleSheet.create({
    row: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 14 },
    // The avatar column doubles as the rail's gutter, so the thread line sits
    // under the face it belongs to — Threads' own arrangement.
    left: { width: AVATAR, alignItems: 'center' },
    avatar: {
      width: AVATAR, height: AVATAR, borderRadius: 99,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    initial: { ...TYPE.caption, color: '#FFF8FB', fontWeight: '800' },
    emoji: { fontSize: 19 },
    rail: { flex: 1, width: 2, marginTop: 8, borderRadius: 1, backgroundColor: colors.line },
    body: { flex: 1, minWidth: 0, paddingBottom: 14 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    name: { ...TYPE.caption, fontWeight: '800', color: colors.textPrimary, flexShrink: 1 },
    handle: { ...TYPE.micro, color: colors.textMuted, flexShrink: 1 },
    dot: { ...TYPE.micro, color: colors.textMuted },
    when: { ...TYPE.micro, color: colors.textMuted },
    // Never clamped. The whole reason this tab exists is that the words are
    // not cropped.
    text: { ...TYPE.bodyLg, color: colors.textPrimary, marginTop: 3 },
    actions: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginLeft: -8 },
    action: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 8,
      minWidth: 64,
    },
    count: { ...TYPE.micro, color: colors.textMuted, fontWeight: '600' },
    countOn: { color: colors.roxy },
  });

  let face: ReactNode;
  if (avatarUrl && isPresetAvatar(avatarUrl)) {
    face = (
      <View style={[s.avatar, { backgroundColor: presetColor(avatarUrl) }]}>
        <Text style={s.emoji}>{presetEmoji(avatarUrl)}</Text>
      </View>
    );
  } else if (avatarUrl) {
    face = (
      <ExpoImage
        source={{ uri: avatarUrl }}
        contentFit="cover"
        recyclingKey={thought.id}
        style={s.avatar}
      />
    );
  } else {
    face = (
      <View style={s.avatar}>
        <LinearGradient
          colors={[...avatarGradient(thought.author?.id ?? name)] as [string, string, ...string[]]}
          style={StyleSheet.absoluteFill}
        />
        <Text style={s.initial}>{name.slice(0, 1).toUpperCase()}</Text>
      </View>
    );
  }

  const share = () => {
    const url = Linking.createURL(`/community/post/${thought.id}`);
    // Android reads `message`, iOS prefers `url`. The author's name is
    // deliberately absent — same rule the feed follows: she shared a thought,
    // she did not out the person who wrote it.
    void Share.share({ message: `Something on Roxy — ${url}`, url })
      .catch(() => { /* viewer dismissed the sheet */ });
  };

  return (
    <View testID={testID}>
      <View style={s.row}>
        <View style={s.left}>
          <TouchableOpacity
            onPress={() => thought.author?.id && onPressAuthor(thought.author.id)}
            disabled={!thought.author?.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}'s profile`}
            hitSlop={6}
          >
            {face}
          </TouchableOpacity>
          {connected ? <View style={s.rail} /> : null}
        </View>

        <View style={s.body}>
          {/* Tapping the words opens the thought, the way it does everywhere
              else. The action row below is outside this so a tap on Reply is
              never swallowed by the row's own press. */}
          <Pressable onPress={onOpen} accessible={false}>
            <View style={s.head}>
              <Text style={s.name} numberOfLines={1}>{name}</Text>
              {handle ? <Text style={s.handle} numberOfLines={1}>@{handle}</Text> : null}
              <Text style={s.dot}>·</Text>
              <Text style={s.when}>{relativeWhen(thought.created_at)}</Text>
            </View>
            <Text style={s.text}>{thought.content}</Text>
          </Pressable>

          <View style={s.actions}>
            <TouchableOpacity
              style={s.action}
              onPress={onReply}
              accessibilityRole="button"
              accessibilityLabel={`Reply. ${thought.replyCount} ${thought.replyCount === 1 ? 'reply' : 'replies'}`}
              testID={testID ? `${testID}-reply` : undefined}
            >
              <Ionicons name="chatbubble-outline" size={16} color={colors.textMuted} />
              <Text style={s.count}>{thought.replyCount > 0 ? thought.replyCount : 'Reply'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.action}
              onPress={onLike}
              accessibilityRole="button"
              accessibilityLabel={liked ? 'Unlike' : 'Like'}
              accessibilityState={{ selected: liked }}
              aria-pressed={liked}
              testID={testID ? `${testID}-like` : undefined}
            >
              <Ionicons
                name={liked ? 'heart' : 'heart-outline'}
                size={16}
                color={liked ? colors.roxy : colors.textMuted}
              />
              <Text style={[s.count, liked && s.countOn]}>
                {thought.likeCount > 0 ? thought.likeCount : 'Like'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.action}
              onPress={share}
              accessibilityRole="button"
              accessibilityLabel="Share this thought"
              testID={testID ? `${testID}-share` : undefined}
            >
              <Ionicons name="arrow-redo-outline" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * "2h", "3d", "12 Aug".
 *
 * Built from elapsed milliseconds, never by shifting a Date across a month
 * boundary — `setMonth(getMonth() - 1)` overflows on a day the target month
 * does not have, which is the arithmetic `.claude/rules/tests.md` names.
 */
export function relativeWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
