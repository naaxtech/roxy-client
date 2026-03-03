import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { ChipSelector } from '../../../components/ui/ChipSelector';
import { IDENTITY_LABELS, PRONOUNS, COLORS } from '../../../lib/constants';

export default function Step1Identity() {
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
    if (val.length < 3 || !/^[a-z0-9_]+$/i.test(val)) {
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
    if (!usernameAvailable || !displayName || labels.length === 0) return;
    setLoading(true);
    const { error } = await supabase.from('profiles').upsert({
      id: user!.id,
      username: username.toLowerCase(),
      display_name: displayName,
      identity_labels: labels,
      pronouns,
    });
    setLoading(false);
    if (error) { Alert.alert('Error', error.message); return; }
    router.push('/(auth)/onboarding/step2-interests');
  };

  const usernameHint = username.length < 3 ? '' : usernameAvailable === true ? '✓ Available' : usernameAvailable === false ? '✗ Taken' : '';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.step}>Step 1 of 4</Text>
        <Text style={styles.headline}>How do you identify?</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="@yourname"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          value={username}
          onChangeText={checkUsername}
        />
        {usernameHint ? <Text style={[styles.hint, usernameAvailable ? styles.hintGood : styles.hintBad]}>{usernameHint}</Text> : null}

        <Text style={styles.label}>Display name</Text>
        <TextInput
          style={styles.input}
          placeholder="How you'll appear"
          placeholderTextColor={COLORS.textMuted}
          value={displayName}
          onChangeText={setDisplayName}
        />

        <Text style={styles.label}>Identity</Text>
        <ChipSelector options={IDENTITY_LABELS} selected={labels} onToggle={(v) => setLabels((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} />

        <Text style={[styles.label, { marginTop: 16 }]}>Pronouns</Text>
        <ChipSelector options={PRONOUNS} selected={pronouns} onToggle={(v) => setPronouns((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} />

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleNext}
          disabled={loading}
        >
          <Text style={styles.btnText}>{loading ? 'Saving...' : 'Next →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 24, gap: 8 },
  step: { color: COLORS.textMuted, fontSize: 13 },
  headline: { fontSize: 28, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 16 },
  label: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600', marginTop: 12 },
  input: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, color: COLORS.textPrimary, fontSize: 16 },
  hint: { fontSize: 12, marginTop: 2 },
  hintGood: { color: COLORS.success },
  hintBad: { color: COLORS.error },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
});
