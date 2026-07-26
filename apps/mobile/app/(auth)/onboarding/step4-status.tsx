import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { callEdgeFunction } from '../../../lib/supabase';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { RoxyWordmark } from '../../../components/ui/RoxyWordmark';
import { logError, logBreadcrumb, hashUserId } from '../../../lib/errorLogger';
import { showAlert } from '../../../lib/confirm';

const GOALS = [
  { key: 'community', label: 'COMMUNITY', sub: 'Find your people, build connections' },
  { key: 'friendship', label: 'FRIENDSHIP', sub: 'Make real friends in the WLW community' },
  { key: 'dating', label: 'DATING', sub: 'Meet someone special', enablesDating: true },
] as const;

export default function Step4Status() {
  const colors = useThemeColors();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  const toggle = (key: string) =>
    setSelected((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key]);

  const handleFinish = async () => {
    if (!user) return;
    if (selected.length === 0) return;
    logBreadcrumb('onboarding_step4_submit', { goals: selected.join(',') });
    setLoading(true);
    const isDating = selected.includes('dating');
    const { error: profileError } = await supabase.from('profiles').update({ is_dating_mode: isDating, onboarding_completed: true }).eq('id', user.id);
    if (profileError) {
      logError(profileError, 'onboarding_step4_profile_update');
      setLoading(false);
      showAlert('Setup error', 'Could not save your settings. Please try again.');
      return;
    }
    const { error } = await callEdgeFunction('roxy-onboarding', { user_id: user.id });
    setLoading(false);
    if (error) {
      logError(new Error(String(error)), 'onboarding_step4_edge_function');
      showAlert('Setup error', 'Could not finish setup. Please try again.');
      return;
    }
    logBreadcrumb('onboarding_complete', { user_id: hashUserId(user.id) });
    router.replace('/(tabs)/grow');
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, padding: 24, gap: 12 },
    step: { color: colors.textMuted, fontSize: 13 },
    headline: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
    card: {
      backgroundColor: colors.surface, borderRadius: 16, padding: 20,
      borderWidth: 2, borderColor: 'transparent',
    },
    cardSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceLight },
    cardTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, letterSpacing: 1 },
    cardSub: { color: colors.textSecondary, marginTop: 4 },
    btn: { backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 'auto' },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <RoxyWordmark height={34} style={{ marginBottom: 10 }} />
        <Text style={styles.step}>Step 4 of 4</Text>
        <Text style={styles.headline}>What are you here for?</Text>

        {GOALS.map((g) => (
          <TouchableOpacity
            key={g.key}
            style={[styles.card, selected.includes(g.key) && styles.cardSelected]}
            onPress={() => toggle(g.key)}
          >
            <Text style={styles.cardTitle}>{g.label}</Text>
            <Text style={styles.cardSub}>{g.sub}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.btn, (loading || selected.length === 0) && styles.btnDisabled]}
          onPress={handleFinish}
          disabled={loading || selected.length === 0}
        >
          <Text style={styles.btnText}>{loading ? 'Setting up...' : 'Meet Roxy →'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

