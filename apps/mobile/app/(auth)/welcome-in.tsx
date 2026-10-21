import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { TouchableOpacity } from '../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { BRAND_GRADIENT, inkOnGradient, RADII } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { celebrate } from '../../lib/haptics';
import { fetchAdmissionCommunity, markWelcomeSeen } from '../../lib/welcomeIn';
import { FirstStepsCard } from '../../components/account/FirstStepsCard';

/** Petal colours: the brand ramp plus the social lilac and the gold — tokens only. */
const PETAL_COUNT = 18;

/**
 * One confetti petal. Falls from above the hero with a little sway and spin.
 * Positions are deterministic per index so the burst looks designed, not noisy.
 */
function Petal({ index, width, color, reduced }: {
  index: number; width: number; color: string; reduced: boolean;
}) {
  const fall = useSharedValue(reduced ? 1 : 0);
  const x = ((index * 37) % 100) / 100 * width;
  const drift = ((index % 5) - 2) * 14;
  const size = 8 + (index % 3) * 3;
  const delay = (index % 6) * 70;

  useEffect(() => {
    if (reduced) return;
    fall.value = withDelay(delay, withTiming(1, { duration: 1600 + (index % 4) * 220, easing: Easing.out(Easing.quad) }));
  }, [fall, delay, index, reduced]);

  const style = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : 1 - fall.value * 0.85,
    transform: [
      { translateY: -40 + fall.value * 360 },
      { translateX: drift * fall.value },
      { rotate: `${fall.value * (index % 2 ? 260 : -220)}deg` },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: 0, left: x, width: size, height: size * 1.6, borderRadius: size, backgroundColor: color },
        style,
      ]}
    />
  );
}

/**
 * "You're in" (G-11). Shown once, the first time a freshly approved member
 * lands in the app (useWelcomeInRedirect). The moment a reviewer said yes is
 * the warmest one she will ever have in Roxy — this screen is for that, and
 * then for the four small steps that turn a yes into a first conversation.
 */
export default function WelcomeInScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const name = useProfileStore((s) => s.profile?.display_name?.trim() || '');
  const [communityName, setCommunityName] = useState<string | null>(null);
  // The party first, then the four small steps. One screen, two beats.
  const [phase, setPhase] = useState<'party' | 'steps'>('party');

  const pop = useSharedValue(reduced ? 1 : 0.6);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  useEffect(() => {
    // Springy, one small overshoot; Reduce Motion lands it still.
    if (!reduced) pop.value = withSpring(1, { damping: 9, stiffness: 160, mass: 0.8 });
    else pop.value = 1;
    celebrate(reduced);
  }, [pop, reduced]);

  useEffect(() => {
    if (!userId) return;
    void markWelcomeSeen(userId);
    let cancelled = false;
    void fetchAdmissionCommunity(userId).then((c) => {
      if (!cancelled && c) setCommunityName(c.name);
    });
    return () => { cancelled = true; };
  }, [userId]);

  const heroInk = inkOnGradient(BRAND_GRADIENT);
  const petalColors = [...BRAND_GRADIENT, colors.secondary, colors.gold];
  const s = styles(colors, heroInk);

  return (
    <SafeAreaView style={s.container} testID="welcome-in">
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {phase === 'party' ? (
          <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
            {Array.from({ length: PETAL_COUNT }, (_, i) => (
              <Petal key={i} index={i} width={Math.min(width, 520) - 40} color={petalColors[i % petalColors.length]} reduced={reduced} />
            ))}
            <Animated.View style={[s.badge, popStyle]}>
              <Text style={s.badgeEmoji} accessibilityElementsHidden importantForAccessibility="no">💜</Text>
            </Animated.View>
            <Text style={s.title} accessibilityRole="header">
              {name ? `You're in, ${name}` : "You're in"}
            </Text>
            <Text style={s.body}>
              {communityName
                ? `${communityName} read your application and said yes. Welcome to Roxy — this place is yours now.`
                : 'A real person read your application and said yes. Welcome to Roxy — this place is yours now.'}
            </Text>
          </LinearGradient>
        ) : (
          <View style={s.steps}>
            <Text style={s.stepsTitle} accessibilityRole="header">Your first five minutes</Text>
            <Text style={s.stepsBody}>
              Four small things that turn a yes into your first conversation. Tap one, then come
              back here for the next — your ticks are saved.
            </Text>
            <FirstStepsCard testID="welcome-first-steps" />
          </View>
        )}

        {phase === 'party' ? (
          <TouchableOpacity
            style={s.cta}
            onPress={() => setPhase('steps')}
            accessibilityRole="button"
            accessibilityLabel="Show me around"
            testID="welcome-in-continue"
          >
            <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.ctaFill}>
              <Text style={s.ctaText}>Show me around</Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={s.cta}
            onPress={() => router.replace('/(tabs)/feed')}
            accessibilityRole="button"
            accessibilityLabel="Take me to Roxy"
            testID="welcome-in-done"
          >
            <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.ctaFill}>
              <Text style={s.ctaText}>Take me to Roxy</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors: ReturnType<typeof useThemeColors>, heroInk: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, gap: 16, paddingBottom: 36 },
  hero: {
    borderRadius: RADII.lg,
    paddingVertical: 36,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  badge: {
    width: 84,
    height: 84,
    borderRadius: RADII.pill,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  badgeEmoji: { fontSize: 40 },
  title: { ...TYPE.display, color: heroInk, textAlign: 'center' },
  body: { ...TYPE.bodyLg, color: heroInk, textAlign: 'center' },
  steps: { gap: 10 },
  stepsTitle: { ...TYPE.headline, color: colors.textPrimary },
  stepsBody: { ...TYPE.bodyLg, color: colors.textSecondary },
  cta: { borderRadius: RADII.lg, overflow: 'hidden' },
  ctaFill: { minHeight: Math.max(52, MIN_TOUCH_TARGET), alignItems: 'center', justifyContent: 'center' },
  ctaText: { ...TYPE.title, color: heroInk, fontWeight: '800' },
});
