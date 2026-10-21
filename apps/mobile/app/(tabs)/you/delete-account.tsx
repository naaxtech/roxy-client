import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { TouchableOpacity } from '../../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { callEdgeFunction, supabase } from '../../../lib/supabase';
import { resetAllStores } from '../../../store/resetAllStores';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { inkOn } from '../../../lib/theme';
import { logError } from '../../../lib/errorLogger';
import { showAlert } from '../../../lib/confirm';
import { a11yState } from '../../../lib/a11yState';
import { exportUserData, describeExportResult } from '../../../lib/dataExport';

/**
 * What deleting does, in the order it happens. Only what the server actually
 * does (gdpr-delete + the scheduled purge): the old copy said "All data
 * deleted after 30 days" over a function that never deleted anything.
 */
export const DELETE_STEPS: readonly { icon: string; text: string }[] = [
  { icon: '🙈', text: 'Right away, your name, photo, bio and pronouns are removed, and you\'re signed out on this phone.' },
  { icon: '🔒', text: 'Your invite application, legal name and verification answers are erased right away.' },
  { icon: '🗓️', text: 'Within 30 days, everything else is permanently deleted: your account, posts, comments, photos and Archive reviews.' },
];

export default function DeleteAccountScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Case- and space-insensitive: "delete " typed on a phone keyboard that
  // capitalises nothing is the same decision as "DELETE".
  const confirmed = input.trim().toUpperCase() === 'DELETE';

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    const outcome = await exportUserData();
    setExporting(false);
    const { title, body } = describeExportResult(outcome);
    showAlert(title, body);
  };

  const handleDelete = async () => {
    if (!confirmed || loading) return;
    setLoading(true);
    // callEdgeFunction RESOLVES on failure -- it catches internally and returns
    // { data, error } (lib/supabase.ts:23-57). The try/catch that used to guard
    // this call was therefore unreachable and the returned error was never
    // read, so a 429 (gdpr-delete caps at 3/day), a 500 from erase_gate_data,
    // or simply being offline signed her out and sent her to the welcome screen
    // exactly as though the account had been erased. It had not. The edge
    // function's contract is "fail loudly, nothing partially removed"; honour it.
    const { error } = await callEdgeFunction('gdpr-delete', {});
    if (error) {
      logError(error, 'handleDelete');
      setLoading(false);
      showAlert(
        'Account not deleted',
        /rate limit/i.test(String(error))
          ? 'You have tried a few times today. Your account is still here — nothing has been removed. Please try again tomorrow.'
          : 'Roxy could not reach the server. Your account is still here — nothing has been removed. Please try again.',
      );
      return;
    }
    // Deletion confirmed by the server — best-effort sign out, always redirect,
    // and leave nothing of hers on this phone (ARC-08).
    try { await supabase.auth.signOut(); } catch {}
    resetAllStores();
    router.replace('/(auth)/welcome');
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, padding: 16, gap: 16 },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    backButton: { padding: 4 },
    backText: { color: colors.roxy, fontSize: 16, fontWeight: '500' },
    headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
    headerSpacer: { width: 56 },

    // Warning card
    warningCard: {
      backgroundColor: colors.error + '14',
      borderRadius: 16,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.error + '40',
      gap: 12,
    },
    warningTitle: {
      color: colors.errorInk,
      fontSize: 16,
      fontWeight: '700',
    },
    stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    stepIcon: { fontSize: 16, lineHeight: 20 },
    warningText: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 14,
      lineHeight: 20,
    },

    // Export first
    exportCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      gap: 10,
    },
    exportTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    exportText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
    exportButton: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.roxy,
      minHeight: 44,
      justifyContent: 'center',
    },
    exportButtonText: { color: colors.roxy, fontSize: 14, fontWeight: '700' },
    gentle: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },

    // Input section
    inputSection: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      gap: 8,
    },
    inputLabel: { color: colors.textMuted, fontSize: 13 },
    inputLabelBold: { color: colors.textPrimary, fontWeight: '700' },
    input: {
      backgroundColor: colors.background,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 2,
      borderWidth: 1,
      borderColor: colors.textMuted + '40',
    },

    // Delete button
    deleteButton: {
      backgroundColor: colors.error,
      borderRadius: 16,
      padding: 16,
      alignItems: 'center',
      minHeight: 52,
      justifyContent: 'center',
    },
    deleteButtonDisabled: {
      opacity: 0.4,
    },
    deleteButtonText: {
      color: inkOn(colors.error),
      fontSize: 16,
      fontWeight: '700',
    },
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backText}>{'← Back'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} accessibilityRole="header">Delete account</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Warning card */}
        <View style={styles.warningCard} testID="delete-steps">
          <Text style={styles.warningTitle}>This can't be undone</Text>
          {DELETE_STEPS.map((step) => (
            <View key={step.text} style={styles.stepRow}>
              <Text style={styles.stepIcon} importantForAccessibility="no">{step.icon}</Text>
              <Text style={styles.warningText}>{step.text}</Text>
            </View>
          ))}
        </View>

        {/* Export first — she should never have to choose between leaving and keeping her memories */}
        <View style={styles.exportCard}>
          <Text style={styles.exportTitle}>Keep a copy first?</Text>
          <Text style={styles.exportText}>
            Download your posts, comments, messages you sent, Archive ratings and profile before you go.
          </Text>
          <TouchableOpacity
            testID="delete-export-button"
            style={styles.exportButton}
            onPress={() => void handleExport()}
            disabled={exporting || loading}
            accessibilityRole="button"
            accessibilityLabel="Download my data"
            {...a11yState({ disabled: exporting || loading, busy: exporting })}
          >
            {exporting
              ? <ActivityIndicator color={colors.roxy} />
              : <Text style={styles.exportButtonText}>Download my data</Text>}
          </TouchableOpacity>
        </View>

        {/* Confirmation input */}
        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>
            Type <Text style={styles.inputLabelBold}>DELETE</Text> to confirm
          </Text>
          <TextInput
            testID="delete-input"
            accessibilityLabel="Type DELETE to confirm"
            style={styles.input}
            value={input}
            onChangeText={setInput}
            maxLength={12}
            placeholder="DELETE"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!loading}
          />
        </View>

        {/* Delete button */}
        <TouchableOpacity
          testID="delete-confirm-button"
          style={[
            styles.deleteButton,
            (!confirmed || loading) && styles.deleteButtonDisabled,
          ]}
          onPress={handleDelete}
          disabled={!confirmed || loading}
          accessibilityRole="button"
          accessibilityLabel="Delete my account"
          {...a11yState({ disabled: !confirmed || loading, busy: loading })}
        >
          {loading ? (
            <ActivityIndicator color={inkOn(colors.error)} />
          ) : (
            <Text style={styles.deleteButtonText}>Delete my account</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.gentle}>
          Need a break instead? You can hide from discovery in Settings and come back whenever you like.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
