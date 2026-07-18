import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { logError, logBreadcrumb } from '../../../lib/errorLogger';
import { ChipSelector } from '../../../components/ui/ChipSelector';
import { IDENTITY_LABELS, PRONOUNS, USERNAME_MAX } from '../../../lib/constants';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { RoxyWordmark } from '../../../components/ui/RoxyWordmark';

export default function Step1Identity() {
  const colors = useThemeColors();
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [pronouns, setPronouns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  const checkUsername = async (val: string) => {
    setUsername(val);
    if (val.length < 3 || val.length > USERNAME_MAX || !/^[a-z0-9_]+$/i.test(val)) {
      setUsernameAvailable(null);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('username', val.toLowerCase())
      .maybeSingle();
    setUsernameAvailable(!data);
  };

  const handleNext = async () => {
    if (!user) return;
    if (!usernameAvailable || !displayName || labels.length === 0) return;
    logBreadcrumb('onboarding_step1_submit', { username: username.toLowerCase(), label_count: String(labels.length) });
    setLoading(true);
    const { error } = await supabase.from('profiles').upsert({
      id: user!.id,
      username: username.toLowerCase(),
      display_name: displayName,
      identity_labels: labels,
      pronouns,
    });
    setLoading(false);
    if (error) {
      logError(error, 'onboarding_step1_upsert');
      Alert.alert('Error', 'Could not save your identity. Please try again.');
      return;
    }
    logBreadcrumb('onboarding_step1_complete');
    router.replace('/(auth)/onboarding/step2-interests');
  };

  const usernameHint = username.length < 3 ? '' : usernameAvailable === true ? '✓ Available' : usernameAvailable === false ? '✗ Taken' : '';

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 24, gap: 8 },
    step: { color: colors.textMuted, fontSize: 13 },
    headline: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
    label: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', marginTop: 12 },
    input: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, color: colors.textPrimary, fontSize: 16 },
    hint: { fontSize: 12, marginTop: 2 },
    hintGood: { color: colors.success },
    hintBad: { color: colors.error },
    btn: { backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  });

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <RoxyWordmark height={34} style={{ marginBottom: 10 }} />
        <Text style={styles.step}>Step 1 of 4</Text>
        <Text style={styles.headline}>How do you identify?</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="@yourname"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          value={username}
          onChangeText={checkUsername}
        />
        {usernameHint ? <Text style={[styles.hint, usernameAvailable ? styles.hintGood : styles.hintBad]}>{usernameHint}</Text> : null}

        <Text style={styles.label}>Display name</Text>
        <TextInput
          style={styles.input}
          placeholder="How you'll appear"
          placeholderTextColor={colors.textMuted}
          value={displayName}
          onChangeText={setDisplayName}
        />

        <Text style={styles.label}>Identity</Text>
        <ChipSelector options={IDENTITY_LABELS} selected={labels} onToggle={(v) => setLabels((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} />

        <Text style={[styles.label, { marginTop: 16 }]}>Pronouns</Text>
        <ChipSelector options={PRONOUNS} selected={pronouns} onToggle={(v) => setPronouns((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} />

        {(() => {
          const canProceed = usernameAvailable === true && displayName.trim().length > 0 && labels.length > 0;
          return (
            <TouchableOpacity
              style={[styles.btn, (!canProceed || loading) && styles.btnDisabled]}
              onPress={handleNext}
              disabled={!canProceed || loading}
            >
              <Text style={styles.btnText}>{loading ? 'Saving...' : 'Next →'}</Text>
            </TouchableOpacity>
          );
        })()}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

