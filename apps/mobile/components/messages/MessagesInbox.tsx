import { useMemo, type ReactNode } from 'react';
import { SectionList, View, Text, StyleSheet } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { Avatar } from '../ui/Avatar';
import { Crest } from '../discover/Crest';
import type { InboxCommunity } from '../../lib/inboxCommunities';
import { TYPE, emphasized } from '../../lib/typography';
import { RADII, SPACE, MARGIN, identityFor, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/** Avatar and crest size on a 72 dp row (direction › Spacing). */
const AVATAR = 48;
/** The stacked-initials pair inside a 48 dp group avatar. */
const STACK_AVATAR = 30;
const ROW_MIN = 72;
/** Unread is an 8 dp `pink` dot (direction › Navigation). */
const DOT = SPACE[1];
/** The presence dot on a person's avatar. */
const ONLINE_DOT = SPACE[2];
const SKELETON_ROWS = 3;

/**
 * The two inbox lists (v2 board v2-06, normal state).
 *
 * People and Communities are two sections. An empty people list is a compact
 * line — Communities stays on screen — because the old shared list drew a
 * full-screen empty and made group chat look missing.
 *
 * v2: rows sit on the ground, 72 dp, avatar or crest at 48. Unread is the
 * emphasized preview plus an 8 dp `pink` dot; the count is spoken in the
 * accessibility label, not painted as a badge. Shape carries the kind: circles
 * for people, crest squircles with initials for communities. v0's caps eyebrows
 * ("DIRECT", "COMMUNITY CHATS") and the "N CHANNELS" caps pill are gone; the
 * people section opens with the screen's Requests row (`directHeader`) and the
 * Communities group has a quiet sentence-case heading.
 */
export type InboxDm = {
  id: string;
  participant_ids: string[];
  last_message_at: string | null;
  partner: { id: string; display_name: string; username: string } | null;
  lastMessagePreview: string;
  unreadCount: number;
  /** Private group (migration 132). Absent on older callers = 'direct'. */
  kind?: 'direct' | 'group';
  title?: string;
  emoji?: string | null;
  memberCount?: number;
  /** Up to three names for the stacked-initials avatar. */
  memberNames?: string[];
  muted?: boolean;
};

type Props = {
  chats: InboxDm[];
  communities: InboxCommunity[];
  unreadCounts: Record<string, number>;
  onOpenDm: (item: InboxDm) => void;
  onOpenCommunity: (item: InboxCommunity) => void;
  onStartChat: () => void;
  formatTime: (ts: string | null) => string;
  isPartnerOnline: (item: InboxDm) => boolean;
  loading?: boolean;
  onRefresh?: () => void;
  /** Leads the people section — the screen's Requests row. */
  directHeader?: ReactNode;
  footer?: ReactNode;
};

/**
 * A row is a person or a community, and the two carry different fields.
 *
 * `SectionList` infers ONE item type across every section, so a union of two
 * differently-shaped sections does not satisfy `SectionListData<ItemT, SectionT>`
 * — the community rows are not assignable to the DM row type. The item type is
 * therefore the union, and `section.key` discriminates it at the render site.
 */
type InboxRow = InboxDm | InboxCommunity;
type DirectSection = { key: 'direct'; data: InboxRow[] };
type CommunitySection = { key: 'community'; data: InboxRow[] };
type InboxSection = DirectSection | CommunitySection;

function channelWords(count: number): string {
  if (count <= 0) return 'channels';
  return `${count} ${count === 1 ? 'channel' : 'channels'}`;
}

export function MessagesInbox({
  chats,
  communities,
  unreadCounts,
  onOpenDm,
  onOpenCommunity,
  onStartChat,
  formatTime,
  isPartnerOnline,
  loading = false,
  onRefresh,
  directHeader,
  footer,
}: Props) {
  const colors = useThemeColors();
  // Built once per theme, not on every render (jank audit #8).
  const s = useMemo(() => styles(colors), [colors]);

  const sections: InboxSection[] = [
    { key: 'direct', data: chats },
    { key: 'community', data: communities },
  ];

  const unreadDot = (id: string, muted: boolean) => (
    <View
      testID={`inbox-unread-${id}`}
      style={[s.dot, { backgroundColor: muted ? colors.control : colors.pink }]}
    />
  );

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item, index) => `${item.id}-${index}`}
      stickySectionHeadersEnabled={false}
      extraData={`${chats.length}-${communities.length}-${Object.values(unreadCounts).join(',')}`}
      refreshing={loading}
      onRefresh={onRefresh}
      contentContainerStyle={s.list}
      renderSectionHeader={({ section }) =>
        section.key === 'direct' ? (
          <View testID="inbox-section-direct">{directHeader}</View>
        ) : (
          <Text style={s.groupHeading} testID="inbox-section-community" accessibilityRole="header">
            Communities
          </Text>
        )
      }
      renderSectionFooter={({ section }) => {
        if (section.key === 'direct' && section.data.length === 0) {
          if (loading) {
            return (
              <View testID="inbox-direct-loading" accessibilityLabel="Loading your messages">
                {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                  <View key={i} style={s.row}>
                    <View style={[s.skelAvatar, { backgroundColor: colors.raised }]} />
                    <View style={s.content}>
                      <View style={[s.skelLine, s.skelShort, { backgroundColor: colors.raised }]} />
                      <View style={[s.skelLine, s.skelLong, { backgroundColor: colors.raised }]} />
                    </View>
                  </View>
                ))}
              </View>
            );
          }
          return (
            <View style={s.empty} testID="inbox-direct-empty">
              <Text style={s.emptyText}>
                No messages yet. When someone writes, it waits here as a request until you say yes.
              </Text>
              <TouchableOpacity
                onPress={onStartChat}
                accessibilityRole="button"
                accessibilityLabel="Start a chat"
                style={s.emptyCta}
                testID="inbox-start-chat"
              >
                <Text style={s.emptyCtaText}>Start a chat</Text>
              </TouchableOpacity>
            </View>
          );
        }
        if (section.key === 'community' && section.data.length === 0) {
          return (
            <View style={s.empty} testID="inbox-community-empty">
              <Text style={s.emptyText}>
                Join a community on Discover and its chat shows up here.
              </Text>
            </View>
          );
        }
        return null;
      }}
      renderItem={({ item, section }) => {
        if (section.key === 'direct') {
          const dm = item as InboxDm;
          const unread = unreadCounts[dm.id] ?? dm.unreadCount ?? 0;
          const hasUnread = unread > 0;
          const isGroup = dm.kind === 'group';
          const online = !isGroup && isPartnerOnline(dm);
          const name = isGroup ? (dm.title ?? 'Group') : (dm.partner?.display_name ?? 'Unknown');
          const muted = !!dm.muted;
          const label = [
            name,
            isGroup ? `group of ${dm.memberCount ?? 0}` : null,
            hasUnread ? `${unread} unread` : null,
            muted ? 'muted' : null,
          ].filter(Boolean).join(', ');
          return (
            <TouchableOpacity
              style={s.row}
              onPress={() => onOpenDm(dm)}
              accessibilityRole="button"
              accessibilityLabel={label}
              testID={isGroup ? `inbox-group-${dm.id}` : `inbox-dm-${dm.id}`}
            >
              <View style={s.avaWrap}>
                {isGroup && !dm.emoji ? (
                  <View style={s.stack}>
                    {(dm.memberNames ?? []).slice(0, 2).map((n, i) => (
                      <View
                        key={`${n}-${i}`}
                        style={[s.stackItem, i === 0 ? s.stackBack : s.stackFront]}
                      >
                        <Avatar name={n} size={STACK_AVATAR} testID={`inbox-stack-${i}`} />
                      </View>
                    ))}
                  </View>
                ) : isGroup ? (
                  <View style={[s.emojiAva, { backgroundColor: identityFor(dm.id) }]}>
                    <Text style={s.emoji}>{dm.emoji}</Text>
                  </View>
                ) : (
                  <Avatar name={name} seed={dm.partner?.id ?? name} size={AVATAR} testID={`inbox-avatar-${dm.id}`} />
                )}
                {online ? <View style={s.onlineDot} testID={`inbox-online-${dm.id}`} /> : null}
              </View>
              <View style={s.content}>
                <View style={s.nameLine}>
                  <View style={s.nameWrap}>
                    <Text style={s.name} numberOfLines={1}>{name}</Text>
                    {muted ? (
                      <Ionicons
                        name="notifications-off-outline"
                        size={TYPE.meta.lineHeight}
                        color={colors.ink3}
                        testID={`inbox-muted-${dm.id}`}
                      />
                    ) : null}
                  </View>
                  <Text style={s.time}>{formatTime(dm.last_message_at)}</Text>
                </View>
                <Text style={[s.preview, hasUnread && !muted && s.previewUnread]} numberOfLines={1}>
                  {dm.lastMessagePreview}
                </Text>
              </View>
              <View style={s.dotSlot}>{hasUnread ? unreadDot(dm.id, muted) : null}</View>
            </TouchableOpacity>
          );
        }

        const community = item as InboxCommunity;
        const unread = community.unreadCount ?? 0;
        const hasUnread = unread > 0;
        const label = [
          `${community.name} community chat`,
          channelWords(community.channelCount),
          hasUnread ? `${unread} unread` : null,
          community.muted ? 'muted' : null,
        ].filter(Boolean).join(', ');
        return (
          <TouchableOpacity
            style={s.row}
            onPress={() => onOpenCommunity(community)}
            accessibilityRole="button"
            accessibilityLabel={label}
            testID={`inbox-community-${community.id}`}
          >
            <Crest name={community.name} seed={community.id} size={AVATAR} testID={`inbox-crest-${community.id}`} />
            <View style={s.content}>
              <Text style={s.name} numberOfLines={1}>{community.name}</Text>
              <Text
                style={[s.preview, hasUnread && !community.muted && s.previewUnread]}
                numberOfLines={1}
              >
                {community.preview}
              </Text>
            </View>
            <View style={s.dotSlot}>{hasUnread ? unreadDot(community.id, community.muted) : null}</View>
          </TouchableOpacity>
        );
      }}
      ListFooterComponent={footer ? <>{footer}</> : null}
    />
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  list: { flexGrow: 1, paddingBottom: SPACE[6] },
  groupHeading: {
    ...TYPE.meta, color: colors.ink2,
    paddingHorizontal: MARGIN, paddingTop: SPACE[5], paddingBottom: SPACE[1],
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    minHeight: ROW_MIN,
    paddingHorizontal: MARGIN, paddingVertical: SPACE[1],
  },
  avaWrap: { width: AVATAR, height: AVATAR },
  emojiAva: {
    width: AVATAR, height: AVATAR, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  emoji: { ...TYPE.title },
  stack: { width: AVATAR, height: AVATAR },
  stackItem: {
    position: 'absolute', borderRadius: RADII.pill,
    borderWidth: 2, borderColor: colors.ground,
  },
  stackBack: { top: 0, left: 0 },
  stackFront: { bottom: 0, right: 0 },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: ONLINE_DOT, height: ONLINE_DOT, borderRadius: RADII.pill,
    backgroundColor: colors.success,
    borderWidth: 2, borderColor: colors.ground,
  },
  content: { flex: 1, gap: SPACE[0] / 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE[1] },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACE[0], flexShrink: 1 },
  name: { ...TYPE.label, color: colors.ink, flexShrink: 1 },
  time: { ...TYPE.meta, color: colors.ink3, flexShrink: 0 },
  preview: { ...TYPE.body, color: colors.ink2 },
  previewUnread: { ...emphasized('body'), color: colors.ink },
  dotSlot: { width: DOT, alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: RADII.pill },
  empty: {
    paddingHorizontal: MARGIN, paddingVertical: SPACE[2], gap: SPACE[2],
    alignItems: 'flex-start',
  },
  emptyText: { ...TYPE.body, color: colors.ink2 },
  emptyCta: {
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[4],
    borderRadius: RADII.pill, backgroundColor: colors.raised,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyCtaText: { ...TYPE.label, color: colors.ink },
  skelAvatar: { width: AVATAR, height: AVATAR, borderRadius: RADII.pill },
  skelLine: { height: SPACE[2], borderRadius: RADII.pill },
  skelShort: { width: '40%' },
  skelLong: { width: '75%', marginTop: SPACE[0] },
});
