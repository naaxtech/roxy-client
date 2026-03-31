import React from 'react';
import {
  View, Text, TouchableOpacity, Switch,
  ScrollView, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { supabase, callEdgeFunction } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';

export default function SettingsScreen() {
  const { user } = useAuthStore();
  const { profile, updateProfile } = useProfileStore();
  const router = useRouter();

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} />
      </SafeAreaView>
    );
  }

  const handleSignOut = () => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            useAuthStore.getState().signOut();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleExportData = async () => {
    const { data, error } = await callEdgeFunction('gdpr-export', {});
    if (error) {
      Alert.alert('Error', error ?? 'Could not export data. Please try again.');
    } else {
      Alert.alert('Export ready', 'Your data has been compiled. Download will be available shortly.');
    }
  };

  const handleDeleteAccount = () => {
    router.push('/(tabs)/profile/delete-account' as any);
  };

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
                catch { Alert.alert('Error', 'Could not save preference'); }
              }}
              trackColor={{ false: COLORS.surface, true: COLORS.roxy }}
              thumbColor={COLORS.textPrimary}
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
                catch { Alert.alert('Error', 'Could not save preference'); }
              }}
              trackColor={{ false: COLORS.surface, true: COLORS.roxy }}
              thumbColor={COLORS.textPrimary}
            />
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        {/* Data & Privacy section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Data & Privacy</Text>

          <TouchableOpacity style={styles.actionRow} onPress={handleExportData}>
            <Text style={styles.actionRowLabel}>Export my data</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 16, gap: 16 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  backButton: { padding: 4 },
  backText: { color: COLORS.roxy, fontSize: 16, fontWeight: '500' },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  headerSpacer: { width: 56 },

  // Section card
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    width: '100%',
  },
  sectionHeader: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  rowLabelGroup: { flex: 1, marginRight: 12 },
  rowLabel: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '500' },
  rowDescription: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  rowValue: { color: COLORS.textMuted, fontSize: 14 },

  // Separator
  separator: {
    height: 1,
    backgroundColor: COLORS.textMuted + '30',
    marginHorizontal: -16,
  },

  // Action row (GDPR)
  actionRow: {
    paddingVertical: 14,
  },
  actionRowLabel: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '500' },

  // Sign out button
  signOutButton: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.error + '60',
  },
  signOutText: { color: COLORS.error, fontSize: 16, fontWeight: '600' },

  // Danger text (delete account)
  dangerText: { color: COLORS.error, fontSize: 15, fontWeight: '500' },
});
