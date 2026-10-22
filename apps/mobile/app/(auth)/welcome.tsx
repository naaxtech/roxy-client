import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { TouchableOpacity } from '../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { RoxyWordmark } from '../../components/ui/RoxyWordmark';
import { useAuth } from '../../hooks/useAuth';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useGateStore } from '../../store/gateStore';
import { showAlert } from '../../lib/confirm';
import { RADII } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { POP_FROM, animatedSpring } from '../../lib/motion';
import { enabledOAuthProviders } from '../../lib/authProviders';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwordPolicy';
import { captchaRequired, captchaSiteKey } from '../../lib/captcha';
import { TurnstileWidget } from '../../components/auth/TurnstileWidget';
import { authErrorCopy } from '../../lib/authErrorCopy';

// Bot protection (lib/captcha.ts): web only, and only once a site key is set.
const NEEDS_CAPTCHA = captchaRequired(Platform.OS);
const CAPTCHA_HINT = 'One moment: finish the check below first.';

/** G-19: a safety app asks for more than six characters. Matches the Supabase Auth setting. */
export const MIN_PASSWORD = MIN_PASSWORD_LENGTH;

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
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // A Turnstile token is single-use: every attempt asks for a fresh one.
  const [captchaRound, setCaptchaRound] = useState(0);
  const { signUp, signInWithPassword, resetPassword, signInWithApple, signInWithGoogle } = useAuth();

  const heroAnim = useRef(new Animated.Value(POP_FROM)).current;
  useEffect(() => {
    Animated.spring(heroAnim, { toValue: 1, ...animatedSpring('spatial') }).start();
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

    if (NEEDS_CAPTCHA && !captchaToken) {
      showAlert('Almost', CAPTCHA_HINT);
      return;
    }

    setLoading(true);
    const { error } = isSignIn
      ? await signInWithPassword(email.trim(), password, captchaToken)
      : await signUp(email.trim(), password, captchaToken);
    if (NEEDS_CAPTCHA) setCaptchaRound((n) => n + 1);

    if (error) {
      setLoading(false);
      const copy = authErrorCopy(error);
      showAlert(copy.title, copy.body);
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
    if (NEEDS_CAPTCHA && !captchaToken) {
      showAlert('Almost', CAPTCHA_HINT);
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email.trim(), captchaToken);
    if (NEEDS_CAPTCHA) setCaptchaRound((n) => n + 1);
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
    container: { flex: 1, backgroundColor: colors.ground },
    flex: { flex: 1 },

    hero: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      minHeight: compactHero ? 120 : 220,
    },
    tagline: { ...TYPE.label, color: colors.ink2, marginTop: 12, textAlign: 'center' },
    // v2: the wordmark sits straight on `ground`; the brand gradient lives in
    // the wordmark itself, so it needs no plate or glow.
    logoPlate: {
      paddingHorizontal: 34,
      paddingVertical: compactHero ? 14 : 22,
    },

    // v2 (direction › Onboarding): the form sits on `ground` like the code
    // gate — no sheet, no grabber that suggests a drag that does nothing.
    sheet: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 16,
      gap: 12,
    },
    welcomeBack: { ...TYPE.headline, color: colors.ink, marginBottom: 4 },

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

    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 },
    dividerLine: { flex: 1, height: 1, backgroundColor: colors.textMuted + '30' },
    dividerText: { ...TYPE.meta, color: colors.ink3 },

    emailLink: {
      ...TYPE.label,
      color: colors.pinkInk,
      textAlign: 'center',
      paddingVertical: 14,
    },
    forgotLink: {
      ...TYPE.label,
      color: colors.pinkInk,
      textAlign: 'right',
      paddingVertical: 14,
    },
    inputLabel: {
      ...TYPE.label,
      color: colors.ink2,
      marginBottom: 6,
    },
    input: {
      ...TYPE.body,
      backgroundColor: colors.raised,
      borderRadius: RADII.sm,
      paddingHorizontal: 16,
      minHeight: MIN_TOUCH_TARGET + 4,
      color: colors.ink,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    inputFocused: { borderColor: colors.pink },
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

    sentTitle: { ...TYPE.title, color: colors.ink, textAlign: 'center' },
    sentBody: { ...TYPE.body, color: colors.ink2, textAlign: 'center', marginTop: 8 },
    privacy: { ...TYPE.meta, color: colors.ink3, textAlign: 'center', marginTop: 6, marginBottom: 4 },
  });

  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);

  return (
    <View style={styles.container} testID="welcome-screen">
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
                {/* Returning members (direction › Onboarding). */}
                {isSignIn ? (
                  <Text style={styles.welcomeBack} testID="welcome-back" accessibilityRole="header">
                    Welcome back.
                  </Text>
                ) : null}
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
                        <Text style={styles.dividerText}>or</Text>
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
                    <TurnstileWidget
                      siteKey={NEEDS_CAPTCHA ? captchaSiteKey() : null}
                      onToken={setCaptchaToken}
                      resetKey={captchaRound}
                    />
                    <PrimaryButton
                      testID="auth-submit-btn"
                      // Sentence case on screen; the accessibility label keeps
                      // 'Sign In' / 'Sign Up', which the auth e2e helper asserts.
                      label={isSignIn ? 'Sign in' : 'Sign up'}
                      onPress={handleSubmit}
                      disabled={busy}
                      busy={loading}
                      accessibilityLabel={isSignIn ? 'Sign In' : 'Sign Up'}
                    />
                    <TouchableOpacity
                      onPress={() => setIsSignIn(!isSignIn)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.emailLink}>
                        {isSignIn ? 'New here? Sign up' : 'Already have an account? Sign in'}
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
    </View>
  );
}
