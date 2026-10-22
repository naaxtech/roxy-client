import { useEffect, useState } from 'react';
import { I18nManager, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { RADII, floatElevation } from '../../lib/theme';
import { POP_FROM, PRESS, fadeConfig, headStart, springTo } from '../../lib/motion';
import { tapLight } from '../../lib/haptics';
import { useRoxyFab, fabTuck } from '../../lib/roxyFab';
import {
  FAB_LANE, FAB_MARGIN, FAB_SIZE, FAB_TUCKED, FAB_TUCKED_HIT, NAV_HEIGHT, NAV_MIN_BOTTOM,
} from '../nav/navTokens';
import { PressableScale } from './PressableScale';
import { RoxyO } from '../roxy/RoxyO';
import { HelloRoxySheet, type HelloRoxyOrigin } from '../roxy/HelloRoxySheet';
import { firstNameOf } from '../roxy/roxyConversation';

interface Props {
  visible?: boolean;
  /** On the Feed's dark stage the ring is the hot `brandPink`. */
  onStage?: boolean;
}

/**
 * How far the tucked O travels toward the end edge: until its inner edge sits
 * on the margin line, so only the margin shows (16 dp of a 40 dp O). The
 * direction says "centred on the edge so 20 dp shows inside the margin", but
 * 20 dp is 4 dp wider than the 16 dp margin: the O then sat on the end of
 * "Joined" and the Ghost switch. The lane rule (nothing under her) wins.
 */
const TUCK_TRAVEL = FAB_SIZE / 2 + FAB_TUCKED / 2;
/**
 * The tucked target: the margin strip beside the O, 48 dp tall. The token's
 * 28 dp (FAB_TUCKED_HIT.width) reached 12 dp into the content column, so a tap
 * on the end of a row or button opened Roxy AI. At the end of a list she comes
 * out at 56 dp (the equivalent full-size target on the same screen).
 */
const TUCKED_HIT_WIDTH = FAB_MARGIN;
const TUCK_SCALE = FAB_TUCKED / FAB_SIZE;

/*
 * RETIRED (v2, 2026-10-21): the v0 three-pill FAB menu — "Chat with Roxy",
 * "Search Roxy", "Filter this view" with its joined-community radio list.
 * Origin: fd4c608 (2026-07-19, "R-mark companion button with actions + global
 * search"). Why: M3 rules a FAB menu out for a button with one job, and Nicole
 * kept the button to open Roxy AI. Its other two jobs MOVED, they did not
 * disappear: search is the search button on the Feed and Discover headers
 * (`router.push('/search')`), and the community filter is the
 * CommunityContextSwitcher chip on Feed › Communities, which writes the same
 * `communityFilterStore`. Bring a menu back only if the FAB gains 2-6 related
 * actions (M3's rule); the old implementation is in git at 4e346cf.
 */

/**
 * The Roxy AI button (design direction v2 › The Roxy AI button).
 *
 * The Roxy O, 56 dp, in its own 88 × 88 lane at the bottom end corner: 16 dp
 * from the edge and 16 dp above the bar, so at rest nothing readable or
 * tappable sits under her. One job: a tap (or a long-press — there is no
 * menu) gives a light haptic and grows the O into the "Hello, Roxy" sheet.
 *
 * She rests tucked wherever list content sits in her lane (`lib/roxyFab.ts`,
 * the lane rule: at rest nothing readable or tappable under her): 40 dp, eyes
 * closed, centred on the screen edge, on `SPRING.fastSpatial`. She is out
 * where her lane is empty: the end of a list (lists end FAB_LANE higher), a
 * list that fits, and the Feed. Tucked or out, one tap opens Roxy AI.
 * The tuck springs on the UI thread from `fabTuck` (a shared value), so a busy
 * JS thread cannot hold it back and no scroll event re-renders her; React
 * hears only the flip (eyes, hit area). On the Feed stage she never tucks.
 * Reduce Motion: the tuck is a short fade and she does not blink.
 *
 * Whether she shows at all (switched on in Settings, and not on a screen in
 * `FAB_SUPPRESSED_ON`) is the tabs layout's call: `visible`. Position is
 * measured from the window bottom, so the parent must be full-window.
 */
export function RoxyCompanionButton({ visible = true, onStage = false }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const storeTucked = useRoxyFab((s) => s.tucked);
  // On the Feed (a pager) she never tucks (design direction › Scroll behaviour).
  const tucked = storeTucked && !onStage;

  const [sheetOpen, setSheetOpen] = useState(false);
  const fade = useSharedValue(1);
  const enter = useSharedValue(reducedMotion ? 1 : POP_FROM);
  // 0 out → 1 tucked; the style interpolates pixels from it (motion spec §3.2:
  // animate a 0 → 1 progress, so the spring settles when it looks settled).
  const verdict = onStage ? 0 : fabTuck.value;
  const tuck = useSharedValue(verdict);
  /** The verdict the reaction last acted on (it may fire more than once per change). */
  const seen = useSharedValue(verdict);
  /** 1 at rest, PRESS.scale while the tucked hit area is held (F2: it answers on press-in). */
  const press = useSharedValue(1);
  const dir = I18nManager.isRTL ? -1 : 1;

  useEffect(() => {
    if (!visible) return;
    enter.value = reducedMotion ? 1 : withSpring(1, springTo('fastSpatial'));
  }, [visible, reducedMotion, enter]);

  // Runs on the UI thread whenever the list's verdict (or the stage) changes:
  // a spring that retargets from where she is. Reduce Motion: no travel, the
  // new state fades in over REDUCED.fadeMs (fadeConfig).
  useAnimatedReaction(
    () => (onStage ? 0 : fabTuck.value),
    (now) => {
      if (now === seen.value) return;
      seen.value = now;
      if (!reducedMotion) {
        tuck.value = withSpring(now, springTo('fastSpatial'));
        return;
      }
      tuck.value = now;
      fade.value = 0;
      fade.value = withTiming(1, fadeConfig());
    },
    [onStage, reducedMotion],
  );

  const tuckStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tuck.value * dir * TUCK_TRAVEL },
      { scale: (1 + tuck.value * (TUCK_SCALE - 1)) * press.value },
    ],
  }), [dir]);

  const pressTo = (to: number) => {
    if (reducedMotion) {
      press.value = to;
    } else if (to < 1 && press.value >= 0.999) {
      // From rest: leave one frame into the spring (F1, painted next frame).
      const { start, config } = headStart(1, to);
      press.value = start;
      press.value = withSpring(to, config);
    } else {
      press.value = withSpring(to, springTo('fastSpatial'));
    }
  };

  const seatStyle = useAnimatedStyle(() => ({
    opacity: sheetOpen ? 0 : fade.value,
    transform: [{ scale: enter.value }],
  }), [sheetOpen]);

  if (!visible) return null;

  const barTop = NAV_HEIGHT + Math.max(insets.bottom, NAV_MIN_BOTTOM);
  const seatY = winH - barTop - FAB_MARGIN - FAB_SIZE / 2;

  // The sheet grows from wherever the O is: her seat, or the edge when tucked.
  const origin: HelloRoxyOrigin = tucked
    ? { x: I18nManager.isRTL ? 0 : winW, y: seatY, size: FAB_TUCKED }
    : {
        x: I18nManager.isRTL ? FAB_MARGIN + FAB_SIZE / 2 : winW - FAB_MARGIN - FAB_SIZE / 2,
        y: seatY,
        size: FAB_SIZE,
      };

  // Tucked or out, one tap opens Roxy AI (M3: a collapsed FAB keeps its
  // action). She stays tucked behind the sheet while content fills her lane.
  const openRoxy = () => {
    tapLight();
    setSheetOpen(true);
  };

  return (
    <>
      <View testID="fab-lane" pointerEvents="box-none" style={[s.lane, { bottom: barTop }]}>
        <Animated.View testID="fab-seat" pointerEvents="box-none" style={[s.seat, seatStyle]}>
          <Animated.View testID="fab-tuck" style={[s.disc, floatElevation(colors), tuckStyle]}>
            <PressableScale
              testID="fab-button"
              onPress={openRoxy}
              onLongPress={openRoxy}
              accessibilityRole="button"
              accessibilityLabel="Roxy AI"
              accessibilityHint="Opens your chat with Roxy AI"
              style={s.disc}
            >
              <RoxyO
                size={FAB_SIZE}
                mood={tucked ? 'rest' : 'open'}
                blink={!tucked && !sheetOpen}
                ring={onStage ? colors.brandPink : undefined}
                testID="fab-o"
              />
            </PressableScale>
          </Animated.View>
        </Animated.View>

        {tucked ? (
          <Pressable
            testID="fab-tucked"
            onPress={openRoxy}
            onPressIn={() => pressTo(PRESS.scale)}
            onPressOut={() => pressTo(1)}
            accessibilityRole="button"
            accessibilityLabel="Roxy AI"
            accessibilityHint="Opens your chat with Roxy AI"
            style={s.tuckedHit}
          />
        ) : null}
      </View>

      <HelloRoxySheet
        visible={sheetOpen}
        userId={user?.id ?? null}
        firstName={firstNameOf(profile?.display_name)}
        origin={origin}
        onClose={() => setSheetOpen(false)}
        onOpenChat={() => {
          setSheetOpen(false);
          router.push('/roxy-chat' as never);
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  lane: {
    position: 'absolute',
    end: 0,
    width: FAB_LANE,
    height: FAB_LANE,
  },
  seat: {
    position: 'absolute',
    end: FAB_MARGIN,
    bottom: FAB_MARGIN,
    width: FAB_SIZE,
    height: FAB_SIZE,
  },
  disc: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: RADII.pill,
  },
  tuckedHit: {
    position: 'absolute',
    end: 0,
    bottom: FAB_MARGIN + FAB_SIZE / 2 - FAB_TUCKED_HIT.height / 2,
    width: TUCKED_HIT_WIDTH,
    height: FAB_TUCKED_HIT.height,
  },
});
