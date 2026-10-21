import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { RADII, THEMES, type ThemeColors } from '../../lib/theme';
import { FONTS, TYPE, emphasized } from '../../lib/typography';
import { NAV_SLOTS_3 } from './navSlots3';
import { NavIcon, type NavIconName } from './NavIcons';
import type { NavSlot } from './navTokens';
import { a11yState } from '../../lib/a11yState';
import { PRESS, animatedSpring, runSpring } from '../../lib/motion';
import { haptic } from '../../lib/haptics';
import { PressableScale } from '../ui/PressableScale';
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

function UnreadDot({ value, slotKey, colors }: { value: number | string; slotKey: string; colors: ThemeColors }) {
  return (
    <View
      testID={`nav-badge-${slotKey}`}
      accessibilityLabel={`${value} unread`}
      style={[s.dot, { backgroundColor: colors.pink }]}
    />
  );
}

function RouteSlot({
  route, label, icon, isFocused, badge, colors, ink, reducedMotion, onPress,
}: {
  route: TabBarRoute;
  label: string;
  icon: NavIconName;
  isFocused: boolean;
  badge: number | string | undefined;
  colors: ThemeColors;
  ink: BarInk;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  // The pill grows 32 → 56 dp wide on selection (shape morph #2). Width cannot
  // run on the native driver, so this one spring is JS-driven.
  const width = useRef(new Animated.Value(isFocused ? NAV_INDICATOR.width : NAV_INDICATOR.from)).current;
  const wasFocused = useRef(isFocused);

  useEffect(() => {
    if (wasFocused.current === isFocused) return;
    wasFocused.current = isFocused;
    if (!isFocused) {
      width.setValue(NAV_INDICATOR.from);
      return;
    }
    if (indicatorSnapsInstantly(reducedMotion)) {
      width.setValue(NAV_INDICATOR.width);
      return;
    }
    width.setValue(NAV_INDICATOR.from);
    Animated.spring(width, { toValue: NAV_INDICATOR.width, ...animatedSpring('fastSpatial', false) }).start();
  }, [isFocused, reducedMotion, width]);

  const labelStyle = isFocused ? emphasized('meta') : TYPE.meta;

  return (
    <PressableScale
      testID={`nav-slot-${route.name}`}
      style={s.slot}
      feedback="layer"
      onPress={onPress}
      accessibilityRole="tab"
      {...a11yState({ selected: isFocused })}
      accessibilityLabel={label}
    >
      <View style={s.indicatorWrap}>
        {isFocused ? (
          <Animated.View
            testID={`nav-indicator-${route.name}`}
            pointerEvents="none"
            style={[s.indicator, { backgroundColor: ink.pill, width }]}
          />
        ) : null}
        <NavIcon
          name={icon}
          color={isFocused ? ink.activeIcon : ink.idle}
          testID={`nav-icon-${route.name}`}
        />
        {badge !== undefined ? <UnreadDot value={badge} slotKey={route.name} colors={colors} /> : null}
      </View>
      <Text
        style={[s.label, labelStyle, { color: isFocused ? ink.activeLabel : ink.idle }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

function CreateSlot({
  label, colors, open, reducedMotion, onPress,
}: {
  label: string;
  colors: ThemeColors;
  open: boolean;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  // The plus turns 45° into a close × while the sheet is open (shape morph #3).
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    if (reducedMotion) turn.setValue(open ? 1 : 0);
    else Animated.spring(turn, { toValue: open ? 1 : 0, ...animatedSpring('spatial') }).start();
  }, [open, reducedMotion, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  return (
    <Pressable
      testID="nav-slot-create"
      style={s.slot}
      onPress={onPress}
      onPressIn={() => runSpring(press, PRESS.scale, 'fastSpatial', reducedMotion)}
      onPressOut={() => runSpring(press, 1, 'fastSpatial', reducedMotion)}
      accessibilityRole="button"
      accessibilityLabel={open ? 'Close create menu' : label}
      accessibilityHint={open ? undefined : 'Choose what to create'}
    >
      <Animated.View
        testID="nav-create-key"
        style={[s.createKey, { backgroundColor: colors.pink, transform: [{ scale: press }] }]}
      >
        <Animated.View testID="nav-create-glyph" style={{ transform: [{ rotate }] }}>
          <Text testID="nav-create-icon" style={[s.createPlus, { color: colors.onPink }]}>+</Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
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

  const focusedName = state.routes[state.index]?.name;
  const ink = barInk(colors, focusedName === 'feed');

  return (
    <View testID="nav-bar" style={[s.bar, { backgroundColor: ink.ground, paddingBottom: bottomInset }]}>
      <View testID="nav-pill" style={[s.row, { backgroundColor: ink.ground }]}>
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
              reducedMotion={reducedMotion}
              onPress={() => {
                // Haptics stay under Reduce Motion (direction › Motion).
                if (!isFocused) haptic('select');
                onTabPress(route, isFocused);
              }}
            />
          );
        })}
      </View>
    </View>
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
    height: NAV_INDICATOR.height,
    borderRadius: RADII.pill,
  },
  label: {
    textAlign: 'center',
  },
  dot: {
    position: 'absolute',
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
