import { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, Animated, ActivityIndicator, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { usePopIn } from '../ui/popIn';
import { useThemeColors } from '../../hooks/useThemeColors';
import { clampDonationAmount, startDonationCheckout, type DonationCadence } from '../../lib/donations';
import { showAlert } from '../../lib/confirm';

const BRAND_GRADIENT = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;
const STEP_CENTS = 500; // $5
const DEFAULT_AMOUNT_CENTS = 2000; // $20

const CADENCES: { key: DonationCadence; label: string }[] = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'one_time', label: 'One-time' },
];

function amountSuffix(cadence: DonationCadence): string {
  if (cadence === 'monthly') return ' / month';
  if (cadence === 'yearly') return ' / year';
  return '';
}

interface DonateModalProps {
  visible: boolean;
  onClose: () => void;
}

export function DonateModal({ visible, onClose }: DonateModalProps) {
  const colors = useThemeColors();
  const popStyle = usePopIn(visible);
  const [cadence, setCadence] = useState<DonationCadence>('monthly');
  const [amountCents, setAmountCents] = useState(DEFAULT_AMOUNT_CENTS);
  const [loading, setLoading] = useState(false);

  const atFloor = amountCents <= 500;
  const atCeiling = amountCents >= 100000;

  const handleDecrease = () => setAmountCents((c) => clampDonationAmount(c - STEP_CENTS));
  const handleIncrease = () => setAmountCents((c) => clampDonationAmount(c + STEP_CENTS));

  const handleDonate = async () => {
    if (loading) return;
    setLoading(true);
    const url = await startDonationCheckout(amountCents, cadence);
    setLoading(false);
    if (url) {
      Linking.openURL(url).catch(() => {
        showAlert('Could not start your donation', 'Please try again in a moment.');
      });
    } else {
      showAlert('Could not start your donation', 'Please try again in a moment.');
    }
  };

  const styles = StyleSheet.create({
    overlay: {
      flex: 1, backgroundColor: 'rgba(26,10,46,0.55)',
      alignItems: 'center', justifyContent: 'center', padding: 28,
    },
    card: {
      width: '100%', maxWidth: 360,
      backgroundColor: colors.background, borderRadius: 22,
      padding: 20, alignItems: 'center', gap: 6,
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3, shadowRadius: 24, elevation: 20,
    },
    closeBtn: { position: 'absolute', top: 12, right: 12, padding: 6 },
    title: { color: colors.textPrimary, fontWeight: '800', fontSize: 19, marginTop: 4 },
    sub: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 10, lineHeight: 18 },
    cadenceRow: {
      flexDirection: 'row', gap: 6, alignSelf: 'stretch',
      padding: 4, borderRadius: 14, backgroundColor: colors.surface, marginBottom: 16,
    },
    cadenceBtn: {
      flex: 1, minHeight: 36, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center',
    },
    cadenceBtnActive: { backgroundColor: colors.roxy },
    cadenceText: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
    cadenceTextActive: { color: '#fff' },
    stepperRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 20, marginBottom: 6,
    },
    stepBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    stepBtnDisabled: { opacity: 0.4 },
    stepBtnText: { color: colors.textPrimary, fontWeight: '800', fontSize: 20 },
    amountText: { color: colors.textPrimary, fontWeight: '800', fontSize: 32, minWidth: 140, textAlign: 'center' },
    ctaWrap: { alignSelf: 'stretch', marginTop: 14 },
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      minHeight: 50, borderRadius: 16,
    },
    ctaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
    footer: { color: colors.textMuted, fontSize: 11.5, textAlign: 'center', marginTop: 10 },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Animated.View style={[styles.card, popStyle]}>
          <Pressable onPress={() => {}}>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityLabel="Close donation dialog"
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>

            <Text style={styles.title}>Support Roxy 💜</Text>
            <Text style={styles.sub}>Roxy is built and owned by WLW. Donations keep it that way.</Text>

            <View style={styles.cadenceRow}>
              {CADENCES.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  testID={`donate-cadence-${c.key}`}
                  style={[styles.cadenceBtn, cadence === c.key && styles.cadenceBtnActive]}
                  onPress={() => setCadence(c.key)}
                  accessibilityLabel={`${c.label} donation`}
                >
                  <Text style={[styles.cadenceText, cadence === c.key && styles.cadenceTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={[styles.stepBtn, atFloor && styles.stepBtnDisabled]}
                onPress={handleDecrease}
                disabled={atFloor}
                accessibilityLabel="Decrease donation amount by $5"
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>

              <Text style={styles.amountText}>
                ${(amountCents / 100).toFixed(0)}{amountSuffix(cadence)}
              </Text>

              <TouchableOpacity
                style={[styles.stepBtn, atCeiling && styles.stepBtnDisabled]}
                onPress={handleIncrease}
                disabled={atCeiling}
                accessibilityLabel="Increase donation amount by $5"
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.ctaWrap}
              onPress={handleDonate}
              disabled={loading}
              activeOpacity={0.85}
              accessibilityLabel="Donate"
            >
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.cta}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.ctaText}>Donate 💜</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <Text style={styles.footer}>Monthly donations help the most 🌸 · Cancel anytime</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
