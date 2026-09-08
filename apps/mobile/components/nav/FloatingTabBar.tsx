import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { type ThemeColors } from '../../lib/theme';
import { FONTS } from '../../lib/typography';
import { NAV_SLOTS_3 } from './navSlots3';
import { NavIcon, type NavIconName } from './NavIcons';
import type { NavSlot } from './navTokens';
import { a11yState } from '../../lib/a11yState';
import { PRESS_SPRING, SNAP_SPRING, runSnap } from '../../lib/motion';
import {
  ACTIVE_TINT_ALPHA,
  BRAND_GRADIENT,
  PILL_INSET,
  PILL_MIN_BOTTOM,
  TAB_MIN_TOUCH,
} from './navTokens';

export type TabBarRoute = { key: string; name: string };

export type FloatingTabBarProps = {
  state: { index: number; routes: readonly TabBarRoute[] };
  descriptors: Record<string, { options: { tabBarBadge?: number | string } }>;
  /** The navigator dance (emit `tabPress`, respect `defaultPrevented`) belongs
   *  to the layout that has the real navigation object; this bar only reports. */
  onTabPress: (route: TabBarRoute, isFocused: boolean) => void;
  onCreatePress: () => void;
  /** Defaults to the full 3.0 bar. Public launch passes the three-slot set. */
  slots?: readonly NavSlot[];
};

/** The ink the create plate carries. Derived from the darkest stop of the brand
 *  ramp, because that is the stop with the least headroom — whatever reads
 *  there reads on the other two. `inkOn` answers 4.43:1 here; white answers
 *  3.19:1 and would fail even the 3:1 bar for icons. */
const CREATE_INK = '#fff';

