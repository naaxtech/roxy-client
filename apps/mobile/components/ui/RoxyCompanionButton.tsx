import { useEffect, useRef, useState } from 'react';
import { Animated, I18nManager, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { RADII, floatElevation } from '../../lib/theme';
import { POP_FROM, runSpring } from '../../lib/motion';
import { tapLight } from '../../lib/haptics';
import { useRoxyFab } from '../../lib/roxyFab';
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

/** How far the tucked O travels toward the end edge: its centre lands on it. */
const TUCK_TRAVEL = FAB_MARGIN + FAB_SIZE / 2;
const TUCK_SCALE = FAB_TUCKED / FAB_SIZE;
/** Reduce Motion: the tuck is a short fade to the end state. */
const FADE_MS = 120;

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
 * While a list scrolls down she tucks in (`lib/roxyFab.ts`): 40 dp, eyes
 * closed, centred on the screen edge, on `SPRING.fastSpatial`; a tap on the
 * tucked button, a scroll up, the top or the end of the list brings her back.
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
  const tucked = useRoxyFab((s) => s.tucked);
  const untuck = useRoxyFab((s) => s.untuck);

  const [sheetOpen, setSheetOpen] = useState(false);
  const tuck = useRef(new Animated.Value(tucked ? 1 : 0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const enter = useRef(new Animated.Value(reducedMotion ? 1 : POP_FROM)).current;
  const lastTucked = useRef(tucked);

  useEffect(() => {
    if (visible) runSpring(enter, 1, 'fastSpatial', reducedMotion);
  }, [visible, reducedMotion, enter]);

  useEffect(() => {
    const changed = lastTucked.current !== tucked;
    lastTucked.current = tucked;
    runSpring(tuck, tucked ? 1 : 0, 'fastSpatial', reducedMotion);
    if (reducedMotion && changed) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
    }
  }, [tucked, reducedMotion, tuck, fade]);

  if (!visible) return null;

  const barTop = NAV_HEIGHT + Math.max(insets.bottom, NAV_MIN_BOTTOM);
  const dir = I18nManager.isRTL ? -1 : 1;

  const origin: HelloRoxyOrigin = {
    x: I18nManager.isRTL ? FAB_MARGIN + FAB_SIZE / 2 : winW - FAB_MARGIN - FAB_SIZE / 2,
    y: winH - barTop - FAB_MARGIN - FAB_SIZE / 2,
    size: FAB_SIZE,
  };

  const openRoxy = () => {
    if (tucked) {
      untuck();
      return;
    }
    tapLight();
    setSheetOpen(true);
  };

  const tuckStyle = reducedMotion
    ? { transform: [{ translateX: tucked ? dir * TUCK_TRAVEL : 0 }, { scale: tucked ? TUCK_SCALE : 1 }] }
    : {
        transform: [
          { translateX: tuck.interpolate({ inputRange: [0, 1], outputRange: [0, dir * TUCK_TRAVEL] }) },
          { scale: tuck.interpolate({ inputRange: [0, 1], outputRange: [1, TUCK_SCALE] }) },
        ],
      };

  return (
    <>
      <View testID="fab-lane" pointerEvents="box-none" style={[s.lane, { bottom: barTop }]}>
        <Animated.View
          testID="fab-seat"
          pointerEvents="box-none"
          style={[s.seat, { opacity: sheetOpen ? 0 : fade, transform: [{ scale: enter }] }]}
        >
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
            onPress={untuck}
            accessibilityRole="button"
            accessibilityLabel="Roxy AI"
            accessibilityHint="Brings the Roxy AI button back"
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
    width: FAB_TUCKED_HIT.width,
    height: FAB_TUCKED_HIT.height,
  },
});
