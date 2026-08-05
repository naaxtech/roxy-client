import { useRef, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Animated, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { RoxyWordmark } from '../../components/ui/RoxyWordmark';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useGateStore, CODE_MESSAGES } from '../../store/gateStore';
import { normaliseInviteCode, INVITE_CODE_LENGTH } from '../../lib/inviteCode';

const BRAND_GRADIENT = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;

export default function CodeGateScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [code, setCode] = useState('');
  const [focused, setFocused] = useState(false);
  const { validateCode, checking, codeError, validatedCommunityName, clearCode } = useGateStore();

  const heroAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(heroAnim, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [heroAnim]);

  const compact = height < 760;

  // 'unavailable' means we never reached the server, so the code was never
  // judged. Outlining the field in red would contradict the message sitting
  // right under it, which tells her the code is fine.
  const codeWasRejected = codeError !== null && codeError !== 'unavailable';

  const handleSubmit = async () => {
    if (code.length < 4 || checking) return;
    const ok = await validateCode(code);
    if (ok) router.push('/(auth)/welcome');
  };

  const styles = StyleSheet.create({
    container: { flex: 1 },
    flex: { flex: 1 },
    hero: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 32, minHeight: compact ? 120 : 200,
    },
    logoPlate: {
      backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 32,
      paddingHorizontal: 34, paddingVertical: compact ? 14 : 22,
      shadowColor: '#7A0E45', shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.28, shadowRadius: 30, elevation: 14,
    },
    tagline: {
      fontSize: 17, fontWeight: '600', color: 'rgba(255,255,255,0.95)',
      marginTop: 16, letterSpacing: 0.2, textAlign: 'center',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, gap: 14,
      shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.15, shadowRadius: 16, elevation: 16,
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
      backgroundColor: colors.surface, borderRadius: 14,
      paddingHorizontal: 16, paddingVertical: 16,
      color: colors.textPrimary, fontSize: 22, fontWeight: '800',
      letterSpacing: 6, textAlign: 'center',
      borderWidth: 1.5, borderColor: 'transparent',
    },
    inputFocused: { borderColor: colors.roxy },
    inputError: { borderColor: '#E5484D' },
    errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 4 },
    errorText: { color: '#E5484D', fontSize: 13, lineHeight: 18, flex: 1 },
    okRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 4, justifyContent: 'center',
    },
    okText: { color: colors.roxy, fontSize: 13, fontWeight: '700' },
    btn: {
      minHeight: 52, borderRadius: 16, alignItems: 'center',
      justifyContent: 'center', flexDirection: 'row', gap: 10,
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
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
    <LinearGradient
      colors={BRAND_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
      testID="code-gate-screen"
    >
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Animated.View
          style={[styles.hero, {
            opacity: heroAnim,
            transform: [{ translateY: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }]}
        >
          <View style={styles.logoPlate}>
            <RoxyWordmark variant="primary" height={compact ? 60 : 88} />
          </View>
          {!compact && <Text style={styles.tagline}>Invite only. On purpose.</Text>}
        </Animated.View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheet}>
            <View style={styles.grabber} />

            <Text style={styles.title}>Enter your Roxy code</Text>
            <Text style={styles.body}>
              Every member is invited by a community that vouches for her. That&apos;s how we
              keep this place safe.
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

            {codeError && (
              <View style={styles.errorRow} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={16} color="#E5484D" />
                <Text style={styles.errorText}>{CODE_MESSAGES[codeError]}</Text>
              </View>
            )}

            {validatedCommunityName && !codeError && (
              <View style={styles.okRow} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle" size={16} color={colors.roxy} />
                <Text style={styles.okText}>Invited by {validatedCommunityName}</Text>
              </View>
            )}

            <TouchableOpacity
              testID="code-submit"
              onPress={handleSubmit}
              disabled={code.length < 4 || checking}
              accessibilityLabel="Continue with this code"
            >
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.btn, (code.length < 4 || checking) && styles.btnDisabled]}
              >
                {checking
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={styles.btnText}>Continue</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/(auth)/welcome')}
              testID="already-have-account"
            >
              <Text style={styles.link}>I already have an account</Text>
            </TouchableOpacity>

            <View style={styles.explainer}>
              <Text style={styles.explainerTitle}>Don&apos;t have a code?</Text>
              <Text style={styles.explainerBody}>
                Codes come from communities already on Roxy. If you know someone here, ask
                her. If you don&apos;t, roxyhq.com has a form to request one.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
