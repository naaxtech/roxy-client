import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { RoxyWordmark } from '../../components/ui/RoxyWordmark';
import { useAuth } from '../../hooks/useAuth';
import { useThemeColors } from '../../hooks/useThemeColors';
import { supabase } from '../../lib/supabase';
import {
  parseRecoveryParams,
  initialRecoveryUrl,
  isRecoverySessionGone,
} from '../../lib/passwordReset';
import { logError } from '../../lib/errorLogger';
import { BRAND_GRADIENT } from '../../lib/theme';

const MIN_PASSWORD_LENGTH = 6;

/**
 * How long native waits for a deep link before calling it absent. Long enough
 * for a cold start to deliver one, short enough that a warm resume that will
 * never deliver one does not read as a hang.
 */
const NATIVE_LINK_DEADLINE_MS = 4000;

const EXPIRED_COPY =
  'This link has expired or has already been used. Reset links are good for one hour and one visit — ask for a fresh one and it will land in your inbox.';
const NO_TOKEN_COPY =
  'Open this screen from the link in your reset email. That link is what proves the account is yours.';

type Phase = 'verifying' | 'ready' | 'saving' | 'done' | 'invalid';

/**
 * Take the recovery tokens out of the address bar.
 *
 * Idempotent and called more than once on purpose — see the call sites. A live
 * access token left in browser history is a credential anyone with the back
 * button can replay.
 */
function clearTokenFromUrl(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (!window.location.hash && !window.location.search) return;
  window.history.replaceState(null, '', window.location.pathname);
}

/**
 * The screen the reset email lands on.
 *
 * It exists because the flow had no destination at all: `resetPasswordForEmail`
 * was sent with no `redirectTo`, so GoTrue used the project's Site URL — which
 * on a default Supabase project is `http://localhost:3000`. Pointing the email
 * somewhere real is only half the fix; the token still has to be consumed and
 * a new password still has to be typed somewhere. That is this file.
 *
 * `lib/supabase.ts` deliberately runs with `detectSessionInUrl: false`, so the
 * tokens in the URL are nobody's business but this screen's — it reads them
 * itself and calls `setSession` once.
 */
