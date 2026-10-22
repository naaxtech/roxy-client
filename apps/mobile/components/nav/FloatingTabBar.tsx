import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { RADII, THEMES, type ThemeColors } from '../../lib/theme';
import { FONTS, TYPE, emphasized } from '../../lib/typography';
import { NAV_SLOTS_3 } from './navSlots3';
import { NavIcon, type NavIconName } from './NavIcons';
import type { NavSlot } from './navTokens';
import { a11yState } from '../../lib/a11yState';
import { PRESS, SPRING } from '../../lib/motion';
import { haptic } from '../../lib/haptics';
import { PressableScale } from '../ui/PressableScale';
import { afterPaint } from '../motion/afterPaint';
import { startWebSpring } from '../motion/webSpring';
import {
  CREATE_KEY,
  NAV_HEIGHT,
  NAV_INDICATOR,
  NAV_MIN_BOTTOM,
  TAB_MIN_TOUCH,
  UNREAD_DOT,
  indicatorSnapsInstantly,
} from './navTokens';

export type TabBarRoute = { key: string; name: string };

export type FloatingTabBarProps = {
  state: { index: number; routes: readonly TabBarRoute[] };
  descriptors: Record<string, { options: { tabBarBadge?: number | string } }>;
  /** The navigator dance (emit `tabPress`, respect `defaultPrevented`) belongs
   *  to the layout that has the real navigation object; this bar only reports. */
  onTabPress: (route: TabBarRoute, isFocused: boolean) => void;
  onCreatePress: () => void;
  /** While the Create sheet is open the key turns 45° into a close ×. */
  createOpen?: boolean;
  /** Defaults to the full bar. Public launch passes the three-slot set. */
  slots?: readonly NavSlot[];
};

/** The bar's palette: the theme's, or the always-dark stage's on the Feed. */
type BarInk = {
  ground: string;
  pill: string;
  activeIcon: string;
  activeLabel: string;
  idle: string;
};

function barInk(colors: ThemeColors, onStage: boolean): BarInk {
  if (onStage) {
    return {
      ground: colors.stage,
      pill: colors.stageRaised,
      activeIcon: '#FFFFFF',
      activeLabel: '#FFFFFF',
      idle: THEMES.dark.ink2,
    };
  }
  return {
    ground: colors.ground,
    pill: colors.pinkContainer,
    activeIcon: colors.onPinkContainer,
    activeLabel: colors.ink,
    idle: colors.ink2,
  };
}

/** Both palettes, so the UI thread can cross-fade between them (0 theme, 1 stage). */
type InkPair = { theme: BarInk; stage: BarInk };

/**
 * Web: RN-web's Pressable waits 50 ms before `onPressIn` unless told not to
 * (jank audit #2). Native Pressable already presses in at once.
 */
const NO_PRESS_DELAY = Platform.OS === 'web' ? ({ delayPressIn: 0 } as Record<string, number>) : {};

function UnreadDot({ value, slotKey, colors }: { value: number | string; slotKey: string; colors: ThemeColors }) {
  return (
    <View
      testID={`nav-badge-${slotKey}`}
      accessibilityLabel={`${value} unread`}
      style={[s.dot, { backgroundColor: colors.pink }]}
    />
  );
}

/**
 * The active slot's pill (shape morph #2: 32 → 56 dp).
 *
 * Laid out at its final 56 × 32 from the first frame and grown with `scaleX`
 * on the UI thread. It used to spring `width` on the JS driver, which relaid
 * the bar out every frame and stalled behind the tab switch's render (jank
 * audit #7). A pill that mounts with the bar (the tab she opened on) is simply
 * there; one that mounts on a later selection grows in.
 */
