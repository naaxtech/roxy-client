import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { Snackbar } from '../ui/Snackbar';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFriendStore, type FriendshipRow } from '../../store/friendStore';
import { useConnectStore } from '../../store/connectStore';
import { useSafetyStore } from '../../store/safetyStore';
import { useAuthStore } from '../../store/authStore';
import { useCommunityStore } from '../../store/communityStore';
import { respondMessageRequest, memberName, type InboxThread } from '../../lib/chat';
import {
  fetchMyCommunityInvites, respondCommunityInvite, type CommunityInvite,
} from '../../lib/communityMembership';
import { previewLine } from '../../lib/inboxRows';
import { haptic } from '../../lib/haptics';
import { confirmAction } from '../../lib/confirm';
import { logError } from '../../lib/errorLogger';
import { avatarGradient } from '../../lib/avatars';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { Sheet } from '../feedback';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Open a conversation once its request is accepted. */
  onOpenChat?: (conversationId: string) => void;
}

type Segment = 'messages' | 'friends';

/**
 * Requests, answered one at a time: message requests and friend requests.
 *
 * Roxy is request-first (CHAT-02): a woman she is not friends with can send up
 * to three text-only messages, and they wait HERE — not in the main list, no
 * push with words in it. This is a separate surface on purpose: reading a
 * request is a decision, not an ambush.
 *
 * Declining is quiet in both segments. A declined message request is hidden
 * from her and the sender is never told; a declined friend request deletes the
 * row. The copy says so, because a woman deciding whether to decline needs to
 * know it will not start a conversation.
 */
