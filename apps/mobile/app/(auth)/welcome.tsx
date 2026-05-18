import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { COLORS } from '../../lib/constants';

export default function WelcomeScreen() {
  const [showEmail, setShowEmail] = useState(false);
  const [isSignIn, setIsSignIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { signUp, signInWithPassword, resetPassword, signInWithApple, signInWithGoogle } = useAuth();

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return;
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const { error } = isSignIn
      ? await signInWithPassword(email.trim(), password)
      : await signUp(email.trim(), password);
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Enter your email', 'Please enter your email address first.');
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email.trim());
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setResetSent(true);
    }
  };

  return (
    <SafeAreaView style={styles.container} testID="welcome-screen">
      <View style={styles.hero}>
        <Text style={styles.logo}>Roxy</Text>
        <Text style={styles.tagline}>Your community. Your story.</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {resetSent ? (
          <>
            <Text style={styles.sentTitle}>Check your email</Text>
            <Text style={styles.sentBody}>
              We sent a password reset link to {email}
            </Text>
            <TouchableOpacity onPress={() => setResetSent(false)}>
              <Text style={styles.emailLink}>Back to sign in</Text>
            </TouchableOpacity>
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
              <TouchableOpacity onPress={() => setShowEmail(true)} testID="use-email-link">
                <Text style={styles.emailLink}>Use email instead</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TextInput
                  testID="email-input"
                  style={styles.input}
                  placeholder="your@email.com"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  value={email}
                  onChangeText={setEmail}
                />
                <TextInput
                  testID="password-input"
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete={isSignIn ? 'password' : 'new-password'}
                  value={password}
                  onChangeText={setPassword}
                />
                {isSignIn && (
                  <TouchableOpacity onPress={handleForgotPassword}>
                    <Text style={styles.forgotLink}>Forgot password?</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  testID="auth-submit-btn"
                  style={[styles.btn, loading && styles.btnDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                >
                  <Text style={styles.btnText}>
                    {loading ? 'Please wait...' : isSignIn ? 'Sign In' : 'Sign Up'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setIsSignIn(!isSignIn)}>
                  <Text style={styles.emailLink}>
                    {isSignIn ? 'New here? Sign Up' : 'Already have an account? Sign In'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.privacy}>
              We never share your data with third parties.
            </Text>
          </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  forgotLink: {
    color: COLORS.accent,
    textAlign: 'right',
    fontSize: 14,
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
