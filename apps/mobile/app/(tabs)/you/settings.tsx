import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MiniWinsSheet } from '../../../components/feed/MiniWinsSheet';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { resetAllStores } from '../../../store/resetAllStores';
import { useProfileStore } from '../../../store/profileStore';
import { supabase } from '../../../lib/supabase';
import { exportUserData, describeExportResult } from '../../../lib/dataExport';
import { confirmAction, showAlert } from '../../../lib/confirm';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { a11yState } from '../../../lib/a11yState';
import { ViewAsPicker } from '../../../components/settings/ViewAsPicker';
import { useSafetyStore } from '../../../store/safetyStore';
import {
  readDmPermission, nextDmPermission, dmPermissionLabel,
} from '../../../lib/dmPermission';
import { useAccess } from '../../../hooks/useAccess';
// useViewAsStore: sign-out now resets it through resetAllStores (ARC-08).
// import { useViewAsStore } from '../../../store/viewAsStore';
import { TYPE, emphasized } from '../../../lib/typography';
import { MARGIN, RADII, SPACE, type ThemeColors } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { unregisterDevice } from '../../../lib/pushRegistration';
import { useChatSettingsStore } from '../../../store/chatSettingsStore';
import { useThemeStore, type ThemeChoice } from '../../../store/themeStore';
import { useRoxyChatStore } from '../../../store/roxyChatStore';
import { logError } from '../../../lib/errorLogger';
import { haptic } from '../../../lib/haptics';
import { useRoxyFab, onListScroll, onListContentSizeChange, LIST_SCROLL_THROTTLE, ROXY_OFF_COPY } from '../../../lib/roxyFab';
import { FAB_LANE } from '../../../components/nav/navTokens';
import { TouchableOpacity } from '../../../components/ui/PressableScale';
import { Switch } from '../../../components/ui/Switch';
import { Snackbar } from '../../../components/ui/Snackbar';
import { RoxyO } from '../../../components/roxy/RoxyO';
import { clearRoxyChat } from '../../../components/roxy/roxyConversation';
import { Skeleton, SkeletonGroup } from '../../../components/feedback';
import { BusySwap } from '../../../components/messages/LoadingShapes';

/** Her O on the Roxy AI row (board v2-07). */
const ROW_O = 44;
/** Row icons: 24 dp outlines in `ink2` (design direction v2 › Bans: no tinted tiles). */
const ICON = 24;
/** The gap between a connected button group's segments (M3 connected button group: 2 dp). */
const GROUP_GAP = 2;

type IconName = keyof typeof Ionicons.glyphMap;

const THEME_CHOICES: { key: ThemeChoice; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'Match phone' },
];

/**
 * Settings (design direction v2 › Settings, board v2-07).
 *
 * First group, the choices people come for: **Roxy AI** (her O, what she is,
 * the M3 switch — off: the button leaves Feed, Discover and You at once, a
 * snackbar says so with Undo for 6 seconds, no confirm, no guilt; the row
 * then reads "Off. Turn her on any time." and her chat stays reachable) and
 * **Theme** as a connected Light · Dark · Match phone button group.
 *
 * Every other row Settings had stays (privacy and safety, chats, the streak,
 * support, account, sign out), restyled: sentence-case section labels, 24 dp
 * outline icons, M3 switches. Not here on purpose: Language (no translations
 * ship yet — M174 is held, and a picker with one language is a dead control),
 * Discreet mode and Roxy Premium (held for Nicole, M175/M176).
 *
 * Dating / Ghost stay behind beta (or a core preview of staff). The HQ
 * preview picker is extra chrome that only core sees.
 */
