import { useEffect, useRef, useState } from 'react';
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
  Animated,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { RoxyWordmark } from '../../components/ui/RoxyWordmark';
import { useAuth } from '../../hooks/useAuth';
import { useThemeColors } from '../../hooks/useThemeColors';

// Roxy brand gradient — same 3 stops as the Grow hero card.
const BRAND_GRADIENT = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;

export default function WelcomeScreen() {
  const colors = useThemeColors();
  const { height } = useWindowDimensions();
  const [showEmail, setShowEmail] = useState(false);
  const [isSignIn, setIsSignIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { signUp, signInWithPassword, resetPassword, signInWithApple, signInWithGoogle } = useAuth();

  // Gentle entrance: logo fades/rises once on mount (200ms-class micro-motion).
  const heroAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(heroAnim, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [heroAnim]);

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

  const compactHero = showEmail && height < 760;

  const styles = StyleSheet.create({
    container: { flex: 1 },
    flex: { flex: 1 },
    // Decorative blobs — depth on the gradient without competing with content.
    blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)' },
    blobA: { width: 260, height: 260, top: -80, right: -70 },
    blobB: { width: 180, height: 180, top: 140, left: -90, backgroundColor: 'rgba(255,255,255,0.07)' },
    blobC: { width: 120, height: 120, top: 60, right: 40, backgroundColor: 'rgba(26,10,46,0.10)' },

    hero: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      minHeight: compactHero ? 120 : 220,
    },
    tagline: {
      fontSize: 17,
      fontWeight: '600',
      color: 'rgba(255,255,255,0.95)',
      marginTop: 10,
      letterSpacing: 0.2,
      textAlign: 'center',
    },

    // Bottom sheet card that carries all auth actions.
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 12,
      gap: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.15,
      shadowRadius: 16,
      elevation: 16,
    },
    grabber: {
      alignSelf: 'center',
      width: 44,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textMuted + '40',
      marginBottom: 4,
    },

    btn: {
      minHeight: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 10,
    },
    btnApple: { backgroundColor: '#000000' },
    btnAppleText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
    btnGoogle: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.textMuted + '30',
    },
    btnGoogleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    btnDisabled: { opacity: 0.6 },
    btnGradText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },

    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 },
    dividerLine: { flex: 1, height: 1, backgroundColor: colors.textMuted + '30' },
    dividerText: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },

    emailLink: {
      color: colors.roxy,
      fontWeight: '700',
      textAlign: 'center',
      paddingVertical: 12,
      fontSize: 15,
    },
    forgotLink: {
      color: colors.primary,
      textAlign: 'right',
      fontSize: 14,
      fontWeight: '600',
      paddingVertical: 4,
    },
    inputLabel: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
      marginBottom: 6,
      marginLeft: 2,
    },
    input: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 14,
      color: colors.textPrimary,
      fontSize: 16,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    inputFocused: { borderColor: colors.roxy },

    sentTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    sentBody: {
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 21,
    },
    privacy: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
      marginTop: 6,
      marginBottom: 4,
    },
  });

  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);

  return (
    <LinearGradient
      colors={BRAND_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
      testID="welcome-screen"
    >
      <View style={[styles.blob, styles.blobA]} pointerEvents="none" />
      <View style={[styles.blob, styles.blobB]} pointerEvents="none" />
      <View style={[styles.blob, styles.blobC]} pointerEvents="none" />

      <SafeAreaView style={styles.flex} edges={['top']}>
        <Animated.View
          style={[
            styles.hero,
            {
              opacity: heroAnim,
              transform: [{
                translateY: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
              }],
            },
          ]}
        >
          <RoxyWordmark variant="white" height={compactHero ? 64 : 96} />
          {!compactHero && (
            <Text style={styles.tagline}>Your community. Your story.</Text>
          )}
        </Animated.View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
            <View style={styles.grabber} />
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
                <TouchableOpacity
                  style={[styles.btn, styles.btnApple]}
                  onPress={signInWithApple}
                  accessibilityLabel="Continue with Apple"
                >
                  <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
                  <Text style={styles.btnAppleText}>Continue with Apple</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnGoogle]}
                  onPress={signInWithGoogle}
                  accessibilityLabel="Continue with Google"
                >
                  <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
                  <Text style={styles.btnGoogleText}>Continue with Google</Text>
                </TouchableOpacity>

                {!showEmail ? (
                  <TouchableOpacity onPress={() => setShowEmail(true)} testID="use-email-link">
                    <Text style={styles.emailLink}>Use email instead</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <View style={styles.dividerRow}>
                      <View style={styles.dividerLine} />
                      <Text style={styles.dividerText}>OR</Text>
                      <View style={styles.dividerLine} />
                    </View>

                    <View>
                      <Text style={styles.inputLabel} nativeID="email-label">Email</Text>
                      <TextInput
                        testID="email-input"
                        style={[styles.input, focusedField === 'email' && styles.inputFocused]}
                        placeholder="your@email.com"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        accessibilityLabel="Email"
                        accessibilityLabelledBy="email-label"
                        value={email}
                        onChangeText={setEmail}
                        onFocus={() => setFocusedField('email')}
                        onBlur={() => setFocusedField(null)}
                      />
                    </View>
                    <View>
                      <Text style={styles.inputLabel} nativeID="password-label">Password</Text>
                      <TextInput
                        testID="password-input"
                        style={[styles.input, focusedField === 'password' && styles.inputFocused]}
                        placeholder="Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        autoCapitalize="none"
                        autoComplete={isSignIn ? 'password' : 'new-password'}
                        accessibilityLabel="Password"
                        accessibilityLabelledBy="password-label"
                        value={password}
                        onChangeText={setPassword}
                        onFocus={() => setFocusedField('password')}
                        onBlur={() => setFocusedField(null)}
                      />
                    </View>
                    {isSignIn && (
                      <TouchableOpacity onPress={handleForgotPassword}>
                        <Text style={styles.forgotLink}>Forgot password?</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      testID="auth-submit-btn"
                      onPress={handleSubmit}
                      disabled={loading}
                      accessibilityLabel={isSignIn ? 'Sign In' : 'Sign Up'}
                    >
                      <LinearGradient
                        colors={BRAND_GRADIENT}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.btn, loading && styles.btnDisabled]}
                      >
                        {loading ? (
                          <ActivityIndicator color="#FFFFFF" />
                        ) : (
                          <Text style={styles.btnGradText}>{isSignIn ? 'Sign In' : 'Sign Up'}</Text>
                        )}
                      </LinearGradient>
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
    </LinearGradient>
  );
}
