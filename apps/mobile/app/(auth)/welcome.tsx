import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { COLORS } from '../../lib/constants';

export default function WelcomeScreen() {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, signInWithApple, signInWithGoogle } = useAuth();

  const handleMagicLink = async () => {
    if (!email.trim()) return;
    setLoading(true);
    const { error } = await signIn(email.trim());
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>Roxy</Text>
        <Text style={styles.tagline}>Your community. Your story.</Text>
      </View>

      <View style={styles.content}>
        {sent ? (
          <>
            <Text style={styles.sentTitle}>Check your email ✉️</Text>
            <Text style={styles.sentBody}>
              We sent a magic link to {email}
            </Text>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.btn} onPress={signInWithApple}>
              <Text style={styles.btnText}> Continue with Apple</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={signInWithGoogle}
            >
              <Text style={styles.btnText}>Continue with Google</Text>
            </TouchableOpacity>

            {!showEmail ? (
              <TouchableOpacity onPress={() => setShowEmail(true)}>
                <Text style={styles.emailLink}>Use email instead</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="your@email.com"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  value={email}
                  onChangeText={setEmail}
                />
                <TouchableOpacity
                  style={[styles.btn, loading && styles.btnDisabled]}
                  onPress={handleMagicLink}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>
                    {loading ? 'Sending...' : 'Send magic link'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.privacy}>
              We never share your data with third parties.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { fontSize: 64, fontWeight: '800', color: COLORS.roxy },
  tagline: { fontSize: 18, color: COLORS.textSecondary, marginTop: 8 },
  content: { padding: 24, gap: 12 },
  btn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: COLORS.surface },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 16 },
  emailLink: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    paddingVertical: 8,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    color: COLORS.textPrimary,
    fontSize: 16,
  },
  sentTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  sentBody: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  privacy: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
