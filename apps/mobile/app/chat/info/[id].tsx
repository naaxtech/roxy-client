import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, TextInput, Modal, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useConnectStore } from '../../../store/connectStore';
import { useFriendStore } from '../../../store/friendStore';
import { useSafetyStore } from '../../../store/safetyStore';
import { useThreadMeta } from '../../../hooks/useThreadMeta';
import { useThemeColors } from '../../../hooks/useThemeColors';
import {
  addGroupMembers, removeGroupMember, leaveGroup, renameGroup, setGroupRole, muteConversation,
  memberName, GROUP_MAX_MEMBERS,
} from '../../../lib/chat';
import {
  activeMembers, addableFriends, canChangeRole, canEditGroup, canRemove, isMuted, muteLabel,
  muteUntil, roleLabel, slotsLeft, GROUP_EMOJIS, GROUP_TITLE_MAX, MUTE_CHOICES, type MuteChoice,
} from '../../../lib/groupInfo';
import type { ThreadMember } from '../../../lib/chatThread';
import { routeParam } from '../../../lib/routeParams';
import { haptic } from '../../../lib/haptics';
import { logError } from '../../../lib/errorLogger';
import { confirmAction, showAlert } from '../../../lib/confirm';
import { avatarGradient } from '../../../lib/avatars';
import { TYPE } from '../../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { FeatureGate } from '../../../components/features/FeatureGate';

/**
 * Group info — `/chat/info/<conversationId>`.
 *
 * (Lives under chat/info/ rather than chat/[id]/info because chat/[id].tsx is
 * a file route; expo-router cannot nest a folder under it without moving it.)
 *
 * Who is in the group and what she can do about it: add friends (32 cap, the
 * server checks each person's "allow group adds" and blocks), remove and
 * promote (owner/admin, mirrored from the RPCs so nobody sees a button the
 * server will always refuse), rename + emoji, mute, leave, report. Every
 * action goes through lib/chat, whose refusals are already sentences.
 */
