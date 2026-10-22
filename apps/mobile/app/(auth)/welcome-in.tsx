import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { PressableScale } from '../../components/ui/PressableScale';
import { RoxyWordmark } from '../../components/ui/RoxyWordmark';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { RADII, THEMES, identityFor, inkOn } from '../../lib/theme';
import { TYPE, emphasized } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { INVITE_CODE_LENGTH } from '../../lib/inviteCode';
import { animatedSpring } from '../../lib/motion';
import { haptic } from '../../lib/haptics';
import { fetchAdmissionCommunity, markWelcomeSeen } from '../../lib/welcomeIn';
import { FirstStepsCard } from '../../components/account/FirstStepsCard';

/** The membership card's tilt and its hard edge (design direction › moment 2). */
export const CARD_TILT = '-3deg';
export const CARD_EDGE = 6;
/** Crest squircle on the card: 28% corner of its size (direction › shape). */
const CREST = 40;
const CREST_RADIUS = Math.round(CREST * 0.28);
/** The "Come in" face height: the direction's 52 dp buttons. */
const BUTTON_HEIGHT = 52;

/** Her first name, from the name she gave. Never invented. */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Two initials for the community crest. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * "You're in" — signature moment 2 (design direction v2, board v2-02).
 *
 * Shown once, the first time a freshly approved member lands in the app
 * (`useWelcomeInRedirect`). Ten invite-code cells — the gate she came through —
 * snap together into one white membership card while the screen floods
 * `brandPink`; the card settles at -3° on a hard 6 dp edge on
 * `SPRING.slowSpatial`, with a success haptic. "You're in, <first name>." /
 * "Your card is ready. Show it to the friend who sent you the code." The card
 * carries the community that vouched for her, her name and the day she became
 * a member — all real data; nothing is made up.
 *
 * One ink button, "Come in", goes to the feed. "Show me around first" keeps
 * the first-steps checklist (G-11) reachable — the feature moves behind a
 * quiet link instead of disappearing.
 *
 * Omitted on purpose (no dead buttons, no invented data): "Share your card"
 * (there is no share-image pipeline yet) and the member number (members have
 * none). v0's confetti petals and 💜 badge are gone (v2 bans confetti and
 * emoji in chrome).
 *
 * Reduced motion: the end state, still. Haptics stay.
 */
