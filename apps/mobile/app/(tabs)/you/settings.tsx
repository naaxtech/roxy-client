import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Switch,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { supabase } from '../../../lib/supabase';
import { exportUserData, describeExportResult } from '../../../lib/dataExport';
import { confirmAction, showAlert } from '../../../lib/confirm';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { a11yState } from '../../../lib/a11yState';
import { ThemeToggle } from '../../../components/ui/ThemeToggle';
import { ViewAsPicker } from '../../../components/settings/ViewAsPicker';
import { useSafetyStore } from '../../../store/safetyStore';
import {
  readDmPermission, nextDmPermission, dmPermissionLabel, dmPermissionDescription,
} from '../../../lib/dmPermission';
import { useAccess } from '../../../hooks/useAccess';
import { useViewAsStore } from '../../../store/viewAsStore';
import { TYPE } from '../../../lib/typography';
import { RADII, type ThemeColors } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

/**
 * Settings & safety — same sections and copy as the 3.0 prototype.
 *
 * Dating / Ghost stay behind beta (or a core preview of staff). The HQ
 * preview picker is extra chrome that only core sees.
 */
export default function SettingsScreen() {
  const { user } = useAuthStore();
  const { profile, updateProfile } = useProfileStore();
  const { isBeta, isCore } = useAccess();
  const router = useRouter();
  const colors = useThemeColors();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const blockedCount = useSafetyStore((s) => s.blockedUserIds.length);
  const s = styles(colors);

  if (!user || !profile) {
    return (
      <SafeAreaView style={s.container}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const dmPermission = readDmPermission(profile as { dm_permission?: unknown });

  const handleSignOut = async () => {
    const confirmed = await confirmAction('Sign out', 'Are you sure you want to sign out?', 'Sign out');
    if (!confirmed) return;
    await supabase.auth.signOut();
    useAuthStore.getState().signOut();
    useProfileStore.getState().setProfile(null);
    useViewAsStore.getState().setPreview(null);
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

  return (
    <SafeAreaView style={s.container}>
      <View style={s.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings & safety</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.block}>
          <Text style={s.sectionLabel}>Account</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>Email</Text>
              <Text style={s.rowValue} numberOfLines={1}>{user.email ?? '—'}</Text>
            </View>
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
          <Text style={s.sectionLabel}>Visibility & safety</Text>
          <View style={s.card}>
            {isBeta ? (
              <>
                <View style={s.row}>
                  <View style={s.rowLabelGroup}>
                    <Text style={s.rowLabel}>Dating mode</Text>
                    <Text style={s.rowHint}>Show up in Speed Dating & matches</Text>
                  </View>
                  <Switch
                    value={profile.is_dating_mode ?? false}
                    onValueChange={async (value) => {
                      try { await updateProfile({ is_dating_mode: value }); }
                      catch { showAlert('Error', 'Could not save preference'); }
                    }}
                    trackColor={{ false: colors.surfaceLight, true: colors.primary }}
                    thumbColor={colors.backgroundAlt}
                    accessibilityLabel="Dating mode"
                  />
                </View>
                <View style={s.divider} />
                <View style={s.row}>
                  <View style={s.rowLabelGroup}>
                    <Text style={s.rowLabel}>Ghost mode</Text>
                    <Text style={s.rowHint}>Hide me from discovery & search</Text>
                  </View>
                  <Switch
                    value={profile.is_ghost ?? false}
                    onValueChange={async (value) => {
                      try { await updateProfile({ is_ghost: value }); }
                      catch { showAlert('Error', 'Could not save preference'); }
                    }}
                    trackColor={{ false: colors.surfaceLight, true: colors.primary }}
                    thumbColor={colors.backgroundAlt}
                    accessibilityLabel="Ghost mode"
                  />
                </View>
                <View style={s.divider} />
              </>
            ) : null}

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
              <View style={s.rowLabelGroup}>
                <Text style={s.rowLabel}>Who can message me</Text>
                <Text style={s.rowHint}>Everyone else lands in Requests</Text>
              </View>
              <Text style={s.rowAccent}>{dmPermissionLabel(dmPermission)} ›</Text>
            </TouchableOpacity>
            <View style={s.divider} />
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push('/(tabs)/you/blocked' as never)}
              accessibilityRole="button"
              accessibilityLabel={`Blocked, ${blockedCount} ${blockedCount === 1 ? 'person' : 'people'}`}
              testID="settings-blocked"
            >
              <Text style={s.rowLabel}>Blocked</Text>
              <Text style={s.rowValue}>{blockedCount} ›</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Appearance</Text>
          <View style={[s.card, s.appearanceCard]}>
            <ThemeToggle />
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Support</Text>
          <View style={s.card}>
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push('/(tabs)/you/feedback')}
              accessibilityRole="button"
              accessibilityLabel="Feedback and ideas"
            >
              <Text style={s.rowLabel}>Feedback & ideas</Text>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.block}>
          <Text style={s.sectionLabel}>Data & privacy</Text>
          <View style={s.card}>
            <TouchableOpacity
              style={s.row}
              onPress={() => void handleExportData()}
              disabled={exporting}
              accessibilityRole="button"
              accessibilityLabel="Export my data"
              {...a11yState({ disabled: exporting, busy: exporting })}
            >
              <View style={s.rowLabelGroup}>
                <Text style={[s.rowLabel, exporting && s.rowMuted]}>
                  {exporting ? 'Preparing your file…' : 'Export my data'}
                </Text>
                {exportError ? <Text style={s.rowError}>{exportError}</Text> : null}
              </View>
              {exporting
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Text style={s.chevron}>›</Text>}
            </TouchableOpacity>
            <View style={s.divider} />
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push('/(tabs)/you/delete-account' as never)}
              accessibilityRole="button"
              accessibilityLabel="Delete my account"
            >
              <Text style={s.danger}>Delete my account</Text>
              <Text style={s.chevron}>›</Text>
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
        <Text style={s.footer}>Roxy 3.0 · made with ✿ in London</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.backgroundAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  backBtn: {
    width: MIN_TOUCH_TARGET - 4,
    height: MIN_TOUCH_TARGET - 4,
    borderRadius: RADII.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...TYPE.title, color: colors.textPrimary, fontWeight: '700' },
  scroll: { padding: 14, gap: 14, paddingBottom: 40 },
  block: { gap: 7 },
  sectionLabel: {
    ...TYPE.micro,
    color: colors.textMuted,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingLeft: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  cardPad: { padding: 12 },
  appearanceCard: { padding: 6 },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 12,
  },
  rowLabelGroup: { flex: 1, minWidth: 0 },
  rowLabel: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
  rowHint: { ...TYPE.caption, color: colors.textMuted, marginTop: 1 },
  rowValue: { ...TYPE.caption, color: colors.textMuted, fontWeight: '600', flexShrink: 1 },
  rowAccent: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '700' },
  rowMuted: { color: colors.textMuted },
  rowError: { ...TYPE.caption, color: colors.error, marginTop: 4 },
  chevron: { ...TYPE.bodyLg, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.line },
  danger: { ...TYPE.body, color: colors.error, fontWeight: '700' },
  signOut: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: colors.primaryInk,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  signOutText: { ...TYPE.bodyLg, color: colors.primaryInk, fontWeight: '700' },
  footer: {
    ...TYPE.caption,
    color: colors.textMuted,
    textAlign: 'center',
    fontWeight: '600',
  },
});