function GroupInfo() {
  const colors = useThemeColors();
  const s = useMemo(() => styles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const conversationId = routeParam(params.id) ?? '';
  const { user } = useAuthStore();
  const me = user?.id ?? '';
  const { meta, loading, unavailable, reload } = useThreadMeta(conversationId, me);
  const { friends, fetchAll } = useFriendStore();
  const refreshInbox = useConnectStore((st) => st.refresh);
  const openReportModal = useSafetyStore((st) => st.openReportModal);

  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (me) void fetchAll(me);
  }, [me]);

  const members = useMemo(() => (meta ? activeMembers(meta) : []), [meta]);
  const free = meta ? slotsLeft(meta) : 0;
  const candidates = useMemo(() => (meta ? addableFriends(friends, meta) : []), [friends, meta]);
  const myRole = meta?.me?.role ?? null;
  const mutedUntil = meta?.me?.muted_until ?? null;
  const muted = isMuted(mutedUntil);

  /** Run one RPC; her words on failure, a reload on success. */
  const run = async (key: string, fn: () => Promise<unknown>, failTitle = "Couldn't save that"): Promise<boolean> => {
    if (busy) return false;
    setBusy(key);
    try {
      await fn();
      void reload();
      return true;
    } catch (e) {
      logError(e, `groupInfo.${key}`);
      const msg = e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
      await showAlert(failTitle, msg);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (loading && !meta) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <Header s={s} colors={colors} onBack={() => router.back()} />
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} accessibilityLabel="Loading group" />
      </SafeAreaView>
    );
  }

  if (!meta || unavailable || meta.type !== 'group' || meta.me?.status !== 'active') {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <Header s={s} colors={colors} onBack={() => router.back()} />
        <View style={s.empty}>
          <Text style={s.emptyIcon}>🫧</Text>
          <Text style={s.emptyText}>This group isn't available. You may have left it, or it's no longer here.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const title = meta.title || members.filter((x) => x.id !== me).slice(0, 3).map(memberName).join(', ') || 'Group chat';

  const startEdit = () => {
    setName(meta.title ?? '');
    setEmoji(meta.emoji);
    setEditing(true);
  };

  const saveEdit = async () => {
    const clean = name.trim().slice(0, GROUP_TITLE_MAX) || null;
    const ok = await run('rename', () => renameGroup(conversationId, clean, emoji));
    if (ok) { haptic('success'); setEditing(false); void refreshInbox(); }
  };

  const onRemove = async (target: ThreadMember) => {
    const who = memberName(target);
    const yes = await confirmAction(
      `Remove ${who}?`,
      `${who} won't see new messages in this group. Everyone in it sees that she was removed.`,
      'Remove',
    );
    if (!yes) return;
    const ok = await run(`remove-${target.id}`, () => removeGroupMember(conversationId, target.id));
    if (ok) haptic('warning');
  };

  const onRole = async (target: ThreadMember) => {
    const next = target.role === 'admin' ? 'member' : 'admin';
    const ok = await run(`role-${target.id}`, () => setGroupRole(conversationId, target.id, next));
    if (ok) haptic('select');
  };

  const onMutePress = async () => {
    if (muted) {
      const ok = await run('mute', () => muteConversation(conversationId, null));
      if (ok) haptic('select');
      return;
    }
    setMuteOpen((v) => !v);
  };

  const onMuteChoice = async (choice: MuteChoice) => {
    const ok = await run('mute', () => muteConversation(conversationId, muteUntil(choice)));
    if (ok) { haptic('select'); setMuteOpen(false); }
  };

  const togglePick = (id: string) => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= free) return prev;
      haptic('select');
      return [...prev, id];
    });
  };

  const confirmAdd = async () => {
    if (picked.length === 0 || busy) return;
    const want = picked.slice();
    let added = 0;
    const ok = await run('add', async () => { added = await addGroupMembers(conversationId, want); }, "Couldn't add them");
    if (!ok) return;
    setAddOpen(false);
    setPicked([]);
    if (added < want.length) {
      await showAlert(
        `Added ${added} of ${want.length}`,
        "Some friends don't take group adds, or can't be added to this group right now.",
      );
    } else {
      haptic('success');
    }
  };

  const onLeave = async () => {
    const yes = await confirmAction(
      'Leave this group?',
      "You won't get its messages any more. Someone in the group can add you back.",
      'Leave',
    );
    if (!yes) return;
    const ok = await run('leave', () => leaveGroup(conversationId), "Couldn't leave the group");
    if (!ok) return;
    void refreshInbox();
    router.replace('/(tabs)/messages' as never);
  };

  const onReport = () => {
    const owner = members.find((x) => x.role === 'owner') ?? members.find((x) => x.id !== me);
    if (!owner) return;
    openReportModal({ userId: owner.id, contentType: 'message', contentId: conversationId });
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Header s={s} colors={colors} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Identity */}
        <View style={s.hero}>
          <LinearGradient colors={avatarGradient(meta.title || 'group')} style={s.heroAva}>
            <Text style={s.heroEmoji}>{(editing ? emoji : meta.emoji) ?? '👯'}</Text>
          </LinearGradient>
          {editing ? (
            <View style={s.editor}>
              <TextInput
                style={s.nameInput}
                value={name}
                onChangeText={setName}
                placeholder="Name the group (optional)"
                placeholderTextColor={colors.textMuted}
                maxLength={GROUP_TITLE_MAX}
                autoFocus
                testID="group-name-input"
                accessibilityLabel="Group name"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.emojis}>
                {GROUP_EMOJIS.map((e) => (
                  <TouchableOpacity
                    key={e}
                    onPress={() => { haptic('select'); setEmoji((cur) => (cur === e ? null : e)); }}
                    style={[s.emojiBtn, emoji === e && s.emojiOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: emoji === e }}
                    accessibilityLabel={`Group emoji ${e}`}
                    testID={`group-emoji-${e}`}
                  >
                    <Text style={s.emojiText}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={s.editorRow}>
                <TouchableOpacity
                  onPress={() => setEditing(false)}
                  style={[s.pill, s.pillGhost]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={s.pillGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void saveEdit()}
                  style={s.pill}
                  disabled={busy === 'rename'}
                  accessibilityRole="button"
                  accessibilityLabel="Save group name"
                  accessibilityState={{ busy: busy === 'rename' }}
                  testID="group-save"
                >
                  {busy === 'rename'
                    ? <ActivityIndicator size="small" color={inkOn(colors.primary)} />
                    : <Text style={s.pillText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <Text style={s.heroTitle} numberOfLines={2}>{title}</Text>
              <Text style={s.heroSub}>{members.length} of {GROUP_MAX_MEMBERS} people</Text>
              {canEditGroup(myRole) ? (
                <TouchableOpacity
                  onPress={startEdit}
                  style={[s.pill, s.pillGhost]}
                  accessibilityRole="button"
                  accessibilityLabel="Edit group name and emoji"
                  testID="group-edit"
                >
                  <Ionicons name="pencil" size={14} color={colors.primaryInk} />
                  <Text style={s.pillGhostText}>Edit name & emoji</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>

        {/* Mute */}
        <View style={s.card}>
          <TouchableOpacity
            style={s.row}
            onPress={() => void onMutePress()}
            accessibilityRole="button"
            accessibilityLabel={muted ? `${muteLabel(mutedUntil)}. Unmute this group` : 'Mute this group'}
            accessibilityState={{ busy: busy === 'mute', expanded: muteOpen }}
            testID="group-mute"
          >
            <Ionicons name={muted ? 'notifications-off' : 'notifications-outline'} size={20} color={colors.textSecondary} />
            <View style={s.rowText}>
              <Text style={s.rowLabel}>{muted ? 'Unmute' : 'Mute'}</Text>
              <Text style={s.rowHint}>{muteLabel(mutedUntil)}</Text>
            </View>
            {busy === 'mute' ? <ActivityIndicator size="small" color={colors.roxy} /> : null}
          </TouchableOpacity>
          {muteOpen && !muted ? MUTE_CHOICES.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[s.row, s.subRow]}
              onPress={() => void onMuteChoice(c.key)}
              accessibilityRole="button"
              accessibilityLabel={`Mute ${c.label.toLowerCase()}`}
              testID={`mute-${c.key}`}
            >
              <Text style={s.subRowText}>{c.label}</Text>
            </TouchableOpacity>
          )) : null}
        </View>

        {/* Members */}
        <Text style={s.sectionLabel}>People</Text>
        <View style={s.card}>
          {free > 0 ? (
            <TouchableOpacity
              style={s.row}
              onPress={() => { setPicked([]); setAddOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel="Add people"
              testID="group-add"
            >
              <View style={[s.ava, s.addAva]}>
                <Ionicons name="person-add" size={18} color={colors.primaryInk} />
              </View>
              <Text style={[s.rowLabel, { color: colors.primaryInk }]}>Add people</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.row}>
              <Text style={s.rowHint}>This group is full — {GROUP_MAX_MEMBERS} people is the most a group can hold.</Text>
            </View>
          )}
          {members.map((x) => {
            const isMe = x.id === me;
            const who = memberName(x);
            const badge = roleLabel(x.role);
            return (
              <View key={x.id} style={s.memberRow} testID={`member-${x.id}`}>
                <TouchableOpacity
                  style={s.memberMain}
                  onPress={() => { if (!isMe) router.push(`/user/${x.id}` as never); }}
                  disabled={isMe}
                  accessibilityRole={isMe ? 'text' : 'button'}
                  accessibilityLabel={`${isMe ? 'You' : who}${badge ? `, ${badge.toLowerCase()}` : ''}`}
                >
                  <LinearGradient colors={avatarGradient(who)} style={s.ava}>
                    <Text style={s.avaText}>{who[0]?.toUpperCase() ?? '?'}</Text>
                  </LinearGradient>
                  <View style={s.rowText}>
                    <Text style={s.rowLabel} numberOfLines={1}>{isMe ? `${who} (you)` : who}</Text>
                    {x.username ? <Text style={s.rowHint} numberOfLines={1}>@{x.username}</Text> : null}
                  </View>
                  {badge ? <Text style={s.badge}>{badge}</Text> : null}
                </TouchableOpacity>
                {!isMe && canChangeRole(myRole, x) ? (
                  <TouchableOpacity
                    style={s.iconBtn}
                    onPress={() => void onRole(x)}
                    disabled={!!busy}
                    accessibilityRole="button"
                    accessibilityLabel={x.role === 'admin' ? `Remove ${who} as admin` : `Make ${who} an admin`}
                    testID={`role-${x.id}`}
                  >
                    <Ionicons name={x.role === 'admin' ? 'shield' : 'shield-outline'} size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
                {!isMe && canRemove(myRole, x) ? (
                  <TouchableOpacity
                    style={s.iconBtn}
                    onPress={() => void onRemove(x)}
                    disabled={!!busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${who} from the group`}
                    testID={`remove-${x.id}`}
                  >
                    <Ionicons name="person-remove-outline" size={18} color={colors.error} />
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>

        {/* Safety + leave */}
        <View style={s.card}>
          <TouchableOpacity
            style={s.row}
            onPress={onReport}
            accessibilityRole="button"
            accessibilityLabel="Report this group"
            testID="group-report"
          >
            <Ionicons name="flag-outline" size={20} color={colors.textSecondary} />
            <Text style={s.rowLabel}>Report group</Text>
          </TouchableOpacity>
          <View style={s.divider} />
          <TouchableOpacity
            style={s.row}
            onPress={() => void onLeave()}
            disabled={busy === 'leave'}
            accessibilityRole="button"
            accessibilityLabel="Leave group"
            testID="group-leave"
          >
            <Ionicons name="exit-outline" size={20} color={colors.error} />
            <Text style={[s.rowLabel, { color: colors.error }]}>Leave group</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.footnote}>
          New people don't see messages from before they joined. Only friends who allow group adds can be added.
        </Text>
      </ScrollView>

      <Modal visible={addOpen} animationType="slide" transparent onRequestClose={() => setAddOpen(false)}>
        <View style={s.sheetBackdrop}>
          <View style={s.sheet} testID="add-sheet">
            <View style={s.sheetHeader}>
              <TouchableOpacity onPress={() => setAddOpen(false)} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={s.sheetTitle}>Add people</Text>
              <TouchableOpacity
                onPress={() => void confirmAdd()}
                disabled={picked.length === 0 || busy === 'add'}
                style={[s.pill, picked.length === 0 && s.pillOff]}
                accessibilityRole="button"
                accessibilityLabel={`Add ${picked.length}`}
                accessibilityState={{ disabled: picked.length === 0, busy: busy === 'add' }}
                testID="add-confirm"
              >
                {busy === 'add'
                  ? <ActivityIndicator size="small" color={inkOn(colors.primary)} />
                  : <Text style={[s.pillText, picked.length === 0 && s.pillOffText]}>Add{picked.length ? ` ${picked.length}` : ''}</Text>}
              </TouchableOpacity>
            </View>
            <Text style={s.sheetHint}>
              {picked.length >= free
                ? `That fills the group (${GROUP_MAX_MEMBERS} max).`
                : `${free - picked.length} ${free - picked.length === 1 ? 'seat' : 'seats'} left`}
            </Text>
            <FlatList
              data={candidates}
              keyExtractor={(p) => p.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyText}>Every friend you have is already here 💜</Text>
                </View>
              }
              renderItem={({ item }) => {
                const on = picked.includes(item.id);
                const full = !on && picked.length >= free;
                const who = item.display_name || item.username || 'Friend';
                return (
                  <TouchableOpacity
                    style={[s.row, full && { opacity: 0.45 }]}
                    onPress={() => togglePick(item.id)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={who}
                    accessibilityState={{ checked: on, disabled: full }}
                    testID={`add-${item.id}`}
                  >
                    <LinearGradient colors={avatarGradient(who)} style={s.ava}>
                      <Text style={s.avaText}>{who[0]?.toUpperCase() ?? '?'}</Text>
                    </LinearGradient>
                    <View style={s.rowText}>
                      <Text style={s.rowLabel}>{who}</Text>
                      {item.username ? <Text style={s.rowHint}>@{item.username}</Text> : null}
                    </View>
                    <View style={[s.check, on && s.checkOn]}>
                      {on ? <Ionicons name="checkmark" size={15} color={inkOn(colors.primary)} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ s, colors, onBack }: { s: ReturnType<typeof styles>; colors: ThemeColors; onBack: () => void }) {
  return (
    <View style={s.header}>
      <TouchableOpacity onPress={onBack} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>Group info</Text>
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headerTitle: { ...TYPE.title, color: colors.textPrimary, fontWeight: '700' },
  scroll: { padding: 14, gap: 12, paddingBottom: 48 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  heroAva: { width: 84, height: 84, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 40 },
  heroTitle: { ...TYPE.headline, color: colors.textPrimary, textAlign: 'center' },
  heroSub: { ...TYPE.caption, color: colors.textMuted },
  editor: { alignSelf: 'stretch', gap: 10 },
  editorRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  nameInput: {
    ...TYPE.bodyLg, color: colors.textPrimary, textAlign: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  emojis: { gap: 6, paddingHorizontal: 2 },
  emojiBtn: {
    width: 40, height: 40, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceLight,
  },
  emojiOn: { borderWidth: 2, borderColor: colors.primary },
  emojiText: { fontSize: 19 },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 36, paddingHorizontal: 16, borderRadius: RADII.pill, backgroundColor: colors.primary,
  },
  pillText: { ...TYPE.caption, color: inkOn(colors.primary), fontWeight: '800' },
  pillGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  pillGhostText: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '700' },
  pillOff: { backgroundColor: colors.surfaceLight },
  pillOffText: { color: colors.textMuted },
  sectionLabel: {
    ...TYPE.micro, color: colors.textMuted, fontWeight: '800', letterSpacing: 1.4,
    textTransform: 'uppercase', paddingLeft: 2, marginBottom: -4,
  },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: RADII.md, overflow: 'hidden',
  },
  row: {
    minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 13, paddingVertical: 8,
  },
  subRow: { paddingLeft: 45, borderTopWidth: 1, borderTopColor: colors.line },
  subRowText: { ...TYPE.body, color: colors.textPrimary },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
  rowHint: { ...TYPE.caption, color: colors.textMuted, marginTop: 1 },
  divider: { height: 1, backgroundColor: colors.line },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 4 },
  memberMain: {
    flex: 1, minHeight: MIN_TOUCH_TARGET + 8, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 13, paddingVertical: 6,
  },
  ava: { width: 40, height: 40, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
  addAva: { backgroundColor: colors.surfaceLight },
  avaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  badge: {
    ...TYPE.micro, color: colors.primaryInk, fontWeight: '800',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADII.pill,
    borderWidth: 1, borderColor: colors.line, overflow: 'hidden',
  },
  iconBtn: {
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
  },
  footnote: { ...TYPE.micro, color: colors.textMuted, lineHeight: 15, paddingHorizontal: 4 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { ...TYPE.body, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '85%', minHeight: '50%', backgroundColor: colors.background,
    borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet, paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  sheetTitle: { ...TYPE.title, color: colors.textPrimary, fontWeight: '700', flex: 1 },
  sheetHint: { ...TYPE.caption, color: colors.textMuted, paddingHorizontal: 16, paddingVertical: 8 },
  check: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.lineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});

export default function GroupInfoRoute() {
  return (
    <FeatureGate feature="dms">
      <GroupInfo />
    </FeatureGate>
  );
}