export default function WelcomeInScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const displayName = useProfileStore((s) => s.profile?.display_name?.trim() || '');
  const admittedAt = useProfileStore((s) => s.profile?.admitted_at ?? null);
  const [community, setCommunity] = useState<{ id: string; name: string } | null>(null);
  // The card first, then (only if she asks) the first steps.
  const [phase, setPhase] = useState<'card' | 'steps'>('card');

  // 0 → 1: cells snap together, the flood and the card arrive.
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    // The one success haptic of the moment (direction › Haptics). Haptics
    // stay under Reduce Motion; `haptic` itself is a no-op on the web.
    haptic('success');
    if (reduced) {
      progress.setValue(1);
      return;
    }
    Animated.spring(progress, { toValue: 1, ...animatedSpring('slowSpatial', false) }).start();
  }, [progress, reduced]);

  useEffect(() => {
    if (!userId) return;
    void markWelcomeSeen(userId);
    let cancelled = false;
    void fetchAdmissionCommunity(userId).then((c) => {
      if (!cancelled && c) setCommunity({ id: c.id, name: c.name });
    });
    return () => { cancelled = true; };
  }, [userId]);

  const first = firstName(displayName);
  const since = admittedAt && !Number.isNaN(Date.parse(admittedAt))
    ? format(new Date(admittedAt), 'd MMMM yyyy')
    : null;

  // The card is an object, not a themed surface: white with the light ink in
  // both themes, like the always-dark feed stage.
  const card = THEMES.light;
  const field = colors.brandPink;
  const fieldInk = colors.onBrandPink;
  const comeInFill = card.ink;
  const crestFill = identityFor(community?.id ?? null);

  const cardWidth = Math.min(width, 520) - 48;
  const cellGap = 4;
  const cellWidth = (cardWidth - cellGap * (INVITE_CODE_LENGTH - 1)) / INVITE_CODE_LENGTH;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.ground },
    flood: { ...StyleSheet.absoluteFillObject, backgroundColor: field },
    scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 24 },
    mark: { width: 88, height: 24 },
    words: { gap: 12 },
    title: { ...TYPE.moment, color: fieldInk },
    body: { ...TYPE.body, color: fieldInk },
    stage: { minHeight: cardWidth * 0.62 + CARD_EDGE + 24, justifyContent: 'center' },
    cells: { flexDirection: 'row', gap: cellGap, position: 'absolute', left: 0, right: 0 },
    cell: { width: cellWidth, height: BUTTON_HEIGHT, borderRadius: RADII.sm, backgroundColor: card.surface },
    cardWrap: { width: cardWidth, alignSelf: 'center' },
    edge: {
      position: 'absolute', left: 0, right: 0, top: CARD_EDGE, bottom: -CARD_EDGE,
      borderRadius: RADII.sheet, backgroundColor: card.pinkLip,
    },
    card: {
      borderRadius: RADII.sheet, backgroundColor: card.surface,
      padding: 20, gap: 16, minHeight: cardWidth * 0.62,
    },
    vouchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    crest: {
      width: CREST, height: CREST, borderRadius: CREST_RADIUS,
      backgroundColor: crestFill, alignItems: 'center', justifyContent: 'center',
    },
    crestText: { ...TYPE.label, color: inkOn(crestFill) },
    vouchName: { ...TYPE.label, color: card.ink },
    vouchLine: { ...TYPE.meta, color: card.ink2 },
    name: { ...emphasized('title'), color: card.ink },
    since: { ...TYPE.body, color: card.ink2 },
    cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 'auto' },
    actions: { gap: 4, marginTop: 'auto' },
    comeIn: {
      height: BUTTON_HEIGHT, borderRadius: RADII.pill, backgroundColor: comeInFill,
      alignItems: 'center', justifyContent: 'center',
    },
    comeInText: { ...TYPE.button, color: inkOn(comeInFill) },
    quiet: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
    quietText: { ...TYPE.label, color: fieldInk },
    steps: { gap: 12 },
    stepsTitle: { ...TYPE.headline, color: colors.ink },
    stepsBody: { ...TYPE.body, color: colors.ink2 },
    primary: {
      height: BUTTON_HEIGHT, borderRadius: RADII.pill, backgroundColor: colors.pink,
      alignItems: 'center', justifyContent: 'center',
    },
    primaryText: { ...TYPE.button, color: colors.onPink },
  });

  if (phase === 'steps') {
    return (
      <SafeAreaView style={s.container} testID="welcome-in">
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.steps}>
            <Text style={s.stepsTitle} accessibilityRole="header">Your first five minutes</Text>
            <Text style={s.stepsBody}>
              Four small things that turn a yes into your first conversation. Tap one, then come
              back here for the next. Your ticks are saved.
            </Text>
            <FirstStepsCard testID="welcome-first-steps" />
          </View>
          <PressableScale
            style={s.primary}
            onPress={() => router.replace('/(tabs)/feed')}
            accessibilityRole="button"
            accessibilityLabel="Take me to Roxy"
            testID="welcome-in-done"
          >
            <Text style={s.primaryText}>Take me to Roxy</Text>
          </PressableScale>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Reduced motion renders the end state with plain values: no interpolation.
  const at = (from: number | string, to: number | string, range: [number, number] = [0, 1]) =>
    reduced
      ? to
      : progress.interpolate({ inputRange: range, outputRange: [from, to] as never, extrapolate: 'clamp' });

  const floodStyle = { opacity: at(0, 1, [0, 0.35]) };
  const cellsStyle = { opacity: at(1, 0, [0.15, 0.45]) };
  const cardStyle = {
    opacity: at(0, 1, [0.2, 0.5]),
    transform: [{ scale: at(0.7, 1) }, { rotate: at('0deg', CARD_TILT) }],
  };
  const wordsStyle = { opacity: at(0, 1, [0.4, 0.9]) };

  const a11yCard = [
    'Your Roxy membership card.',
    displayName || null,
    community ? `${community.name} vouched for you.` : null,
    since ? `Member since ${since}.` : null,
  ].filter(Boolean).join(' ');

  return (
    <View style={s.container} testID="welcome-in">
      <Animated.View style={[s.flood, floodStyle as never]} testID="welcome-in-flood" pointerEvents="none" />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <ExpoImage
            source={require('../../assets/brand/roxy-logo-mono-black.svg')}
            style={s.mark}
            contentFit="contain"
            accessibilityLabel="Roxy"
          />

          <Animated.View style={[s.words, wordsStyle as never]}>
            <Text style={s.title} accessibilityRole="header">
              {first ? `You're in, ${first}.` : "You're in."}
            </Text>
            <Text style={s.body}>Your card is ready. Show it to the friend who sent you the code.</Text>
          </Animated.View>

          <View style={s.stage}>
            {/* The gate's code cells, snapping together into the card. */}
            <Animated.View style={[s.cells, cellsStyle as never]} pointerEvents="none" testID="welcome-in-cells">
              {Array.from({ length: INVITE_CODE_LENGTH }, (_, i) => (
                <View key={i} style={s.cell} />
              ))}
            </Animated.View>

            <Animated.View
              style={[s.cardWrap, cardStyle as never]}
              testID="membership-card"
              accessible
              accessibilityLabel={a11yCard}
            >
              <View style={s.edge} testID="membership-card-edge" />
              <View style={s.card}>
                {community ? (
                  <View style={s.vouchRow} testID="membership-card-vouch">
                    <View style={s.crest}>
                      <Text style={s.crestText}>{initials(community.name)}</Text>
                    </View>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={s.vouchName} numberOfLines={2}>{community.name}</Text>
                      <Text style={s.vouchLine}>vouched for you</Text>
                    </View>
                  </View>
                ) : null}
                <View style={{ gap: 4 }}>
                  {displayName ? <Text style={s.name} numberOfLines={2}>{displayName}</Text> : null}
                  {since ? <Text style={s.since}>Member since {since}</Text> : null}
                </View>
                <View style={s.cardFoot}>
                  <RoxyWordmark variant="primary" height={20} />
                </View>
              </View>
            </Animated.View>
          </View>

          <View style={s.actions}>
            <PressableScale
              style={s.comeIn}
              onPress={() => router.replace('/(tabs)/feed')}
              accessibilityRole="button"
              accessibilityLabel="Come in"
              testID="welcome-in-come-in"
            >
              <Text style={s.comeInText}>Come in</Text>
            </PressableScale>
            <PressableScale
              style={s.quiet}
              onPress={() => setPhase('steps')}
              accessibilityRole="button"
              accessibilityLabel="Show me around"
              testID="welcome-in-continue"
            >
              <Text style={s.quietText}>Show me around first</Text>
            </PressableScale>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/**
 * RETIRED (v2, 2026-10-21): v0's falling confetti petal, unchanged. The design
 * direction bans confetti ("No confetti") and petal shapes read as the banned
 * flower; moment 2 is now the membership card. Origin: the gate lane's G-11
 * welcome-in screen (`git log -S "function Petal"`). Kept exported and not
 * rendered; use it only if the direction ever brings a celebration back.
 */
export function LegacyPetal({ index, width, color, reduced }: {
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
    <Reanimated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: 0, left: x, width: size, height: size * 1.6, borderRadius: size, backgroundColor: color },
        style,
      ]}
    />
  );
}
