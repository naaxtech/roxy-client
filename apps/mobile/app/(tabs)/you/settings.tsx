import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Switch,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { supabase } from '../../../lib/supabase';
import { exportUserData, describeExportResult } from '../../../lib/dataExport';
import { confirmAction, showAlert } from '../../../lib/confirm';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { useThemeStore } from '../../../store/themeStore';
import { a11yState } from '../../../lib/a11yState';
import { ThemeToggle } from '../../../components/ui/ThemeToggle';
import { useSafetyStore } from '../../../store/safetyStore';
import {
  readDmPermission, nextDmPermission, dmPermissionLabel, dmPermissionDescription,
} from '../../../lib/dmPermission';

export default function SettingsScreen() {
  const { user } = useAuthStore();
  const { profile, updateProfile } = useProfileStore();
  const router = useRouter();
  const colors = useThemeColors();
  const { theme } = useThemeStore();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // `(tabs)/_layout.tsx` hydrates this once per session, so the count is here
  // without this screen fetching anything.
  const blockedCount = useSafetyStore((s) => s.blockedUserIds.length);

  if (!user || !profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.roxy} />
      </SafeAreaView>
    );
  }

  // Migration 093 is written and NOT applied, so this key is absent from every
  // profile row today. `readDmPermission` answers `everyone` for that, which is
  // exactly how the app already behaves — anyone may message, and the inbox
  // files strangers under Requests.
  const dmPermission = readDmPermission(profile as { dm_permission?: unknown });

  const handleSignOut = async () => {
    const confirmed = await confirmAction('Sign out', 'Are you sure you want to sign out?', 'Sign out');
    if (!confirmed) return;
    await supabase.auth.signOut();
    useAuthStore.getState().signOut();
    router.replace('/(auth)/welcome');
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

  const handleDeleteAccount = () => {
    router.push('/(tabs)/you/delete-account' as any);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 16, gap: 16 },
    header: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: 4,
    },
    backButton: { padding: 4 },
    backText: { color: colors.roxy, fontSize: 16, fontWeight: '500' },
    headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
    headerSpacer: { width: 56 },
    section: {
      backgroundColor: colors.surface, borderRadius: 16,
      paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, width: '100%',
    },
    sectionHeader: {
      color: colors.textMuted, fontSize: 11, fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
    },
    row: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', paddingVertical: 10,
    },
    rowLabelGroup: { flex: 1, marginRight: 12 },
    rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
    rowDescription: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rowValue: { color: colors.textMuted, fontSize: 14 },
    separator: { height: 1, backgroundColor: colors.textMuted + '30', marginHorizontal: -16 },
    actionRow: { paddingVertical: 14 },
    actionRowBusy: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    actionRowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
    actionRowLabelDisabled: { color: colors.textMuted },
    actionRowError: { color: colors.error, fontSize: 12, marginTop: 6 },
    signOutButton: {
      width: '100%', backgroundColor: colors.surface, borderRadius: 16,
      padding: 16, alignItems: 'center',
      borderWidth: 1, borderColor: colors.error + '60',
    },
    signOutText: { color: colors.error, fontSize: 16, fontWeight: '600' },
    dangerText: { color: colors.error, fontSize: 15, fontWeight: '500' },
    segmentedControl: {
      flexDirection: 'row', borderRadius: 8,
      backgroundColor: colors.surfaceLight, padding: 2,
    },
    segment: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
    segmentTextActive: { color: '#FFFFFF' },
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>{'← Back'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Account</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowValue}>{user?.email ?? '—'}</Text>
          </View>
        </View>

        {/* Preferences section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Preferences</Text>

          <View style={styles.row}>
            <View style={styles.rowLabelGroup}>
              <Text style={styles.rowLabel}>Dating mode</Text>
            </View>
            <Switch
              value={profile.is_dating_mode ?? false}
              onValueChange={async (value) => {
                try { await updateProfile({ is_dating_mode: value }); }
                catch { showAlert('Error', 'Could not save preference'); }
              }}
              trackColor={{ false: colors.surface, true: colors.roxy }}
              thumbColor={colors.textPrimary}
            />
          </View>

          <View style={styles.separator} />

          <View style={styles.row}>
            <View style={styles.rowLabelGroup}>
              <Text style={styles.rowLabel}>Ghost mode</Text>
              <Text style={styles.rowDescription}>Hide from discovery</Text>
            </View>
            <Switch
              value={profile.is_ghost ?? false}
              onValueChange={async (value) => {
                try { await updateProfile({ is_ghost: value }); }
                catch { showAlert('Error', 'Could not save preference'); }
              }}
              trackColor={{ false: colors.surface, true: colors.roxy }}
              thumbColor={colors.textPrimary}
            />
          </View>

          <View style={styles.separator} />

          {/* Who can message me — the prototype cycles the three values in
              place rather than pushing a picker (behaviour 1637). The write
              can fail on this branch because migration 093 is not applied
              yet, and it says so instead of showing a value it did not save. */}
          <TouchableOpacity
            style={styles.row}
            onPress={async () => {
              const next = nextDmPermission(dmPermission);
              try {
                await updateProfile({ dm_permission: next } as never);
              } catch {
                showAlert(
                  'Not saved',
                  'Could not save who can message you. Your setting is unchanged.'
                );
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={`Who can message me: ${dmPermissionLabel(dmPermission)}. Change.`}
            testID="settings-dm-permission"
          >
            <View style={styles.rowLabelGroup}>
              <Text style={styles.rowLabel}>Who can message me</Text>
              <Text style={styles.rowDescription}>{dmPermissionDescription(dmPermission)}</Text>
            </View>
            <Text style={styles.rowValue}>{dmPermissionLabel(dmPermission)} ›</Text>
          </TouchableOpacity>

          <View style={styles.separator} />

          {/* "Blocked", not the prototype's "Blocked & muted": this app has no
              mute, and naming one would send her looking for it. */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/(tabs)/you/blocked' as never)}
            accessibilityRole="button"
            accessibilityLabel={`Blocked, ${blockedCount} ${blockedCount === 1 ? 'person' : 'people'}`}
            testID="settings-blocked"
          >
            <View style={styles.rowLabelGroup}>
              <Text style={styles.rowLabel}>Blocked</Text>
              <Text style={styles.rowDescription}>Who cannot see or reach you</Text>
            </View>
            <Text style={styles.rowValue}>{blockedCount} ›</Text>
          </TouchableOpacity>

          <View style={styles.separator} />

          <View style={styles.row}>
            <View style={styles.rowLabelGroup}>
              <Text style={styles.rowLabel}>Appearance</Text>
              <Text style={styles.rowDescription}>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</Text>
            </View>
            <ThemeToggle />
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        {/* Support section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Support</Text>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => router.push('/(tabs)/you/feedback')}
          >
            <Text style={styles.actionRowLabel}>Send feedback / report a bug</Text>
          </TouchableOpacity>
        </View>

        {/* Data & Privacy section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Data & Privacy</Text>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleExportData}
            disabled={exporting}
            accessibilityRole="button"
            accessibilityLabel="Export my data"
            {...a11yState({ disabled: exporting, busy: exporting })}
          >
            <View style={styles.actionRowBusy}>
              {exporting && <ActivityIndicator size="small" color={colors.roxy} />}
              <Text style={[styles.actionRowLabel, exporting && styles.actionRowLabelDisabled]}>
                {exporting ? 'Preparing your file…' : 'Export my data'}
              </Text>
            </View>
            {exportError !== null && (
              <Text style={styles.actionRowError}>{exportError}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.separator} />

          <TouchableOpacity style={styles.actionRow} onPress={handleDeleteAccount}>
            <Text style={styles.dangerText}>Delete my account</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