export default function ResetPasswordScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { updatePassword, beginRecoverySession } = useAuth();

  // Native delivers the deep link through this hook. `lateNativeUrl` is the
  // getInitialURL() fallback below, for the resume where the hook's listener
  // mounted after the event had already been dispatched.
  const hookUrl = Linking.useURL();
  const [lateNativeUrl, setLateNativeUrl] = useState<string | null>(null);
  const nativeUrl = hookUrl ?? lateNativeUrl;

  const [phase, setPhase] = useState<Phase>('verifying');
  const [problem, setProblem] = useState<string>(EXPIRED_COPY);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [focused, setFocused] = useState<'password' | 'confirm' | null>(null);

  // One consume per mount. `phase` alone could not carry this: on web
  // `Linking.useURL()` resolves a tick after mount, re-firing the effect while
  // the first setSession is still in flight and spending the token twice.
  const consumedRef = useRef(false);

  /**
   * Alive-until-unmount, NOT a per-run flag.
   *
   * The obvious `let cancelled = false` + cleanup pattern is wrong here and
   * fails silently. On web this effect runs twice — `Linking.useURL()` resolves
   * a tick after mount and changes a dependency — so React tears down run 1
   * (setting its `cancelled` to true) while run 1's setSession is still in
   * flight, and run 2 returns immediately on the consumed guard. The success
   * callback then hits `if (cancelled) return` and the screen sits on
   * "Checking your link…" forever, on a link that worked perfectly.
   */
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  /**
   * No usable token in the URL — decide between "she refreshed" and "no link".
   *
   * The fragment is stripped the moment the token is consumed, so an ordinary
   * F5 on this screen arrives looking exactly like a bare visit even though her
   * recovery session is open in storage and `updateUser` would work fine.
   * Asking supabase for the session is the only way to tell the two apart;
   * without it a refresh told her to go find an email she had already used.
   */
  const resolveWithoutToken = useCallback(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setPhase('ready');
        return;
      }
    } catch (e: unknown) {
      logError(e, 'reset_password_get_session');
    }
    setProblem(NO_TOKEN_COPY);
    setPhase('invalid');
  }, []);

  useEffect(() => {
    if (consumedRef.current) return;

    // On web this is the snapshot taken at module load, NOT a live read: by the
    // time this effect runs, expo-router has already normalised the address bar
    // and the token fragment is gone. See initialRecoveryUrl.
    const url =
      Platform.OS === 'web' ? (initialRecoveryUrl() ?? '') : (nativeUrl ?? '');

    // On native the deep link arrives a beat after mount, so an empty URL this
    // early is "not yet" — the deadline effect below decides when it becomes
    // "never", so this can never be the state she is left in.
    if (!url) {
      if (Platform.OS !== 'web') return;
      consumedRef.current = true;
      void resolveWithoutToken();
      return;
    }

    consumedRef.current = true;
    const { accessToken, refreshToken, type, errorDescription } = parseRecoveryParams(url);

    // Strip before any branch below returns. These are credentials, and the
    // rejection paths are exactly the ones where leaving a live access token
    // sitting in browser history would be least expected.
    clearTokenFromUrl();

    if (errorDescription) {
      setProblem(EXPIRED_COPY);
      setPhase('invalid');
      return;
    }

    // Both halves or nothing: a session set from an access token with no
    // refresh token expires at the first refresh, which here means mid-change.
    if (!accessToken || !refreshToken) {
      void resolveWithoutToken();
      return;
    }

    // Fail closed. A signup-confirmation link also carries a token, and `type &&
    // type !== 'recovery'` let a link with no type at all through — gate on the
    // one value that is permission, not on the absence of a wrong one.
    if (type !== 'recovery') {
      setProblem(NO_TOKEN_COPY);
      setPhase('invalid');
      return;
    }

    void beginRecoverySession(accessToken, refreshToken)
      .then(({ error }) => {
        if (!mountedRef.current) return;
        if (error) {
          logError(error, 'reset_password_set_session');
          setProblem(EXPIRED_COPY);
          setPhase('invalid');
          return;
        }
        // Again, deliberately. expo-router syncs its own navigation state into
        // history during boot, which lands AFTER this effect's first pass and
        // puts the fragment — token and all — straight back in the address bar.
        // One strip is not enough; this one runs once the router has settled.
        clearTokenFromUrl();
        setPhase('ready');
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        clearTokenFromUrl();
        logError(e, 'reset_password_set_session');
        setProblem(EXPIRED_COPY);
        setPhase('invalid');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeUrl]);

  /**
   * Native: stop waiting eventually.
   *
   * `Linking.useURL()` only reports a `url` event it was mounted for. On the
   * ordinary iOS path — tap "Forgot password", switch to Mail, tap the link,
   * the app resumes and expo-router routes here — the event has already been
   * dispatched and consumed by the time this screen mounts, and
   * `getInitialURL()` on a warm resume still returns the original launch URL.
   * Without a deadline `phase` never leaves 'verifying', and that branch is a
   * spinner with no button, no header and nothing to go back to: a dead end
   * that only a force-quit escapes.
   */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // A second source, in case the event was missed but the launch URL is real.
    void Linking.getInitialURL()
      .then((initial) => {
        if (initial && !consumedRef.current) setLateNativeUrl(initial);
      })
      .catch(() => {});

    const timer = setTimeout(() => {
      if (consumedRef.current) return;
      consumedRef.current = true;
      void resolveWithoutToken();
    }, NATIVE_LINK_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [resolveWithoutToken]);

  const handleSave = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setFormError('Those two do not match.');
      return;
    }
    setFormError(null);
    setPhase('saving');
    const { error } = await updatePassword(password);
    if (error) {
      // A dead session is not a bad password. Keeping her on the form with
      // GoTrue's literal "Auth session missing!" under a password field points
      // her at the one thing that was never wrong, and the form has no route
      // back to requesting a fresh link — only the invalid phase does.
      if (isRecoverySessionGone(error)) {
        setProblem(EXPIRED_COPY);
        setPhase('invalid');
        return;
      }
      // Never celebrate over an unchecked write — GoTrue rejects a password
      // identical to the old one, and she has to be told that, not thanked.
      setFormError(error.message);
      setPhase('ready');
      return;
    }
    setPhase('done');
  };

  const styles = StyleSheet.create({
    container: { flex: 1 },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, justifyContent: 'flex-end' },
    hero: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      minHeight: 160,
    },
    logoPlate: {
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderRadius: 32,
      paddingHorizontal: 34,
      paddingVertical: 18,
      shadowColor: '#7A0E45',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.28,
      shadowRadius: 30,
      elevation: 14,
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 24,
      paddingTop: 24,
      paddingBottom: 20,
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
    title: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    body: {
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 8,
      lineHeight: 21,
    },
    inputLabel: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
      marginBottom: 6,
      marginLeft: 2,
    },
    inputRow: { position: 'relative', justifyContent: 'center' },
    input: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingRight: 52,
      paddingVertical: 14,
      color: colors.textPrimary,
      fontSize: 16,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    inputFocused: { borderColor: colors.roxy },
    revealBtn: {
      position: 'absolute',
      right: 6,
      height: 44,
      width: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btn: {
      minHeight: 52,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    btnDisabled: { opacity: 0.6 },
    btnGradText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
    link: {
      color: colors.roxy,
      fontWeight: '700',
      textAlign: 'center',
      paddingVertical: 12,
      fontSize: 15,
    },
    errorText: {
      // errorInk, not error: the fill measures 3.98:1 on surfaceLight and this
      // is body text. See the pair's note in lib/theme.ts.
      color: colors.errorInk,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    statusIcon: { alignSelf: 'center', marginBottom: 4 },
    verifyingWrap: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  });

  const busy = phase === 'saving';

  const sheetContent = () => {
    if (phase === 'verifying') {
      return (
        <View style={styles.verifyingWrap} testID="reset-verifying">
          <ActivityIndicator color={colors.roxy} />
          <Text style={styles.body}>Checking your link…</Text>
        </View>
      );
    }

    if (phase === 'invalid') {
      return (
        <View testID="reset-invalid">
          <Ionicons
            name="alert-circle-outline"
            size={40}
            color={colors.textMuted}
            style={styles.statusIcon}
          />
          <Text style={styles.title}>That link is no longer good</Text>
          <Text style={styles.body}>{problem}</Text>
          <TouchableOpacity
            onPress={() => router.replace('/(auth)/welcome')}
            accessibilityRole="button"
            accessibilityLabel="Back to sign in to request a new reset link"
          >
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.btn}
            >
              <Text style={styles.btnGradText}>Send me a new link</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      );
    }

    if (phase === 'done') {
      return (
        <View testID="reset-done">
          <Ionicons
            name="checkmark-circle"
            size={40}
            color={colors.roxy}
            style={styles.statusIcon}
          />
          <Text style={styles.title}>Password changed</Text>
          <Text style={styles.body}>
            You are signed in on this device. The old password no longer works anywhere.
          </Text>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)/feed')}
            accessibilityRole="button"
            accessibilityLabel="Continue into Roxy"
          >
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.btn}
            >
              <Text style={styles.btnGradText}>Continue</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View testID="reset-form">
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.body}>
          At least {MIN_PASSWORD_LENGTH} characters. Make it one you have not used anywhere else.
        </Text>

        <Text style={styles.inputLabel}>New password</Text>
        <View style={styles.inputRow}>
          <TextInput
            testID="reset-password-input"
            style={[styles.input, focused === 'password' && styles.inputFocused]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="New password"
            editable={!busy}
            onFocus={() => setFocused('password')}
            onBlur={() => setFocused(null)}
          />
          <TouchableOpacity
            style={styles.revealBtn}
            onPress={() => setReveal((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
          >
            <Ionicons
              name={reveal ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        <Text style={[styles.inputLabel, { marginTop: 12 }]}>Type it again</Text>
        <View style={styles.inputRow}>
          <TextInput
            testID="reset-confirm-input"
            style={[styles.input, focused === 'confirm' && styles.inputFocused]}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Confirm new password"
            editable={!busy}
            onFocus={() => setFocused('confirm')}
            onBlur={() => setFocused(null)}
            onSubmitEditing={() => void handleSave()}
            returnKeyType="done"
          />
        </View>

        {formError && (
          <Text style={[styles.errorText, { marginTop: 10 }]} testID="reset-error">
            {formError}
          </Text>
        )}

        <TouchableOpacity
          testID="reset-submit-btn"
          onPress={() => void handleSave()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel="Save new password"
        >
          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.btn, busy && styles.btnDisabled]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnGradText}>Save new password</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <LinearGradient
      colors={BRAND_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
      testID="reset-password-screen"
    >
      <SafeAreaView style={styles.flex} edges={['top']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <View style={styles.hero}>
              <View style={styles.logoPlate}>
                <RoxyWordmark variant="primary" height={64} />
              </View>
            </View>
            <View style={styles.sheet}>
              <View style={styles.grabber} />
              {sheetContent()}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
