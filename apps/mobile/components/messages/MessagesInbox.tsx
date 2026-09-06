import type { ReactNode } from 'react';
import { SectionList, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { avatarGradient } from '../../lib/avatars';
import { channelCountLabel, type InboxCommunity } from '../../lib/inboxCommunities';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/**
 * The two inbox lists from the 3.0 prototype (markup 421–448).
 *
 * Direct and Community chats used to share one FlatList, with communities
 * stuffed in the footer. An empty DM list then drew a full-screen empty and
 * made group chat look missing. They are two sections now, always labelled,
 * and an empty Direct list is a compact row — Community stays on screen.
 *
 * Shape carries the kind: circle avatars for people, rounded squares for
 * communities, plus a `N CHANNELS` pill so the two cannot be mistaken at a
 * glance even in greyscale.
 */
export type InboxDm = {
  id: string;
  participant_ids: string[];
  last_message_at: string | null;
  partner: { id: string; display_name: string; username: string } | null;
  lastMessagePreview: string;
  unreadCount: number;
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
  footer?: ReactNode;
};

type DirectSection = { key: 'direct'; title: 'DIRECT'; data: InboxDm[] };
type CommunitySection = { key: 'community'; title: 'COMMUNITY CHATS'; data: InboxCommunity[] };
type InboxSection = DirectSection | CommunitySection;

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
  footer,
}: Props) {
  const colors = useThemeColors();
  const s = styles(colors);

  const sections: InboxSection[] = [
    { key: 'direct', title: 'DIRECT', data: chats },
    { key: 'community', title: 'COMMUNITY CHATS', data: communities },
  ];

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item, index) => `${item.id}-${index}`}
      stickySectionHeadersEnabled={false}
      extraData={`${chats.length}-${communities.length}-${Object.values(unreadCounts).join(',')}`}
      refreshing={loading}
      onRefresh={onRefresh}
      contentContainerStyle={s.list}
      renderSectionHeader={({ section }) => (
        <Text
          style={s.divider}
          testID={`inbox-section-${section.key}`}
          accessibilityRole="header"
        >
          {section.title}
        </Text>
      )}
      renderSectionFooter={({ section }) => {
        if (section.key === 'direct' && section.data.length === 0) {
          if (loading) {
            return <ActivityIndicator color={colors.primary} style={s.directSpinner} />;
          }
          return (
            <View style={s.directEmpty} testID="inbox-direct-empty">
              <Text style={s.directEmptyText}>No private messages</Text>
              <TouchableOpacity
                onPress={onStartChat}
                accessibilityRole="button"
                accessibilityLabel="Start a chat"
                activeOpacity={0.85}
                style={s.directEmptyCta}
              >
                <Text style={s.directEmptyCtaText}>Start a chat</Text>
              </TouchableOpacity>
            </View>
          );
        }
        if (section.key === 'community' && section.data.length === 0) {
          return (
            <View style={s.communityEmpty} testID="inbox-community-empty">
              <Text style={s.directEmptyText}>Join a community to see group chat here.</Text>
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
          const online = isPartnerOnline(dm);
          const name = dm.partner?.display_name ?? 'Unknown';
          const grad = avatarGradient(name);
          return (
            <TouchableOpacity
              style={s.row}
              onPress={() => onOpenDm(dm)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${name}${hasUnread ? `, ${unread} unread` : ''}`}
              testID={`inbox-dm-${dm.id}`}
            >
              <View style={s.avaWrap}>
                <LinearGradient colors={grad} style={s.ava}>
                  <Text style={s.avaText}>{name[0]?.toUpperCase() ?? '?'}</Text>
                </LinearGradient>
                {online ? <View style={s.onlineDot} /> : null}
              </View>
              <View style={s.content}>
                <View style={s.nameLine}>
                  <Text style={[s.name, hasUnread && s.nameUnread]} numberOfLines={1}>{name}</Text>
                  <Text style={[s.time, hasUnread && s.timeUnread]}>{formatTime(dm.last_message_at)}</Text>
                </View>
                <View style={s.bottom}>
                  <Text style={[s.preview, hasUnread && s.previewUnread]} numberOfLines={1}>
                    {dm.lastMessagePreview}
                  </Text>
                  {hasUnread ? (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          );
        }

        const community = item as InboxCommunity;
        const unread = community.unreadCount ?? 0;
        const hasUnread = unread > 0;
        const grad = avatarGradient(community.name);
        return (
          <TouchableOpacity
            style={[s.row, community.muted && s.rowMuted]}
            onPress={() => onOpenCommunity(community)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${community.name} community chat`}
            testID={`inbox-community-${community.id}`}
          >
            <LinearGradient colors={grad} style={s.commAva}>
              <Text style={s.avaText}>{community.name[0]?.toUpperCase() ?? '?'}</Text>
            </LinearGradient>
            <View style={s.content}>
              <View style={s.nameRow}>
                <Text style={[s.name, s.nameUnread]} numberOfLines={1}>{community.name}</Text>
                <View style={s.chanTag}>
                  <Text style={s.chanTagText}>{channelCountLabel(community.channelCount)}</Text>
                </View>
              </View>
              <Text style={[s.preview, hasUnread && s.previewUnread]} numberOfLines={1}>
                {community.preview}
              </Text>
            </View>
            {hasUnread ? (
              <View style={s.badge}>
                <Text style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            )}
          </TouchableOpacity>
        );
      }}
      ListFooterComponent={footer ? <>{footer}</> : null}
    />
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  list: { flexGrow: 1, paddingBottom: 24 },
  divider: {
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4,
    ...TYPE.micro, color: colors.textMuted, fontWeight: '800',
    letterSpacing: 1.4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    marginHorizontal: 8, paddingHorizontal: 6, paddingVertical: 8,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 14,
  },
  rowMuted: { opacity: 0.75 },
  avaWrap: { position: 'relative' },
  ava: {
    width: 44, height: 44, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  commAva: {
    width: 44, height: 44, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  avaText: { color: inkOn(colors.secondary), fontWeight: '800', fontSize: 16 },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1,
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2, borderColor: colors.background,
  },
  content: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  name: { ...TYPE.body, color: colors.textSecondary, fontWeight: '600', flexShrink: 1 },
  nameUnread: { color: colors.textPrimary, fontWeight: '700' },
  chanTag: {
    borderRadius: RADII.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surfaceLight, paddingHorizontal: 7, paddingVertical: 2,
  },
  chanTagText: { ...TYPE.micro, color: colors.secondaryInk, fontWeight: '800' },
  time: { ...TYPE.caption, color: colors.textMuted, flexShrink: 0 },
  timeUnread: { color: colors.primary, fontWeight: '600' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { ...TYPE.caption, color: colors.textMuted, flex: 1 },
  previewUnread: { color: colors.textSecondary, fontWeight: '600' },
  badge: {
    backgroundColor: colors.primary, borderRadius: RADII.pill,
    minWidth: 20, height: 20, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  badgeText: { ...TYPE.micro, color: inkOn(colors.primary), fontWeight: '800' },
  directEmpty: {
    marginHorizontal: 16, marginBottom: 8, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  directEmptyText: { ...TYPE.caption, color: colors.textMuted, fontWeight: '600', flex: 1 },
  directEmptyCta: {
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 12,
    borderRadius: RADII.pill, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  directEmptyCtaText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
  communityEmpty: {
    marginHorizontal: 16, marginBottom: 8, paddingVertical: 10,
  },
  directSpinner: { marginVertical: 16 },
});