function NavPill({
  name, stage, inks, barPainted, growNew,
}: {
  name: string;
  stage: SharedValue<number>;
  inks: InkPair;
  /** True once the bar has painted: a pill mounting after that is a new selection. */
  barPainted: { current: boolean };
  /** False under Reduce Motion: the pill is simply there. */
  growNew: boolean;
}) {
  const [growIn] = useState(() => barPainted.current && growNew);
  const isWeb = Platform.OS === 'web';
  // Native grows on the UI thread (reanimated); the web on the compositor (WAAPI).
  const grow = useSharedValue(growIn && !isWeb ? NAV_INDICATOR.from / NAV_INDICATOR.width : 1);
  const webShape = useRef<View>(null);
  useEffect(() => {
    if (growIn && !isWeb) grow.value = withSpring(1, SPRING.fastSpatial);
  }, [growIn, isWeb, grow]);
  useLayoutEffect(() => {
    if (!growIn || !isWeb) return;
    startWebSpring(
      webShape.current as unknown as Element,
      [{ transform: `scaleX(${NAV_INDICATOR.from / NAV_INDICATOR.width})` }, { transform: 'scaleX(1)' }],
      SPRING.fastSpatial,
    );
  }, [growIn, isWeb]);
  const fromPill = inks.theme.pill;
  const toPill = inks.stage.pill;
  const fillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(stage.value, [0, 1], [fromPill, toPill]),
  }));
  const growStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: grow.value }] }));
  const fill = <Animated.View testID={`nav-indicator-${name}-fill`} style={[s.indicatorFill, fillStyle]} />;
  if (isWeb) {
    return (
      <View ref={webShape} testID={`nav-indicator-${name}`} pointerEvents="none" style={s.indicator}>
        {fill}
      </View>
    );
  }
  return (
    <Animated.View testID={`nav-indicator-${name}`} pointerEvents="none" style={[s.indicator, growStyle]}>
      {fill}
    </Animated.View>
  );
}

type RouteSlotProps = {
  route: TabBarRoute;
  label: string;
  icon: NavIconName;
  isFocused: boolean;
  badge: number | string | undefined;
  colors: ThemeColors;
  ink: BarInk;
  inks: InkPair;
  stage: SharedValue<number>;
  barPainted: { current: boolean };
  growNew: boolean;
  onSlotPress: (route: TabBarRoute, isFocused: boolean) => void;
};

/**
 * One destination. Memoised: a switch re-renders the slot that lost the
 * selection and the one that gained it, not all five (jank audit #3).
 */
