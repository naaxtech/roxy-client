import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
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
import { useRouter } from 'expo-router';
import { RoxyWordmark } from '../../components/ui/RoxyWordmark';
import { useAuth } from '../../hooks/useAuth';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useGateStore } from '../../store/gateStore';
import { showAlert } from '../../lib/confirm';
import { BRAND_GRADIENT } from '../../lib/theme';
import { POP_FROM, SNAP_SPRING } from '../../lib/motion';
import { enabledOAuthProviders } from '../../lib/authProviders';

/** G-19: a safety app asks for more than six characters. Matches the Supabase Auth setting. */
export const MIN_PASSWORD = 10;

const OAUTH = enabledOAuthProviders();

// Roxy brand gradient — same 3 stops as the Grow hero card.

export default function WelcomeScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { validatedCode, validatedCommunityName, submitApplicationForCode } = useGateStore();
  // With no provider configured (G-03) the email form is the only way in, so
  // it is open from the start instead of hiding behind "Use email instead".
  const [showEmail, setShowEmail] = useState(OAUTH.length === 0);
  // Arriving without a code means she tapped "I already have an account" on the
  // gate, so open in sign-in mode rather than making her switch.
  const [isSignIn, setIsSignIn] = useState(!validatedCode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthPending, setOauthPending] = useState<'apple' | 'google' | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [revealPassword, setRevealPassword] = useState(false);
  const { signUp, signInWithPassword, resetPassword, signInWithApple, signInWithGoogle } = useAuth();

  const heroAnim = useRef(new Animated.Value(POP_FROM)).current;
  useEffect(() => {
    Animated.spring(heroAnim, { toValue: 1, ...SNAP_SPRING }).start();
  }, [heroAnim]);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) return;
    // Sign-in keeps accepting older, shorter passwords; only new ones are held
    // to the minimum.
    if (!isSignIn && password.length < MIN_PASSWORD) {
      showAlert('A little longer', `Use at least ${MIN_PASSWORD} characters — it keeps your account yours.`);
      return;
    }

    // Signing up without a validated code would create an account the gate can
    // never resolve — no application, no reviewer, no way in. Send her back to
    // collect one rather than stranding her.
    if (!isSignIn && !validatedCode) {
      setLoading(false);
      router.replace('/(auth)/code');
      return;
    }

    setLoading(true);
    const { error } = isSignIn
      ? await signInWithPassword(email.trim(), password)
      : await signUp(email.trim(), password);

    if (error) {
      setLoading(false);
      showAlert('Error', error.message);
      return;
    }

    if (!isSignIn) {
      // Binds the new account to the code that admitted her: this is what makes
      // every member permanently attributable to a community that vouched.
      const applicationId = await submitApplicationForCode();
      setLoading(false);
      if (!applicationId) {
        // G-15: her account exists but the code could not open an application
        // (exhausted a moment ago, expired, the network dropped). She is never
        // let in on that basis — she lands on the code screen, still signed
        // in, with the reason shown and a way to try another code.
        router.replace('/(auth)/code');
        return;
      }
      router.replace('/(auth)/application');
      return;
    }

    setLoading(false);
  };

  /**
   * Apple and Google are a single call that both signs in and signs up —
   * supabase-js creates the account on first use and offers no way to refuse.
   * An account created this way without a code lands on
   * profiles.vetting_status = 'unvetted', which migration 070 defines as the
   * grandfather state with full access: no application row, no reviewer, no
   * gate, and nothing downstream that would ever catch it. So the code has to
   * be in hand BEFORE the provider opens — the same requirement handleSubmit
   * enforces on the email signup path, applied to the only two buttons that
   * were skipping it.
   *
   * The code is deliberately NOT redeemed here. OAuth completes through a
   * redirect, so this screen is gone before a session exists to redeem it
   * against. gateStore.loadApplication() already redeems a held code when it
   * finds no application row — this guarantees the precondition that recovery
   * path depends on rather than duplicating it.
   */
  const handleOAuth = async (provider: 'apple' | 'google') => {
    if (!validatedCode) {
      router.replace('/(auth)/code');
      return;
    }
    setOauthPending(provider);
    const { error } = provider === 'apple'
      ? await signInWithApple()
      : await signInWithGoogle();
    setOauthPending(null);
    if (error) showAlert('Error', error.message);
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      showAlert('Enter your email', 'Please enter your email address first.');
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email.trim());
    setLoading(false);
    if (error) {
      showAlert('Error', error.message);
    } else {
      setResetSent(true);
    }
  };

  const compactHero = showEmail && height < 760;
  // One auth attempt at a time — two concurrent flows race to set a session.
  const busy = loading || oauthPending !== null;

  const styles = StyleSheet.create({
    container: { flex: 1 },
    flex: { flex: 1 },

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
      marginTop: 16,
      letterSpacing: 0.2,
      textAlign: 'center',
    },
    // Colored wordmark disappears straight on the brand gradient — float it
    // on a soft white plate so the brand colors stay legible.
    logoPlate: {
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderRadius: 32,
      paddingHorizontal: 34,
      paddingVertical: compactHero ? 14 : 22,
      shadowColor: '#7A0E45',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.28,
      shadowRadius: 30,
      elevation: 14,
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
    // Leaves room for the reveal button so a long password never runs under it.
    inputWithAffordance: { paddingRight: 52 },
    inputRow: { position: 'relative', justifyContent: 'center' },
    revealBtn: {
      position: 'absolute',
      right: 6,
      height: 44,
      width: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },

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
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Animated.View
          style={[
            styles.hero,
            { transform: [{ scale: heroAnim }] },
          ]}
        >
          <View style={styles.logoPlate}>
            <RoxyWordmark variant="primary" height={compactHero ? 64 : 96} />
          </View>
          {!compactHero && (
            <Text style={styles.tagline}>
              {validatedCommunityName
                ? `Invited by ${validatedCommunityName}`
                : 'Your community. Your story.'}
            </Text>
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
                {OAUTH.includes('apple') && (
                <TouchableOpacity
                  testID="oauth-apple-btn"
                  style={[styles.btn, styles.btnApple, busy && styles.btnDisabled]}
                  onPress={() => void handleOAuth('apple')}
                  disabled={busy}
                  accessibilityLabel="Continue with Apple"
                >
                  {oauthPending === 'apple' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
                      <Text style={styles.btnAppleText}>Continue with Apple</Text>
                    </>
                  )}
                </TouchableOpacity>
                )}

                {OAUTH.includes('google') && (
                <TouchableOpacity
                  testID="oauth-google-btn"
                  style={[styles.btn, styles.btnGoogle, busy && styles.btnDisabled]}
                  onPress={() => void handleOAuth('google')}
                  disabled={busy}
                  accessibilityLabel="Continue with Google"
                >
                  {oauthPending === 'google' ? (
                    <ActivityIndicator color={colors.textPrimary} />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
                      <Text style={styles.btnGoogleText}>Continue with Google</Text>
                    </>
                  )}
                </TouchableOpacity>
                )}

                {!showEmail ? (
                  <TouchableOpacity onPress={() => setShowEmail(true)} testID="use-email-link">
                    <Text style={styles.emailLink}>Use email instead</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    {OAUTH.length > 0 && (
                      <View style={styles.dividerRow}>
                        <View style={styles.dividerLine} />
                        <Text style={styles.dividerText}>OR</Text>
                        <View style={styles.dividerLine} />
                      </View>
                    )}

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
                      <View style={styles.inputRow}>
                        <TextInput
                          testID="password-input"
                          style={[
                            styles.input,
                            styles.inputWithAffordance,
                            focusedField === 'password' && styles.inputFocused,
                          ]}
                          placeholder="Password"
                          placeholderTextColor={colors.textMuted}
                          secureTextEntry={!revealPassword}
                          autoCapitalize="none"
                          autoComplete={isSignIn ? 'password' : 'new-password'}
                          accessibilityLabel="Password"
                          accessibilityLabelledBy="password-label"
                          value={password}
                          onChangeText={setPassword}
                          onFocus={() => setFocusedField('password')}
                          onBlur={() => setFocusedField(null)}
                        />
                        <TouchableOpacity
                          testID="password-reveal-btn"
                          style={styles.revealBtn}
                          onPress={() => setRevealPassword((v) => !v)}
                          accessibilityRole="button"
                          accessibilityLabel={revealPassword ? 'Hide password' : 'Show password'}
                          accessibilityState={{ selected: revealPassword }}
                          // RNW renders no aria attribute for accessibilityState,
                          // so the pressed state is emitted explicitly too.
                          aria-pressed={revealPassword}
                        >
                          <Ionicons
                            name={revealPassword ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                            color={colors.textMuted}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                    {!isSignIn && (
                      <Text style={styles.privacy} testID="password-hint">
                        At least {MIN_PASSWORD} characters.
                      </Text>
                    )}
                    {isSignIn && (
                      <TouchableOpacity
                        onPress={handleForgotPassword}
                        accessibilityRole="button"
                        accessibilityLabel="Forgot password"
                      >
                        <Text style={styles.forgotLink}>Forgot password?</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      testID="auth-submit-btn"
                      onPress={handleSubmit}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: busy, busy: loading }}
                      accessibilityLabel={isSignIn ? 'Sign In' : 'Sign Up'}
                    >
                      <LinearGradient
                        colors={BRAND_GRADIENT}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.btn, busy && styles.btnDisabled]}
                      >
                        {loading ? (
                          <ActivityIndicator color="#FFFFFF" />
                        ) : (
                          <Text style={styles.btnGradText}>{isSignIn ? 'Sign In' : 'Sign Up'}</Text>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setIsSignIn(!isSignIn)}
                      accessibilityRole="button"
                    >
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
