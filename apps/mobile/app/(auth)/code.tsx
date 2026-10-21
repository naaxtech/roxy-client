import { useRef, useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Animated, useWindowDimensions,
} from 'react-native';
import { TouchableOpacity } from '../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { RoxyWordmark } from '../../components/ui/RoxyWordmark';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useGateStore, CODE_MESSAGES, REDEEM_MESSAGES } from '../../store/gateStore';
import { normaliseInviteCode, INVITE_CODE_LENGTH } from '../../lib/inviteCode';
import { popElevation } from '../../lib/theme';
import { FONTS } from '../../lib/typography';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { POP_FROM, animatedSpring } from '../../lib/motion';

/** G-17. The landing site's /request page takes introductions. */
export const NO_CODE_COPY = 'No code? Ask a member, or request an introduction at roxyhq.com/request';

export default function CodeGateScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const {
    validateCode, checking, codeError, validatedCommunityName, clearCode,
    redeemError, submitApplicationForCode,
  } = useGateStore();
  // Signed in here means her code failed after signup (G-15): she keeps her
  // account, and a new code goes straight to her application.
  const { user, signOut } = useAuth();
  const signedIn = !!user;
  const [redeeming, setRedeeming] = useState(false);

  const heroAnim = useRef(new Animated.Value(POP_FROM)).current;
  useEffect(() => {
    Animated.spring(heroAnim, { toValue: 1, ...animatedSpring('spatial') }).start();
  }, [heroAnim]);

  const compact = height < 760;

  // 'unavailable' means we never reached the server, so the code was never
  // judged. Outlining the field in red would contradict the message sitting
  // right under it, which tells her the code is fine.
  const codeWasRejected = codeError !== null && codeError !== 'unavailable';

  const handleSubmit = async () => {
    if (code.length < 4 || checking || redeeming) return;
    const ok = await validateCode(code);
    if (!ok) return;
    if (!signedIn) {
      router.push('/(auth)/welcome');
      return;
    }
    setRedeeming(true);
    const applicationId = await submitApplicationForCode();
    setRedeeming(false);
    if (applicationId) router.replace('/(auth)/application');
  };
  const busy = checking || redeeming;
  // A redemption failure from signup (or from the line above) is shown here,
  // in words she can act on. A validation error outranks it once she types.
  const shownError = codeError ? CODE_MESSAGES[codeError] : redeemError ? REDEEM_MESSAGES[redeemError] : null;

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.ground },
    flex: { flex: 1 },
    hero: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 32, minHeight: compact ? 120 : 200,
    },
    // v2: the wordmark sits straight on `ground` — the brand gradient lives
    // in the wordmark itself, so it needs no plate or glow.
    logoPlate: {
      paddingHorizontal: 34, paddingVertical: compact ? 14 : 22,
    },
    tagline: {
      fontSize: 17, fontWeight: '600', color: colors.textSecondary,
      marginTop: 16, textAlign: 'center',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, gap: 14,
      ...popElevation(colors),
    },
    grabber: {
      alignSelf: 'center', width: 44, height: 4, borderRadius: 2,
      backgroundColor: colors.textMuted + '40', marginBottom: 2,
    },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    body: {
      color: colors.textSecondary, textAlign: 'center',
      fontSize: 14, lineHeight: 20, marginBottom: 2,
    },
    input: {
      backgroundColor: colors.raised, borderRadius: 8,
      paddingHorizontal: 16, paddingVertical: 16,
      color: colors.textPrimary, fontSize: 22, fontFamily: FONTS.mono.medium,
      letterSpacing: 6, textAlign: 'center',
      borderWidth: 1.5, borderColor: 'transparent',
    },
    inputFocused: { borderColor: colors.roxy },
    inputError: { borderColor: colors.error },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 4 },
    errorText: { color: colors.errorInk, fontSize: 13, lineHeight: 18, flex: 1 },
    okRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 4, justifyContent: 'center',
    },
    okText: { color: colors.roxy, fontSize: 13, fontWeight: '700' },
    link: {
      color: colors.roxy, fontWeight: '700', textAlign: 'center',
      paddingVertical: 10, fontSize: 15,
    },
    explainer: {
      backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 6,
    },
    explainerTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
    explainerBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  });

  return (
    <View style={styles.container} testID="code-gate-screen">
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Animated.View
          style={[styles.hero, { transform: [{ scale: heroAnim }] }]}
        >
          <View style={styles.logoPlate}>
            <RoxyWordmark variant="primary" height={compact ? 60 : 88} />
          </View>
          {!compact && <Text style={styles.tagline}>Invite only. On purpose.</Text>}
        </Animated.View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
            <View style={styles.grabber} />

            <Text style={styles.title} accessibilityRole="header">
              {signedIn ? 'One more step: your code' : 'Enter your Roxy code'}
            </Text>
            <Text style={styles.body}>
              {signedIn
                ? 'Your account is safe. Enter an invite code to start your application.'
                : 'Every member is invited by a community that vouches for her. That\u2019s how we keep this place safe.'}
            </Text>

            <TextInput
              testID="code-input"
              style={[
                styles.input,
                focused && styles.inputFocused,
                codeWasRejected && styles.inputError,
              ]}
              placeholder="XXXXXXXXXX"
              placeholderTextColor={colors.textMuted}
              value={code}
              onChangeText={(t) => setCode(normaliseInviteCode(t).slice(0, INVITE_CODE_LENGTH))}
              onFocus={() => { setFocused(true); if (codeError) clearCode(); }}
              onBlur={() => setFocused(false)}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              maxLength={INVITE_CODE_LENGTH}
              accessibilityLabel="Roxy invite code"
              accessibilityHint="Ten characters, letters and numbers"
              onSubmitEditing={handleSubmit}
              returnKeyType="go"
            />

            {shownError && (
              <View style={styles.errorRow} accessibilityLiveRegion="polite" testID="code-error">
                <Ionicons name="alert-circle" size={16} color={colors.errorInk} />
                <Text style={styles.errorText}>{shownError}</Text>
              </View>
            )}

            {validatedCommunityName && !codeError && (
              <View style={styles.okRow} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle" size={16} color={colors.roxy} />
                <Text style={styles.okText}>Invited by {validatedCommunityName}</Text>
              </View>
            )}

            <PrimaryButton
              testID="code-submit"
              label="Continue"
              onPress={handleSubmit}
              disabled={code.length < 4}
              busy={busy}
              accessibilityLabel="Continue with this code"
            />

            {signedIn ? (
              <TouchableOpacity
                onPress={() => void signOut()}
                testID="code-sign-out"
                accessibilityRole="button"
              >
                <Text style={styles.link}>Sign out</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => router.push('/(auth)/welcome')}
                testID="already-have-account"
                accessibilityRole="button"
              >
                <Text style={styles.link}>I already have an account</Text>
              </TouchableOpacity>
            )}

            <View style={styles.explainer}>
              <Text style={styles.explainerTitle}>Don&apos;t have a code?</Text>
              {/* G-17: one honest path, matching the landing page. */}
              <Text style={styles.explainerBody} testID="no-code-copy">
                {NO_CODE_COPY}
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