const RouteSlot = memo(function RouteSlot({
  route, label, icon, isFocused, badge, colors, ink, inks, stage, barPainted, growNew, onSlotPress,
}: RouteSlotProps) {
  const labelStyle = isFocused ? emphasized('meta') : TYPE.meta;
  const fromLabel = isFocused ? inks.theme.activeLabel : inks.theme.idle;
  const toLabel = isFocused ? inks.stage.activeLabel : inks.stage.idle;
  const labelInk = useAnimatedStyle(() => ({
    color: interpolateColor(stage.value, [0, 1], [fromLabel, toLabel]),
  }));

  return (
    <PressableScale
      testID={`nav-slot-${route.name}`}
      style={s.slot}
      feedback="layer"
      onPress={() => onSlotPress(route, isFocused)}
      accessibilityRole="tab"
      {...a11yState({ selected: isFocused })}
      accessibilityLabel={label}
    >
      <View style={s.indicatorWrap}>
        {isFocused ? (
          <NavPill name={route.name} stage={stage} inks={inks} barPainted={barPainted} growNew={growNew} />
        ) : null}
        <View testID={`nav-icon-layer-${route.name}`} style={s.iconLayer}>
          <NavIcon
            name={icon}
            color={isFocused ? ink.activeIcon : ink.idle}
            testID={`nav-icon-${route.name}`}
          />
        </View>
        {badge !== undefined ? <UnreadDot value={badge} slotKey={route.name} colors={colors} /> : null}
      </View>
      <Animated.Text style={[s.label, labelStyle, labelInk]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </PressableScale>
  );
});

function CreateSlot({
  label, colors, open, reducedMotion, onPress,
}: {
  label: string;
  colors: ThemeColors;
  open: boolean;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  // The plus turns 45° into a close × while the sheet is open (shape morph #3),
  // and the key presses in — both on the UI thread (reanimated), so a busy JS
  // thread cannot eat them.
  const turn = useSharedValue(open ? 1 : 0);
  const press = useSharedValue(1);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    const to = open ? 1 : 0;
    turn.value = reducedMotion ? to : withSpring(to, SPRING.spatial);
  }, [open, reducedMotion, turn]);
  const pressTo = (to: number) => {
    press.value = reducedMotion ? to : withSpring(to, SPRING.fastSpatial);
  };
  const keyStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const glyphStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 45}deg` }] }));

  return (
    <Pressable
      testID="nav-slot-create"
      style={s.slot}
      onPress={onPress}
      onPressIn={() => pressTo(PRESS.scale)}
      onPressOut={() => pressTo(1)}
      accessibilityRole="button"
      accessibilityLabel={open ? 'Close create menu' : label}
      accessibilityHint={open ? undefined : 'Choose what to create'}
      {...NO_PRESS_DELAY}
    >
      <Animated.View
        testID="nav-create-key"
        style={[s.createKey, { backgroundColor: colors.pink }, keyStyle]}
      >
        <Animated.View testID="nav-create-glyph" style={glyphStyle}>
          <Animated.Text testID="nav-create-icon" style={[s.createPlus, { color: colors.onPink }]}>+</Animated.Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The Feed recolours the bar to the stage. A 0 → 1 progress on `fastEffects`
 * (ζ 1, so colour never overshoots) cross-fades ground, pill and labels on the
 * UI thread; under Reduce Motion the bar simply recolours.
 */
function useStageProgress(onStage: boolean, reducedMotion: boolean): SharedValue<number> {
  const stage = useSharedValue(onStage ? 1 : 0);
  const was = useRef(onStage);
  useEffect(() => {
    if (was.current === onStage) return;
    was.current = onStage;
    const to = onStage ? 1 : 0;
    stage.value = reducedMotion ? to : withSpring(to, SPRING.fastEffects);
  }, [onStage, reducedMotion, stage]);
  return stage;
}

/**
 * Roxy's navigation: the M3 Expressive flexible navigation bar (design
 * direction v2 › Navigation; board v2-04, v2-05).
 *
 * Docked full width on `ground` with no shadow, 64 dp plus the bottom inset;
 * five slots Feed · Discover · ＋Create · Messages · You with labels always
 * shown (12/16, emphasized when active). The active slot wears a 56 × 32
 * `pinkContainer` pill behind its icon (it grows from 32 on selection). On the
 * Feed the bar takes the stage's colours (`stage`, a `stageRaised` pill, white
 * active, dark `ink2` idle) so the post stays the screen. Create is a 52 × 40
 * `pink` key at radius 12 whose label is for screen readers; it turns 45° into
 * a close × while the Create sheet is open. Unread is an 8 dp `pink` dot.
 *
 * Wave 3 (motion spec §3.1 row 4): a tap paints the new selection (pill,
 * colours) at once and asks the navigator to move only after that frame is on
 * screen (`afterPaint`), so the bar answers the finger even while the
 * destination is still rendering. All of its motion runs on reanimated.
 *
 * The bar sits in the navigator's normal flow, so React Navigation reserves
 * its height and no screen loses its last row behind it. Full width leaves room
 * for labels 40% longer than English.
 */
export function FloatingTabBar({
  state, descriptors, onTabPress, onCreatePress, createOpen = false, slots = NAV_SLOTS_3,
}: FloatingTabBarProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const bottomInset = Math.max(insets.bottom, NAV_MIN_BOTTOM);

  const committedName = state.routes[state.index]?.name;
  // The tab she just tapped, shown as selected until the navigator commits it
  // (or declines). Valid only against the tab it was tapped from.
  const [pending, setPending] = useState<{ name: string; from: string | undefined } | null>(null);
  const focusedName = pending && pending.from === committedName ? pending.name : committedName;

  const onStage = focusedName === 'feed';
  const inks = useMemo<InkPair>(() => ({ theme: barInk(colors, false), stage: barInk(colors, true) }), [colors]);
  const ink = onStage ? inks.stage : inks.theme;
  const stage = useStageProgress(onStage, reducedMotion);
  const groundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(stage.value, [0, 1], [inks.theme.ground, inks.stage.ground]),
  }));

  // Slots mounted with the bar keep their pill at rest; later selections grow.
  const barPainted = useRef(false);
  useEffect(() => {
    barPainted.current = true;
  }, []);

  const mounted = useRef(true);
  const cancels = useRef<(() => void)[]>([]);
  useEffect(() => () => {
    mounted.current = false;
    cancels.current.forEach((cancel) => cancel());
  }, []);

  const committedRef = useRef(committedName);
  committedRef.current = committedName;

  const onSlotPress = useCallback((route: TabBarRoute, isFocused: boolean) => {
    if (isFocused) {
      // Already here: the navigator's own tabPress (scroll / pop to top).
      onTabPress(route, true);
      return;
    }
    // Haptics stay under Reduce Motion (direction › Motion).
    haptic('select');
    setPending({ name: route.name, from: committedRef.current });
    cancels.current.push(afterPaint(() => {
      if (!mounted.current) return;
      onTabPress(route, false);
      setPending(null);
    }));
  }, [onTabPress]);

  return (
    <Animated.View testID="nav-bar" style={[s.bar, { paddingBottom: bottomInset }, groundStyle]}>
      <Animated.View testID="nav-pill" style={[s.row, groundStyle]}>
        {slots.map((slot) => {
          if (slot.kind === 'action') {
            return (
              <CreateSlot
                key={slot.key}
                label={slot.label}
                colors={colors}
                open={createOpen}
                reducedMotion={reducedMotion}
                onPress={onCreatePress}
              />
            );
          }
          const route = state.routes.find((r) => r.name === slot.routeName);
          if (!route) return null;
          const isFocused = focusedName === slot.routeName;
          return (
            <RouteSlot
              key={slot.routeName}
              route={route}
              label={slot.label}
              icon={slot.icon}
              isFocused={isFocused}
              badge={descriptors[route.key]?.options.tabBarBadge}
              colors={colors}
              ink={ink}
              inks={inks}
              stage={stage}
              barPainted={barPainted}
              growNew={!indicatorSnapsInstantly(reducedMotion)}
              onSlotPress={onSlotPress}
            />
          );
        })}
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bar: {
    // Docked: full width, no inset, no radius, no shadow (M3 flexible bar).
    paddingHorizontal: 0,
  },
  row: {
    height: NAV_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 4,
  },
  slot: {
    flex: 1,
    // Exactly the floor, not a pixel over: TAB_MIN_TOUCH is the Play Console
    // pre-launch minimum and the one number here that must not move.
    minHeight: TAB_MIN_TOUCH,
    minWidth: TAB_MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: RADII.md,
  },
  indicatorWrap: {
    width: NAV_INDICATOR.width,
    height: NAV_INDICATOR.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    width: NAV_INDICATOR.width,
    height: NAV_INDICATOR.height,
    borderRadius: RADII.pill,
    zIndex: 0,
  },
  indicatorFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADII.pill,
  },
  // Above the pill: on the web an absolutely positioned pill would otherwise
  // paint over the (non-positioned) icon whatever the DOM order.
  iconLayer: {
    position: 'relative',
    zIndex: 1,
  },
  label: {
    textAlign: 'center',
  },
  dot: {
    position: 'absolute',
    zIndex: 2,
    top: 3,
    right: 12,
    width: UNREAD_DOT,
    height: UNREAD_DOT,
    borderRadius: UNREAD_DOT / 2,
  },
  createKey: {
    width: CREATE_KEY.width,
    height: CREATE_KEY.height,
    borderRadius: RADII.press,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createPlus: {
    fontFamily: FONTS.display.bold,
    fontSize: 26,
    lineHeight: 28,
    marginTop: -1,
  },
});
