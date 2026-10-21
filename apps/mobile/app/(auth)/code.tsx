import { useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions,
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
import { RADII } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { PrimaryButton } from '../../components/ui/PrimaryButton';

/** G-17. The landing site's /request page takes introductions. */
export const NO_CODE_COPY = 'No code? Ask a member, or request an introduction at roxyhq.com/request';

/** The safety sentence, word for word (design direction › Onboarding). */
export const GATE_SAFETY_COPY =
  'Every member is invited by a community that vouches for her. That’s how we keep this place safe.';

/** A code cell's height: the 48 dp target plus room for the mono glyph. */
const CELL_HEIGHT = 52;
/** The code in Plex Mono at the `title` size (codes only, one job). */
const CELL_TYPE = { ...TYPE.mono, fontSize: TYPE.title.fontSize, lineHeight: TYPE.title.lineHeight };

/**
 * The invite-code gate (design direction v2 › Onboarding).
 *
 * On `ground`, no sheet: the wordmark, the safety sentence word for word, and
 * the code in IBM Plex Mono in one 8-radius cell per character, the active
 * cell outlined 2 dp in `pink`. Continue is the screen's one lipped primary and
 * waits — `raised`, `ink3` — until the code is complete.
 *
 * Judgment call: the direction draws eight cells; real codes are TEN
 * characters (migration 070's generator, `INVITE_CODE_LENGTH`; every code in
 * production is ten), so the gate shows ten cells — eight would make every
 * real code impossible to finish.
 *
 * The cells are paint over one real TextInput (`code-input`) that covers the
 * row, so typing, pasting a whole code, autofill and the e2e helpers all work
 * exactly as before; the input's own text is transparent.
 *
 * Accepted → the welcome screen (sign up or sign in). "You're in", moment 2,
 * plays once a reviewer has said yes (`welcome-in`), where the card can carry
 * her real name and the community that vouched for her.
 *
 * Omitted on purpose: the small language button the direction puts top end.
 * The language picker (M174) does not exist yet, and a button that opens
 * nothing is a dead control.
 */
export default function CodeGateScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const {
    validateCode, checking, codeError, validatedCommunityName, clearCode,
    redeemError, submitApplicationForCode,
  } = useGateStore();
  // Signed in here means her code failed after signup (G-15): she keeps her
  // account, and a new code goes straight to her application.
  const { user, signOut } = useAuth();
  const signedIn = !!user;
  const [redeeming, setRedeeming] = useState(false);

  const compact = height < 760;
  const complete = code.length === INVITE_CODE_LENGTH;

  // 'unavailable' means we never reached the server, so the code was never
  // judged. Outlining the cells in red would contradict the message sitting
  // right under them, which tells her the code is fine.
  const codeWasRejected = codeError !== null && codeError !== 'unavailable';

  const handleSubmit = async () => {
    if (!complete || checking || redeeming) return;
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

  const activeIndex = Math.min(code.length, INVITE_CODE_LENGTH - 1);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.ground },
    flex: { flex: 1 },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: compact ? 24 : 48,
      paddingBottom: 24,
      gap: 24,
    },
    brand: { alignItems: 'center', paddingVertical: compact ? 8 : 24 },
    tagline: { ...TYPE.label, color: colors.ink2, marginTop: 12, textAlign: 'center' },
    words: { gap: 8 },
    title: { ...TYPE.headline, color: colors.ink },
    body: { ...TYPE.body, color: colors.ink2 },
    cellsWrap: { position: 'relative' },
    cells: { flexDirection: 'row', gap: 4 },
    cell: {
      flex: 1,
      height: CELL_HEIGHT,
      borderRadius: RADII.sm,
      backgroundColor: colors.raised,
      borderWidth: 2,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellActive: { borderColor: colors.pink },
    cellRejected: { borderColor: colors.danger },
    cellChar: { ...CELL_TYPE, color: colors.ink, letterSpacing: 0 },
    // The real input lies over the cells: every tap on a cell focuses it,
    // and its own text is invisible so only the cells paint the code.
    input: {
      ...StyleSheet.absoluteFillObject,
      color: 'transparent',
      backgroundColor: 'transparent',
      fontSize: CELL_TYPE.fontSize,
      opacity: 0.02,
    },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    errorText: { ...TYPE.body, color: colors.dangerInk, flex: 1 },
    okRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    okText: { ...TYPE.label, color: colors.pinkInk },
    actions: { gap: 4 },
    link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' },
    linkText: { ...TYPE.label, color: colors.pinkInk, textAlign: 'center' },
    explainer: { gap: 4, paddingTop: 8 },
    explainerTitle: { ...TYPE.label, color: colors.ink },
    explainerBody: { ...TYPE.body, color: colors.ink2 },
  });

  return (
    <View style={styles.container} testID="code-gate-screen">
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
            <View style={styles.brand}>
              <RoxyWordmark variant="primary" height={compact ? 48 : 64} />
              {!compact && <Text style={styles.tagline}>Invite only. On purpose.</Text>}
            </View>

            <View style={styles.words}>
              <Text style={styles.title} accessibilityRole="header">
                {signedIn ? 'One more step: your code' : 'Enter your Roxy code'}
              </Text>
              <Text style={styles.body}>
                {signedIn
                  ? 'Your account is safe. Enter an invite code to start your application.'
                  : GATE_SAFETY_COPY}
              </Text>
            </View>

            <View style={styles.cellsWrap}>
              <View style={styles.cells} testID="code-cells" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {Array.from({ length: INVITE_CODE_LENGTH }, (_, i) => {
                  const char = code[i] ?? '';
                  const isActive = focused && !codeWasRejected && i === activeIndex;
                  return (
                    <View
                      key={i}
                      testID={`code-cell-${i}`}
                      style={[styles.cell, isActive && styles.cellActive, codeWasRejected && styles.cellRejected]}
                    >
                      <Text style={styles.cellChar}>{char}</Text>
                    </View>
                  );
                })}
              </View>
              <TextInput
                ref={inputRef}
                testID="code-input"
                style={styles.input}
                value={code}
                onChangeText={(t) => setCode(normaliseInviteCode(t).slice(0, INVITE_CODE_LENGTH))}
                onFocus={() => { setFocused(true); if (codeError) clearCode(); }}
                onBlur={() => setFocused(false)}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                caretHidden
                maxLength={INVITE_CODE_LENGTH}
                accessibilityLabel="Roxy invite code"
                accessibilityHint="Ten characters, letters and numbers"
                onSubmitEditing={() => void handleSubmit()}
                returnKeyType="go"
              />
            </View>

            {shownError && (
              <View style={styles.errorRow} accessibilityLiveRegion="polite" testID="code-error">
                <Ionicons name="alert-circle-outline" size={20} color={colors.dangerInk} />
                <Text style={styles.errorText}>{shownError}</Text>
              </View>
            )}

            {validatedCommunityName && !codeError && (
              <View style={styles.okRow} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle-outline" size={20} color={colors.pinkInk} />
                <Text style={styles.okText}>Invited by {validatedCommunityName}</Text>
              </View>
            )}

            <View style={styles.actions}>
              <PrimaryButton
                testID="code-submit"
                label="Continue"
                onPress={() => void handleSubmit()}
                disabled={!complete}
                busy={busy}
                accessibilityLabel="Continue with this code"
                accessibilityHint={complete ? undefined : 'Enter all ten characters first'}
              />

              {signedIn ? (
                <TouchableOpacity
                  onPress={() => void signOut()}
                  testID="code-sign-out"
                  accessibilityRole="button"
                  style={styles.link}
                >
                  <Text style={styles.linkText}>Sign out</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => router.push('/(auth)/welcome')}
                  testID="already-have-account"
                  accessibilityRole="button"
                  style={styles.link}
                >
                  <Text style={styles.linkText}>I already have an account</Text>
                </TouchableOpacity>
              )}
            </View>

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