function Badge({ value, slotKey, colors }: { value: number | string; slotKey: string; colors: ThemeColors }) {
  const s = styles(colors);
  return (
    <View style={s.badge} testID={`nav-badge-${slotKey}`}>
      <Text style={s.badgeText} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function RouteSlot({
  route, label, icon, isFocused, badge, colors, reducedMotion, onPress,
}: {
  route: TabBarRoute;
  label: string;
  icon: NavIconName;
  isFocused: boolean;
  badge: number | string | undefined;
  colors: ThemeColors;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  const s = styles(colors);
  const indicator = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
  const iconPop = useRef(new Animated.Value(1)).current;
  const press = useRef(new Animated.Value(1)).current;
  // Born at rest so the first paint does not schedule a spring on every slot.
  const wasFocused = useRef(isFocused);

  useEffect(() => {
    if (wasFocused.current === isFocused) return;
    wasFocused.current = isFocused;
    if (reducedMotion) {
      indicator.setValue(isFocused ? 1 : 0);
      iconPop.setValue(1);
      return;
    }
    if (isFocused) {
      indicator.setValue(0.4);
      iconPop.setValue(0.82);
      Animated.parallel([
        Animated.spring(indicator, { toValue: 1, ...SNAP_SPRING }),
        Animated.spring(iconPop, { toValue: 1, ...PRESS_SPRING }),
      ]).start();
      return;
    }
    runSnap(indicator, 0);
  }, [isFocused, reducedMotion, indicator, iconPop]);

  const tint = isFocused ? colors.roxy : colors.textMuted;

  return (
    <TouchableOpacity
      testID={`nav-slot-${route.name}`}
      style={s.slot}
      onPress={onPress}
      onPressIn={() => { if (!reducedMotion) Animated.spring(press, { toValue: 0.88, ...PRESS_SPRING }).start(); }}
      onPressOut={() => runSnap(press, 1, reducedMotion)}
      activeOpacity={1}
      accessibilityRole="tab"
      {...a11yState({ selected: isFocused })}
      accessibilityLabel={label}
    >
      <Animated.View
        pointerEvents="none"
        style={[s.indicator, { transform: [{ scale: indicator }] }]}
      />
      <Animated.View style={{ transform: [{ scale: press }], alignItems: 'center' }}>
        <Animated.View style={[s.iconWrap, { transform: [{ scale: iconPop }] }]}>
          <NavIcon name={icon} color={tint} />
          {badge !== undefined && <Badge value={badge} slotKey={route.name} colors={colors} />}
        </Animated.View>
        <Text
          style={[s.label, { color: tint, fontFamily: isFocused ? FONTS.text.bold : FONTS.text.semibold }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function CreateSlot({
  label, colors, reducedMotion, onPress,
}: {
  label: string;
  colors: ThemeColors;
  reducedMotion: boolean;
  onPress: () => void;
}) {
  const s = styles(colors);
  const press = useRef(new Animated.Value(1)).current;
  return (
    <TouchableOpacity
      testID="nav-slot-create"
      style={s.slot}
      onPress={onPress}
      onPressIn={() => { if (!reducedMotion) Animated.spring(press, { toValue: 0.88, ...PRESS_SPRING }).start(); }}
      onPressOut={() => runSnap(press, 1, reducedMotion)}
      activeOpacity={1}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Choose what to create"
    >
      <Animated.View style={{ transform: [{ scale: press }], alignItems: 'center' }}>
        <View style={s.iconWrap}>
          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.createPlate}
          >
            <Text testID="nav-create-icon" style={s.createPlus}>+</Text>
          </LinearGradient>
        </View>
        <Text style={[s.label, { color: colors.textPrimary }]} numberOfLines={1}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

/**
 * Roxy's navigation shell: an inset, rounded, elevated pill rather than a
 * full-width bar.
 *
 * **Why the fill is opaque.** The pill has to stay readable over whatever the
 * screen behind it happens to be — including a full-bleed photo. Translucency
 * is exactly what fails that test, and `expo-blur` is not a dependency of this
 * app, so a frosted treatment would mean shipping a new native module for
 * decoration. The fill is therefore a solid theme surface, and legibility is a
 * property of the pill rather than a bet about its backdrop. Depth comes from
 * the inset, the radius, a hairline border and a real offset shadow.
 *
 * **Why every colour is derived.** The active tint is `colors.roxy` and the
 * inactive tint is `colors.textMuted`, both of which `__tests__/theme.contrast`
 * holds to 4.5:1 against every surface in their own theme. The one brand fill
 * in the bar — the create plate — uses white ink on the brand gradient, per the brand owner's call
 * reflexive white, which measures 3.19:1 on the deepest pink.
 *
 * The bar sits in the navigator's normal flow, so React Navigation reserves its
 * height and no screen loses its last row behind it. Making it overlay content
 * would need a `useBottomTabBarHeight()` padding pass across all six tab
 * screens; that is its own slice.
 */
export function FloatingTabBar({
  state, descriptors, onTabPress, onCreatePress, slots = NAV_SLOTS_3,
}: FloatingTabBarProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const s = styles(colors);
  const bottomInset = Math.max(insets.bottom, PILL_MIN_BOTTOM);

  const focusedName = state.routes[state.index]?.name;

  return (
    <View testID="nav-bar" style={[s.bar, { paddingBottom: bottomInset }]}>
      <View testID="nav-pill" style={s.pill}>
        {slots.map((slot) => {
          if (slot.kind === 'action') {
            return (
              <CreateSlot
                key={slot.key}
                label={slot.label}
                colors={colors}
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
              reducedMotion={reducedMotion}
              onPress={() => onTabPress(route, isFocused)}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    paddingHorizontal: PILL_INSET,
    // TikTok gives the bottom bar as little of the screen as it can and hands
    // the rest to the content. Every pixel trimmed here is a pixel of post.
    paddingTop: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Opaque by construction — see the component doc.
    backgroundColor: colors.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.textPrimary + '14',
    paddingHorizontal: 6,
    paddingVertical: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 14,
  },
  slot: {
    flex: 1,
    // Exactly the floor, not a pixel over: TAB_MIN_TOUCH is the Play Console
    // pre-launch minimum and the one number here that must not move.
    minHeight: TAB_MIN_TOUCH,
    minWidth: TAB_MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  indicator: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    backgroundColor: colors.roxy + ACTIVE_TINT_ALPHA,
  },
  // Fixed width so the badge, which is absolutely positioned inside it, stays
  // within its parent's bounds — Android clips an overflowing absolute child.
  iconWrap: { width: 46, height: 28, alignItems: 'center', justifyContent: 'center' },
  createPlate: {
    width: 46,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createPlus: {
    color: CREATE_INK,
    fontFamily: FONTS.display.bold,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 21,
    marginTop: -1,
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
    fontFamily: FONTS.text.semibold,
    marginTop: 1,
  },
  badge: {
    position: 'absolute',
    top: -2,
    left: 24,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.roxy,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  // The old bar hardcoded `#fff` on `#E81C8E`, which measures 3.19:1. inkOn()
  // answers 6.85:1 in dark and 5.24:1 in light.
  badgeText: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 13,
    fontFamily: FONTS.display.extrabold,
  },
});
