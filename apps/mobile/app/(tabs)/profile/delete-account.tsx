import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { callEdgeFunction, supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { COLORS } from '../../../lib/constants';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const confirmed = input === 'DELETE';

  const handleDelete = async () => {
    if (!confirmed || loading) return;
    setLoading(true);
    try {
      const { error } = await callEdgeFunction('gdpr-delete', {});
      if (error) throw new Error(error);
      await supabase.auth.signOut();
      useAuthStore.getState().signOut();
      router.replace('/(auth)/login' as any);
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Error', e?.message ?? 'Could not delete account. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>{'← Back'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delete Account</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Warning card */}
        <View style={styles.warningCard}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <Text style={styles.warningTitle}>This action cannot be undone</Text>
          <Text style={styles.warningText}>
            Your account will be deactivated immediately. All data deleted after 30 days.
          </Text>
        </View>

        {/* Confirmation input */}
        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>
            Type <Text style={styles.inputLabelBold}>DELETE</Text> to confirm
          </Text>
          <TextInput
            testID="delete-input"
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="DELETE"
            placeholderTextColor={COLORS.textMuted}
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
          accessibilityState={{ disabled: !confirmed || loading }}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.deleteButtonText}>Delete my account</Text>
          )}
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, padding: 16, gap: 16 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  backButton: { padding: 4 },
  backText: { color: COLORS.roxy, fontSize: 16, fontWeight: '500' },
  headerTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  headerSpacer: { width: 56 },

  // Warning card
  warningCard: {
    backgroundColor: '#3B0000',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EF4444' + '40',
    gap: 8,
  },
  warningIcon: { fontSize: 32 },
  warningTitle: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  warningText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Input section
  inputSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  inputLabel: { color: COLORS.textMuted, fontSize: 13 },
  inputLabelBold: { color: COLORS.textPrimary, fontWeight: '700' },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    borderWidth: 1,
    borderColor: COLORS.textMuted + '40',
  },

  // Delete button
  deleteButton: {
    backgroundColor: '#EF4444',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  deleteButtonDisabled: {
    backgroundColor: '#EF4444' + '40',
    opacity: 0.6,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
