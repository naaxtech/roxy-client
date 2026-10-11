import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Switch, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { useAuthStore } from '../../../store/authStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import {
  deviceTimezone,
  loadNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from '../../../lib/notificationSettings';
import { TYPE } from '../../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { a11yState } from '../../../lib/a11yState';

type ToggleKey = 'push_enabled' | 'messages' | 'friends' | 'events' | 'community_chats' | 'show_previews';

const TYPES: { key: Exclude<ToggleKey, 'push_enabled' | 'show_previews'>; label: string; hint: string }[] = [
  { key: 'messages', label: 'Messages', hint: 'Direct messages sent to you' },
  { key: 'friends', label: 'Friend requests', hint: 'New requests, and when someone accepts yours' },
  { key: 'events', label: 'Community events', hint: 'New events in communities you joined' },
  { key: 'community_chats', label: 'Community chats', hint: 'Chats where you turned alerts on, invites, and join requests you moderate' },
];

const QUIET_PRESETS: { id: string; label: string; start: string | null; end: string | null }[] = [
  { id: 'off', label: 'Off', start: null, end: null },
  { id: '22-07', label: '10 pm – 7 am', start: '22:00', end: '07:00' },
  { id: '23-08', label: '11 pm – 8 am', start: '23:00', end: '08:00' },
  { id: '00-09', label: '12 am – 9 am', start: '00:00', end: '09:00' },
];

/**
 * You › Settings › Notifications.
 *
 * Every type is ON until she turns it off; lock-screen previews are OFF until
 * she turns them on (Nicole, 2026-10-04). Each switch saves immediately and
 * rolls back, with a visible line, if the save fails — a switch that shows
 * "off" while the server still sends is worse than no switch.
 */
export default function NotificationSettingsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const colors = useThemeColors();
  const s = styles(colors);

  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [osBlocked, setOsBlocked] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoadError(false);
    try {
      setSettings(await loadNotificationSettings(userId));
    } catch {
      setLoadError(true);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    Notifications.getPermissionsAsync()
      .then((p) => setOsBlocked(p.status === 'denied'))
      .catch(() => undefined);
  }, []);

  const apply = async (next: NotificationSettings) => {
    if (!userId || !settings) return;
    const previous = settings;
    setSettings(next);
    setSaveError(null);
    try {
      await saveNotificationSettings(userId, next, deviceTimezone());
    } catch {
      setSettings(previous);
      setSaveError('Not saved. Check your connection and try again.');
    }
  };

  const toggle = (key: ToggleKey, value: boolean) => {
    if (!settings) return;
    void apply({ ...settings, [key]: value });
  };

  const header = (
    <View style={s.topBar}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={s.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={s.headerTitle} accessibilityRole="header">Notifications</Text>
    </View>
  );

  if (loadError) {
    return (
      <SafeAreaView style={s.container}>
        {header}
        <View style={s.centred} testID="notif-load-error">
          <Text style={s.stateText}>Your notification settings did not load.</Text>
          <TouchableOpacity onPress={() => void load()} accessibilityRole="button" style={s.retry}>
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!settings) {
    return (
      <SafeAreaView style={s.container}>
        {header}
        <View style={s.centred}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const off = !settings.push_enabled;
  const quietId = QUIET_PRESETS.find(
    (p) => p.start === settings.quiet_start && p.end === settings.quiet_end,
  )?.id ?? null;

  const row = (key: ToggleKey, label: string, hint: string, disabled = false) => (
    <View style={s.row} key={key}>
      <View style={s.rowLabelGroup}>
        <Text style={[s.rowLabel, disabled && s.muted]}>{label}</Text>
        <Text style={s.rowHint}>{hint}</Text>
      </View>
      <Switch
        testID={`notif-switch-${key}`}
        value={settings[key]}
        disabled={disabled}
        onValueChange={(v) => toggle(key, v)}
        trackColor={{ false: colors.surfaceLight, true: colors.primary }}
        thumbColor={colors.backgroundAlt}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <SafeAreaView style={s.container}>
      {header}
      <ScrollView contentContainerStyle={s.scroll}>
        {osBlocked ? (
          <TouchableOpacity
            style={s.banner}
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            accessibilityLabel="Notifications are blocked for Roxy in your phone settings. Open settings."
            testID="notif-os-blocked"
          >
            <Text style={s.bannerText}>
              Notifications are blocked for Roxy in your phone settings. Tap to open settings.
            </Text>
          </TouchableOpacity>
        ) : null}

        {saveError ? <Text style={s.error} testID="notif-save-error">{saveError}</Text> : null}

        <View style={s.block}>
          <View style={s.card}>
            {row('push_enabled', 'Push notifications', 'Turn off to stop every alert on this account')}
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Notify me about</Text>
          <View style={s.card}>
            {TYPES.map((t, i) => (
              <React.Fragment key={t.key}>
                {i > 0 ? <View style={s.divider} /> : null}
                {row(t.key, t.label, t.hint, off)}
              </React.Fragment>
            ))}
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Privacy</Text>
          <View style={s.card}>
            {row(
              'show_previews',
              'Show previews on the lock screen',
              settings.show_previews
                ? 'Message text and community names can appear on your lock screen'
                : 'Off: only "New message from Maya" — never what she wrote, or which community',
              off,
            )}
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Quiet hours</Text>
          <Text style={s.blockHint}>Notifications still arrive, silently. Uses your phone's time zone.</Text>
          <View style={s.chips} accessibilityRole="radiogroup">
            {QUIET_PRESETS.map((p) => {
              const selected = quietId === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  testID={`notif-quiet-${p.id}`}
                  style={[s.chip, selected && s.chipOn]}
                  disabled={off}
                  onPress={() => void apply({ ...settings, quiet_start: p.start, quiet_end: p.end })}
                  accessibilityRole="radio"
                  accessibilityLabel={`Quiet hours ${p.label}`}
                  {...a11yState({ selected, disabled: off })}
                >
                  <Text style={[s.chipText, selected && s.chipTextOn]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.backgroundAlt, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  backBtn: {
    width: MIN_TOUCH_TARGET - 4, height: MIN_TOUCH_TARGET - 4, borderRadius: RADII.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { ...TYPE.title, color: colors.textPrimary, fontWeight: '700' },
  scroll: { padding: 14, gap: 14, paddingBottom: 40 },
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  stateText: { ...TYPE.body, color: colors.textMuted, textAlign: 'center' },
  retry: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 16 },
  retryText: { ...TYPE.body, color: colors.primaryInk, fontWeight: '700' },
  block: { gap: 7 },
  blockHint: { ...TYPE.caption, color: colors.textMuted, paddingLeft: 2 },
  sectionLabel: {
    ...TYPE.micro, color: colors.textMuted, fontWeight: '800',
    letterSpacing: 1.4, textTransform: 'uppercase', paddingLeft: 2,
  },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: RADII.md, overflow: 'hidden',
  },
  row: {
    minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 13, paddingVertical: 10, gap: 12,
  },
  rowLabelGroup: { flex: 1, minWidth: 0 },
  rowLabel: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
  rowHint: { ...TYPE.caption, color: colors.textMuted, marginTop: 1 },
  muted: { color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.line, marginLeft: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 14,
    borderRadius: RADII.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700' },
  chipTextOn: { color: inkOn(colors.primary) },
  banner: {
    padding: 12, borderRadius: RADII.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surfaceLight,
  },
  bannerText: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '600' },
  error: { ...TYPE.caption, color: colors.error, fontWeight: '600' },
});