export function RequestsSheet({ visible, onClose, onOpenChat }: Props) {
  const colors = useThemeColors();
  // Built once per theme, not on every render (jank audit #8).
  const s = useMemo(() => styles(colors), [colors]);

  const pendingReceived = useFriendStore((st) => st.pendingReceived);
  const acceptRequest = useFriendStore((st) => st.acceptRequest);
  const rejectRequest = useFriendStore((st) => st.rejectRequest);
  const requests = useConnectStore((st) => st.requests);
  const refresh = useConnectStore((st) => st.refresh);
  const blockUser = useSafetyStore((st) => st.blockUser);
  const openReportModal = useSafetyStore((st) => st.openReportModal);
  const userId = useAuthStore((st) => st.user?.id ?? null);
  const fetchJoined = useCommunityStore((st) => st.fetchJoined);

  // CHAT-09: invites to private communities wait here with friend requests.
  const [invites, setInvites] = useState<CommunityInvite[]>([]);
  useEffect(() => {
    if (!visible || !userId) return undefined;
    let cancelled = false;
    fetchMyCommunityInvites(userId)
      .then((rows) => { if (!cancelled) setInvites(rows); })
      .catch((e) => logError(e, 'RequestsSheet.invites'));
    return () => { cancelled = true; };
  }, [visible, userId]);
  const friendCount = pendingReceived.length + invites.length;

  const [segment, setSegment] = useState<Segment>(
    requests.length === 0 && pendingReceived.length > 0 ? 'friends' : 'messages',
  );
  // An invite that arrives after open moves an empty Messages tab to Friends.
  useEffect(() => {
    if (requests.length === 0 && invites.length > 0) setSegment('friends');
  }, [requests.length, invites.length]);
  // F10: an answered card leaves in the same frame as the tap (no spinner in
  // its place). `answering` hides it while the write is in flight; a refusal
  // un-hides it and says so in a snackbar with Retry.
  const [answering, setAnswering] = useState<ReadonlySet<string>>(() => new Set());
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null);
  const hide = (key: string) => setAnswering((prev) => new Set(prev).add(key));
  const unhide = (key: string) => setAnswering((prev) => {
    const next = new Set(prev);
    next.delete(key);
    return next;
  });

  const answerInvite = async (inv: CommunityInvite, accept: boolean) => {
    const key = `invite-${inv.community_id}`;
    hide(key);
    setFailure(null);
    try {
      await respondCommunityInvite(inv.community_id, accept);
      setInvites((prev) => prev.filter((x) => x.community_id !== inv.community_id));
      // No haptic: answering a request is not on the haptic map (motion spec §3.3).
      if (accept && userId) await fetchJoined(userId);
    } catch (e) {
      setFailure({
        message: e instanceof Error && e.message ? e.message : 'Could not answer that just now.',
        retry: () => { void answerInvite(inv, accept); },
      });
      logError(e, 'RequestsSheet.answerInvite');
    } finally {
      unhide(key);
    }
  };

  const actFriend = async (row: FriendshipRow, accept: boolean) => {
    setFailure(null);
    try {
      // Both store actions are optimistic: the row leaves at once, comes back
      // and throws on a refused write, refetch on success. A failure is never
      // announced as a success.
      if (accept) await acceptRequest(row.id);
      else await rejectRequest(row.id);
      void refresh();
    } catch (e) {
      setFailure({
        message: accept ? 'Could not accept that just now.' : 'Could not decline that just now.',
        retry: () => { void actFriend(row, accept); },
      });
      logError(e, 'RequestsSheet.actFriend');
    }
  };

  const answerMessage = async (t: InboxThread, accept: boolean, alsoBlock = false) => {
    hide(t.conversation_id);
    setFailure(null);
    try {
      await respondMessageRequest(t.conversation_id, accept);
      const sender = t.members[0]?.id;
      if (alsoBlock && sender) await blockUser(sender);
      await refresh();
      if (accept) {
        onClose();
        onOpenChat?.(t.conversation_id);
      }
    } catch (e) {
      // The RPC's message is already written for her (chatErrorMessage).
      setFailure({
        message: e instanceof Error && e.message ? e.message : 'Could not answer that just now.',
        retry: () => { void answerMessage(t, accept, alsoBlock); },
      });
      logError(e, 'RequestsSheet.answerMessage');
    } finally {
      // After refresh() the answered thread is gone from `requests` anyway.
      unhide(t.conversation_id);
    }
  };

  const confirmBlock = async (t: InboxThread) => {
    const name = t.members[0] ? memberName(t.members[0]) : 'her';
    const ok = await confirmAction(
      `Block ${name}?`,
      "She won't be able to message you or see you in Roxy. She isn't told.",
      'Block',
    );
    if (ok) await answerMessage(t, false, true);
  };

  const report = (t: InboxThread) => {
    const sender = t.members[0]?.id;
    if (!sender) return;
    // One report sheet. Reports take a message id; the latest message pins
    // the conversation for the moderator.
    openReportModal({
      userId: sender,
      contentType: 'message',
      contentId: t.last_message?.id,
    });
  };

  const tab = (key: Segment, label: string, count: number) => (
    <TouchableOpacity
      key={key}
      onPress={() => { setSegment(key); haptic('select'); }}
      accessibilityRole="tab"
      accessibilityState={{ selected: segment === key }}
      accessibilityLabel={`${label}${count ? `, ${count} waiting` : ''}`}
      activeOpacity={0.85}
      style={[s.tab, segment === key && s.tabOn]}
      testID={`requests-tab-${key}`}
    >
      <Text style={[s.tabText, segment === key && s.tabTextOn]}>{label}</Text>
      {count > 0 ? (
        <View style={[s.tabCount, segment === key && s.tabCountOn]}>
          <Text style={[s.tabCountText, segment === key && s.tabCountTextOn]}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  const avatar = (name: string) => {
    const grad = avatarGradient(name);
    return (
      <View style={[s.avatar, { backgroundColor: grad[0] }]}>
        <Text style={[s.initial, { color: inkOn(grad[0]) }]}>{name[0]?.toUpperCase() ?? '?'}</Text>
      </View>
    );
  };

  const shownRequests = requests.filter((t) => !answering.has(t.conversation_id));
  const shownInvites = invites.filter((inv) => !answering.has(`invite-${inv.community_id}`));

  const messageList = shownRequests.length === 0 ? (
    <View style={s.empty} testID="requests-empty">
      <Text style={s.emptyTitle}>No message requests</Text>
      <Text style={s.emptyBody}>
        When someone who isn&apos;t your friend messages you, it waits here until you decide.
      </Text>
    </View>
  ) : (
    <ScrollView style={s.list} contentContainerStyle={s.listContent}>
      {shownRequests.map((t) => {
        const who = t.members[0];
        const name = who ? memberName(who) : 'Someone';
        return (
          <View key={t.conversation_id} style={s.card} testID={`message-request-${t.conversation_id}`}>
            <View style={s.cardHead}>
              {avatar(name)}
              <View style={s.rowText}>
                <Text style={s.name} numberOfLines={1}>{name}</Text>
                {who?.username ? <Text style={s.handle} numberOfLines={1}>@{who.username}</Text> : null}
              </View>
              <TouchableOpacity
                onPress={() => report(t)}
                accessibilityRole="button"
                accessibilityLabel={`Report ${name}`}
                style={s.iconBtn}
                testID={`message-request-report-${t.conversation_id}`}
              >
                <Ionicons name="flag-outline" size={17} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={s.previewBubble}>
              <Text style={s.previewText} numberOfLines={4}>{previewLine(t, '')}</Text>
            </View>
            <Text style={s.note}>
              Not on your friends list. She can&apos;t see if you&apos;ve read this, and she won&apos;t know if you delete it.
            </Text>
            <View style={s.actions}>
              <TouchableOpacity
                onPress={() => void confirmBlock(t)}
                accessibilityRole="button"
                accessibilityLabel={`Block ${name}`}
                activeOpacity={0.8}
                style={s.ghost}
                testID={`message-request-block-${t.conversation_id}`}
              >
                <Text style={s.blockText}>Block</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void answerMessage(t, false)}
                accessibilityRole="button"
                accessibilityLabel={`Delete the request from ${name}. She will not be told.`}
                activeOpacity={0.8}
                style={s.ghost}
                testID={`message-request-delete-${t.conversation_id}`}
              >
                <Text style={s.ghostText}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void answerMessage(t, true)}
                accessibilityRole="button"
                accessibilityLabel={`Accept the request from ${name}`}
                activeOpacity={0.8}
                style={s.accept}
                testID={`message-request-accept-${t.conversation_id}`}
              >
                <Text style={s.acceptText}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );

  const inviteRows = shownInvites.map((inv) => {
    const name = inv.community?.name ?? 'A private community';
    return (
      <View key={`inv-${inv.community_id}`} style={s.row} testID={`community-invite-${inv.community_id}`}>
        {avatar(name)}
        <View style={s.rowText}>
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          <Text style={s.handle} numberOfLines={1}>Invited you to join</Text>
        </View>
        <View style={s.actions}>
          <TouchableOpacity
            onPress={() => void answerInvite(inv, false)}
            accessibilityRole="button"
            accessibilityLabel={`Not now for ${name}. Nobody is told.`}
            activeOpacity={0.8}
            style={s.ghost}
          >
            <Text style={s.ghostText}>Not now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void answerInvite(inv, true)}
            accessibilityRole="button"
            accessibilityLabel={`Join ${name}`}
            activeOpacity={0.8}
            style={s.accept}
          >
            <Text style={s.acceptText}>Join</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  });

  const friendList = pendingReceived.length + shownInvites.length === 0 ? (
    <View style={s.empty} testID="requests-friends-empty">
      <Text style={s.emptyTitle}>No friend requests</Text>
      <Text style={s.emptyBody}>When someone asks to be friends, she waits here until you decide.</Text>
    </View>
  ) : (
    <ScrollView style={s.list} contentContainerStyle={s.listContent}>
      {inviteRows}
      {pendingReceived.map((row) => {
        return (
          <View key={row.id} style={s.row} testID={`request-${row.id}`}>
            {avatar(row.profile.display_name ?? '?')}
            <View style={s.rowText}>
              <Text style={s.name} numberOfLines={1}>{row.profile.display_name}</Text>
              <Text style={s.handle} numberOfLines={1}>@{row.profile.username}</Text>
            </View>
            <View style={s.actions}>
              <TouchableOpacity
                onPress={() => void actFriend(row, false)}
                accessibilityRole="button"
                accessibilityLabel={`Decline ${row.profile.display_name}. She will not be told.`}
                activeOpacity={0.8}
                style={s.ghost}
                testID={`request-decline-${row.id}`}
              >
                <Text style={s.ghostText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void actFriend(row, true)}
                accessibilityRole="button"
                accessibilityLabel={`Accept ${row.profile.display_name}`}
                activeOpacity={0.8}
                style={s.accept}
                testID={`request-accept-${row.id}`}
              >
                <Text style={s.acceptText}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );

  return (
    // F5: the shared Sheet (spring rise, UI-thread drag with projected
    // release, only the scrim fades; Reduce Motion: simply there).
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Requests" testID="requests-sheet" style={s.sheet}>
        <View style={s.head}>
          <View style={s.headText}>
            <Text style={s.title}>Requests</Text>
            <Text style={s.sub}>Declining is quiet — she is never told.</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            activeOpacity={0.75}
            style={s.close}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={s.tabs} accessibilityRole="tablist">
          {tab('messages', 'Messages', shownRequests.length)}
          {tab('friends', 'Friends', friendCount)}
        </View>

        {segment === 'messages' ? messageList : friendList}

        <Snackbar
          visible={failure !== null}
          message={failure?.message ?? ''}
          actionLabel="Retry"
          onAction={() => failure?.retry()}
          onDismiss={() => setFailure(null)}
          testID="requests-snackbar"
        />
    </Sheet>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  sheet: { paddingHorizontal: 18, paddingBottom: 16, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headText: { flex: 1, gap: 2 },
  title: { ...TYPE.headline, color: colors.textPrimary },
  sub: { ...TYPE.caption, color: colors.textSecondary },
  close: {
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill, backgroundColor: colors.surfaceLight,
    alignItems: 'center', justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row', gap: 4, padding: 4,
    borderRadius: RADII.pill, backgroundColor: colors.surfaceLight,
  },
  tab: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET - 8, borderRadius: RADII.pill,
  },
  tabOn: { backgroundColor: colors.primary },
  tabText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
  tabTextOn: { color: inkOn(colors.primary) },
  tabCount: {
    minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: RADII.pill,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  tabCountOn: { backgroundColor: inkOn(colors.primary) },
  tabCountText: { ...TYPE.micro, color: inkOn(colors.primary), fontWeight: '800' },
  tabCountTextOn: { color: colors.primary },
  empty: { paddingVertical: 26, gap: 6 },
  emptyTitle: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  emptyBody: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 18 },
  list: { maxHeight: 440 },
  listContent: { gap: 10, paddingBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: MIN_TOUCH_TARGET + 12, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: RADII.md, backgroundColor: colors.surfaceLight,
  },
  card: {
    gap: 10, padding: 12, borderRadius: RADII.lg,
    backgroundColor: colors.surfaceLight, borderWidth: 1, borderColor: colors.line,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewBubble: {
    alignSelf: 'flex-start', maxWidth: '92%',
    paddingHorizontal: 13, paddingVertical: 9,
    borderRadius: 18, borderBottomLeftRadius: 6,
    backgroundColor: colors.surface,
  },
  previewText: { ...TYPE.body, color: colors.textPrimary },
  note: { ...TYPE.micro, color: colors.textMuted, lineHeight: 16 },
  avatar: { width: 40, height: 40, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
  initial: { ...TYPE.bodyLg, fontWeight: '800' },
  rowText: { flex: 1, gap: 1 },
  name: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  handle: { ...TYPE.micro, color: colors.textSecondary },
  iconBtn: {
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  ghost: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 12,
    borderRadius: RADII.pill, borderWidth: 1, borderColor: colors.line,
  },
  ghostText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
  blockText: { ...TYPE.caption, color: colors.errorInk, fontWeight: '700' },
  accept: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 16,
    borderRadius: RADII.pill, backgroundColor: colors.primary,
  },
  acceptText: { ...TYPE.caption, color: inkOn(colors.primary), fontWeight: '800' },
});