export default function SettingsScreen() {
  // Selectors, never whole stores (jank audit #9): only the id and email
  // are read, so a token refresh no longer re-renders Settings.
  const userId = useAuthStore((st) => st.user?.id ?? null);
  const userEmail = useAuthStore((st) => st.user?.email ?? null);
  const user = useMemo(() => (userId ? { id: userId, email: userEmail } : null), [userId, userEmail]);
  const profile = useProfileStore((st) => st.profile);
  const updateProfile = useProfileStore((st) => st.updateProfile);
  const { isBeta, isCore } = useAccess();
  const router = useRouter();
  const colors = useThemeColors();
  const [miniWinsOpen, setMiniWinsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [roxyOffSnack, setRoxyOffSnack] = useState(false);
  const blockedCount = useSafetyStore((s) => s.blockedUserIds.length);
  const chatSettings = useChatSettingsStore((s) => s.settings);
  const loadChatSettings = useChatSettingsStore((s) => s.load);
  const setReadReceipts = useChatSettingsStore((s) => s.setReadReceipts);
  const setGroupAddPermission = useChatSettingsStore((s) => s.setGroupAddPermission);
  const roxyOn = useRoxyFab((s) => s.enabled);
  const roxyChatCount = useRoxyChatStore((s) => s.messages.length);
  const themeChoice = useThemeStore((s) => s.choice);
  const setTheme = useThemeStore((s) => s.setTheme);
  // Built once per theme, not on every render (jank audit #8).
  const s = useMemo(() => styles(colors), [colors]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user?.id) void loadChatSettings(); }, [user?.id]);

  if (!user || !profile) {
    return (
      <SafeAreaView style={s.container}>
        {/* F8: settings rows at their final height; F11: no spinner. */}
        <SkeletonGroup testID="settings-loading" accessibilityLabel="Loading settings" style={s.skeleton}>
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={52} radius={12} style={s.skeletonRow} />)}
        </SkeletonGroup>
      </SafeAreaView>
    );
  }

  const dmPermission = readDmPermission(profile as { dm_permission?: unknown });

  const setRoxy = (on: boolean) => {
    void useRoxyFab.getState().setEnabled(user.id, on);
    setRoxyOffSnack(!on);
  };

  const pickTheme = (choice: ThemeChoice) => {
    if (choice === themeChoice) return;
    haptic('select');
    void setTheme(choice).catch((e: unknown) => logError(e, 'Settings.setTheme'));
  };

  const deleteRoxyChat = async () => {
    const ok = await confirmAction(
      'Delete your Roxy AI chat?',
      'Your messages with Roxy AI leave this phone. This cannot be undone.',
      'Delete',
    );
    if (ok) clearRoxyChat();
  };

  const handleSignOut = async () => {
    const confirmed = await confirmAction('Sign out', 'Are you sure you want to sign out?', 'Sign out');
    if (!confirmed) return;
    await unregisterDevice();
    await supabase.auth.signOut();
    // Every per-user store, not just auth/profile/view-as: the next account on
    // this phone must not inherit her Archive, likes, follows or blocks (ARC-08).
    resetAllStores();
    router.replace('/(auth)/code');
  };

  const handleExportData = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    const outcome = await exportUserData();
    setExporting(false);
    const { title, body } = describeExportResult(outcome);
    if (outcome.status === 'error') setExportError(body);
    showAlert(title, body);
  };

  const Icon = ({ name, color }: { name: IconName; color?: string }) => (
    <Ionicons name={name} size={ICON} color={color ?? colors.ink2} />
  );
  const Chevron = () => <Ionicons name="chevron-forward" size={20} color={colors.ink3} />;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle} accessibilityRole="header">Settings</Text>
      </View>

      <ScrollView
        testID="settings-scroll"
        contentContainerStyle={s.scroll}
        onScroll={onListScroll}
        // Rows that grow after she came out at the end re-judge her lane.
        onContentSizeChange={onListContentSizeChange}
        scrollEventThrottle={LIST_SCROLL_THROTTLE}
      >
        {/* The first group: Roxy AI and Theme. */}
        <View style={s.card}>
          <View style={s.row}>
            <RoxyO
              size={ROW_O}
              mood={roxyOn ? 'open' : 'rest'}
              ring={roxyOn ? colors.pink : colors.control}
              testID="settings-roxy-ai-o"
            />
            <View style={s.rowLabelGroup}>
              <Text style={s.rowLabel}>Roxy AI</Text>
              <Text style={s.rowHint}>
                {roxyOn ? 'Your companion, one tap away on Feed, Discover and You' : 'Off. Turn her on any time.'}
              </Text>
            </View>
            <Switch
              testID="settings-roxy-ai"
              value={roxyOn}
              onValueChange={setRoxy}
              accessibilityLabel="Roxy AI"
              accessibilityHint="Shows or hides the round Roxy AI button"
            />
          </View>
          {!roxyOn ? (
            <>
              <View style={s.divider} />
              <TouchableOpacity
                style={s.row}
                onPress={() => router.push('/roxy-chat' as never)}
                accessibilityRole="button"
                accessibilityLabel="Your chat with Roxy AI"
                testID="settings-roxy-chat"
              >
                <Icon name="chatbubble-outline" />
                <View style={s.rowLabelGroup}>
                  <Text style={s.rowLabel}>Your chat with Roxy AI</Text>
                  <Text style={s.rowHint}>Only you can see it. It clears when you close Roxy or sign out.</Text>
                </View>
                <Chevron />
              </TouchableOpacity>
              {roxyChatCount > 0 ? (
                <>
                  <View style={s.divider} />
                  <TouchableOpacity
                    style={s.row}
                    onPress={() => void deleteRoxyChat()}
                    accessibilityRole="button"
                    accessibilityLabel="Delete my Roxy AI chat"
                    testID="settings-roxy-chat-delete"
                  >
                    <View style={s.iconRoom} />
                    <Text style={s.danger}>Delete my Roxy AI chat</Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </>
          ) : null}
          <View style={s.divider} />
          <View style={s.themeBlock}>
            <View style={s.themeHead}>
              <Icon name="sunny-outline" />
              <Text style={s.rowLabel}>Theme</Text>
            </View>
            <View style={s.group} accessibilityRole="radiogroup" accessibilityLabel="Theme" testID="theme-toggle">
              {THEME_CHOICES.map((c, i) => {
                const on = themeChoice === c.key;
                const first = i === 0;
                const last = i === THEME_CHOICES.length - 1;
                return (
                  <TouchableOpacity
                    key={c.key}
                    testID={`theme-${c.key}`}
                    onPress={() => pickTheme(c.key)}
                    accessibilityRole="radio"
                    accessibilityLabel={c.label}
                    {...a11yState({ selected: on, checked: on })}
                    style={[
                      s.segment,
                      on
                        ? { backgroundColor: colors.pink, borderRadius: RADII.pill }
                        : {
                            backgroundColor: colors.raised,
                            borderTopStartRadius: first ? RADII.pill : RADII.sm,
                            borderBottomStartRadius: first ? RADII.pill : RADII.sm,
                            borderTopEndRadius: last ? RADII.pill : RADII.sm,
                            borderBottomEndRadius: last ? RADII.pill : RADII.sm,
                          },
                    ]}
                  >
                    {on ? <Ionicons name="checkmark" size={18} color={colors.onPink} /> : null}
                    <Text
                      numberOfLines={1}
                      style={[on ? s.segmentLabelOn : s.segmentLabel, { color: on ? colors.onPink : colors.ink }]}
                    >
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Privacy and safety</Text>
          <View style={s.card}>
            <TouchableOpacity
              style={s.row}
              onPress={async () => {
                const next = nextDmPermission(dmPermission);
                try {
                  await updateProfile({ dm_permission: next } as never);
                } catch {
                  showAlert(
                    'Not saved',
                    'Could not save who can message you. Your setting is unchanged.',
                  );
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={`Who can message me: ${dmPermissionLabel(dmPermission)}. Change.`}
              testID="settings-dm-permission"
            >
              <Icon name="chatbubble-ellipses-outline" />
              <View style={s.rowLabelGroup}>
                <Text style={s.rowLabel}>Who can message me</Text>
                <Text style={s.rowHint}>Everyone else lands in Requests</Text>
              </View>
              <Text style={s.rowAccent}>{dmPermissionLabel(dmPermission)}</Text>
              <Chevron />
            </TouchableOpacity>
            <View style={s.divider} />
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push('/(tabs)/you/notification-settings' as never)}
              accessibilityRole="button"
              accessibilityLabel="Notification settings"
              testID="settings-notifications"
            >
              <Icon name="notifications-outline" />
              <View style={s.rowLabelGroup}>
                <Text style={s.rowLabel}>Notification settings</Text>
                <Text style={s.rowHint}>Messages, friends, events, previews, quiet hours</Text>
              </View>
              <Chevron />
            </TouchableOpacity>
            <View style={s.divider} />
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push('/(tabs)/you/blocked' as never)}
              accessibilityRole="button"
              accessibilityLabel={`Blocked, ${blockedCount} ${blockedCount === 1 ? 'person' : 'people'}`}
              testID="settings-blocked"
            >
              <Icon name="hand-left-outline" />
              <Text style={[s.rowLabel, s.grow]}>Blocked & muted</Text>
              <Text style={s.rowValue}>{blockedCount}</Text>
              <Chevron />
            </TouchableOpacity>
            {isBeta ? (
              <>
                <View style={s.divider} />
                <View style={s.row}>
                  <Icon name="heart-outline" />
                  <View style={s.rowLabelGroup}>
                    <Text style={s.rowLabel}>Dating mode</Text>
                    <Text style={s.rowHint}>Show up in Speed Dating & matches</Text>
                  </View>
                  <Switch
                    testID="settings-dating"
                    value={profile.is_dating_mode ?? false}
                    onValueChange={async (value) => {
                      try { await updateProfile({ is_dating_mode: value }); }
                      catch { showAlert('Error', 'Could not save preference'); }
                    }}
                    accessibilityLabel="Dating mode"
                  />
                </View>
                <View style={s.divider} />
                <View style={s.row}>
                  <Icon name="eye-off-outline" />
                  <View style={s.rowLabelGroup}>
                    <Text style={s.rowLabel}>Ghost mode</Text>
                    <Text style={s.rowHint}>Hide me from discovery & search</Text>
                  </View>
                  <Switch
                    testID="settings-ghost"
                    value={profile.is_ghost ?? false}
                    onValueChange={async (value) => {
                      try { await updateProfile({ is_ghost: value }); }
                      catch { showAlert('Error', 'Could not save preference'); }
                    }}
                    accessibilityLabel="Ghost mode"
                  />
                </View>
              </>
            ) : null}
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Chats</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Icon name="checkmark-done-outline" />
              <View style={s.rowLabelGroup}>
                <Text style={s.rowLabel}>Read receipts</Text>
                <Text style={s.rowHint}>If you turn these off, you won&apos;t see others&apos; either.</Text>
              </View>
              <Switch
                value={chatSettings.read_receipts}
                onValueChange={async (value) => {
                  const ok = await setReadReceipts(value);
                  if (!ok) {
                    showAlert('Not saved', 'Could not save your read receipts setting. It is unchanged.');
                  }
                }}
                accessibilityLabel="Read receipts"
                accessibilityHint="If you turn these off, you won't see others' either."
                testID="settings-read-receipts"
              />
            </View>
            <View style={s.divider} />
            <TouchableOpacity
              style={s.row}
              onPress={async () => {
                const next = chatSettings.group_add_permission === 'friends' ? 'nobody' : 'friends';
                const ok = await setGroupAddPermission(next);
                if (!ok) {
                  showAlert('Not saved', 'Could not save who can add you to groups. Your setting is unchanged.');
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={`Who can add me to groups: ${chatSettings.group_add_permission === 'friends' ? 'Friends' : 'Nobody'}. Change.`}
              testID="settings-group-adds"
            >
              <Icon name="people-outline" />
              <View style={s.rowLabelGroup}>
                <Text style={s.rowLabel}>Who can add me to groups</Text>
                <Text style={s.rowHint}>Only ever people you&apos;re friends with</Text>
              </View>
              <Text style={s.rowAccent}>{chatSettings.group_add_permission === 'friends' ? 'Friends' : 'Nobody'}</Text>
              <Chevron />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Your streak</Text>
          <View style={s.card}>
            <TouchableOpacity
              style={s.row}
              onPress={() => setMiniWinsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Open Mini Wins"
              testID="settings-mini-wins"
            >
              <Icon name="flame-outline" color={colors.warningInk} />
              <View style={s.rowLabelGroup}>
                <Text style={s.rowLabel}>Mini Wins</Text>
                <Text style={s.rowHint}>Three small things today. Keep the streak alive.</Text>
              </View>
              <Chevron />
            </TouchableOpacity>
          </View>
        </View>

        {isCore ? (
          <View style={s.block}>
            <Text style={s.sectionLabel}>Roxy core</Text>
            <View style={[s.card, s.cardPad]}>
              <ViewAsPicker />
            </View>
          </View>
        ) : null}

        <View style={s.block}>
          <Text style={s.sectionLabel}>Support</Text>
          <View style={s.card}>
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push('/(tabs)/you/feedback')}
              accessibilityRole="button"
              accessibilityLabel="Feedback and ideas"
            >
              <Icon name="chatbox-outline" />
              <Text style={[s.rowLabel, s.grow]}>Feedback & ideas</Text>
              <Chevron />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Account</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Icon name="mail-outline" />
              <View style={s.rowLabelGroup}>
                <Text style={s.rowLabel}>Email</Text>
                <Text style={s.rowHint} numberOfLines={1}>{user.email ?? '—'}</Text>
              </View>
            </View>
            <View style={s.divider} />
            <TouchableOpacity
              style={s.row}
              onPress={() => void handleExportData()}
              disabled={exporting}
              accessibilityRole="button"
              accessibilityLabel="Export my data"
              {...a11yState({ disabled: exporting, busy: exporting })}
            >
              <Icon name="download-outline" />
              <View style={s.rowLabelGroup}>
                <Text style={[s.rowLabel, exporting && s.rowMuted]}>
                  {exporting ? 'Preparing your file…' : 'Export my data'}
                </Text>
                {exportError ? <Text style={s.rowError}>{exportError}</Text> : null}
              </View>
              <BusySwap busy={exporting} label="Preparing your file">
                <Chevron />
              </BusySwap>
            </TouchableOpacity>
            <View style={s.divider} />
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push('/(tabs)/you/delete-account' as never)}
              accessibilityRole="button"
              accessibilityLabel="Delete my account"
            >
              <Icon name="trash-outline" color={colors.dangerInk} />
              <Text style={[s.danger, s.grow]}>Delete my account</Text>
              <Chevron />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={s.signOut}
          onPress={() => void handleSignOut()}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={s.signOutText}>Sign out</Text>
        </TouchableOpacity>
        <Text style={s.footer}>Roxy · made in London</Text>
      </ScrollView>

      <Snackbar
        visible={roxyOffSnack}
        message={ROXY_OFF_COPY}
        actionLabel="Undo"
        onAction={() => setRoxy(true)}
        onDismiss={() => setRoxyOffSnack(false)}
        testID="settings-roxy-snackbar"
      />

      <MiniWinsSheet
        visible={miniWinsOpen}
        userId={user.id}
        onClose={() => setMiniWinsOpen(false)}
      />
    </SafeAreaView>
  );
}

/*
 * RETIRED here (v2, 2026-10-21): the Appearance block with `ThemeToggle`
 * (Dark · Light buttons), the 🔥 emoji on Mini Wins, tracked-caps section
 * labels, RN `Switch` and the "made with ✿" footer. Origin: the Roxy 3.0
 * settings slice (`git log -S ThemeToggle -- "apps/mobile/app/(tabs)/you/settings.tsx"`).
 * Why: v2 puts Theme in the first group as Light · Dark · Match phone, bans
 * emoji in chrome, tracked capitals and the flower, and uses one M3 switch.
 * `components/ui/ThemeToggle.tsx` is kept (another lane's file to retire).
 */

const styles = (colors: ThemeColors) => StyleSheet.create({
  skeleton: { padding: 16, gap: 8 },
  skeletonRow: { width: '100%' },
  container: { flex: 1, backgroundColor: colors.ground },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[1],
    paddingHorizontal: SPACE[1],
    paddingVertical: SPACE[1],
    backgroundColor: colors.ground,
  },
  backBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...TYPE.title, color: colors.ink },
  scroll: { padding: MARGIN, gap: SPACE[5], paddingBottom: FAB_LANE + SPACE[5] },
  block: { gap: SPACE[1] },
  sectionLabel: {
    ...emphasized('meta'),
    color: colors.ink2,
    paddingStart: SPACE[0],
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  cardPad: { padding: SPACE[2] },
  row: {
    minHeight: MIN_TOUCH_TARGET + SPACE[2],
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: MARGIN,
    paddingVertical: SPACE[2],
    gap: SPACE[2],
  },
  iconRoom: { width: ICON },
  grow: { flex: 1 },
  rowLabelGroup: { flex: 1, minWidth: 0 },
  rowLabel: { ...TYPE.label, color: colors.ink },
  rowHint: { ...TYPE.meta, color: colors.ink2 },
  rowValue: { ...TYPE.meta, color: colors.ink2, flexShrink: 1 },
  rowAccent: { ...emphasized('meta'), color: colors.pinkInk },
  rowMuted: { color: colors.ink3 },
  rowError: { ...TYPE.meta, color: colors.dangerInk, marginTop: SPACE[0] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginStart: MARGIN },
  danger: { ...TYPE.label, color: colors.dangerInk },
  themeBlock: { paddingHorizontal: MARGIN, paddingVertical: SPACE[2], gap: SPACE[2] },
  themeHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2], minHeight: SPACE[5] },
  group: { flexDirection: 'row', gap: GROUP_GAP },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE[0],
    paddingHorizontal: SPACE[1],
  },
  segmentLabel: { ...TYPE.label },
  segmentLabelOn: { ...emphasized('label') },
  signOut: {
    minHeight: MIN_TOUCH_TARGET + SPACE[0],
    borderRadius: RADII.pill,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { ...TYPE.button, color: colors.ink },
  footer: {
    ...TYPE.meta,
    color: colors.ink2,
    textAlign: 'center',
  },
});
