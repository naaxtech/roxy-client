import { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { logError, logBreadcrumb } from '../../../lib/errorLogger';
import { ChipSelector } from '../../../components/ui/ChipSelector';
import { INTERESTS, COLORS } from '../../../lib/constants';

export default function Step2Interests() {
  const [interests, setInterests] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  const handleNext = async () => {
    if (!user) return;
    if (interests.length < 1) return;
    logBreadcrumb('onboarding_step2_submit', { interest_count: String(interests.length) });
    setLoading(true);
    const { error } = await supabase.from('profiles').update({ interests }).eq('id', user.id);
    setLoading(false);
    if (error) {
      logError(error, 'onboarding_step2_update');
      Alert.alert('Error', 'Could not save your interests. Please try again.');
      return;
    }
    logBreadcrumb('onboarding_step2_complete');
    router.replace('/(auth)/onboarding/step3-photo');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.step}>Step 2 of 4</Text>
        <Text style={styles.headline}>What lights you up?</Text>
        <Text style={styles.sub}>Pick up to 8</Text>
        <ChipSelector options={INTERESTS} selected={interests} max={8}
          onToggle={(v) => setInterests((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} />
        <TouchableOpacity
          style={[styles.btn, (loading || interests.length < 1) && styles.btnDisabled]}
          onPress={handleNext}
          disabled={loading || interests.length < 1}
        >
          <Text style={styles.btnText}>{loading ? 'Saving...' : 'Next →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 24, gap: 12 },
  step: { color: COLORS.textMuted, fontSize: 13 },
  headline: { fontSize: 28, fontWeight: '700', color: COLORS.textPrimary },
  sub: { color: COLORS.textSecondary, fontSize: 14 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
});
