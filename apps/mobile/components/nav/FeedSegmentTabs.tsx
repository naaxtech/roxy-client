import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { TouchableOpacity } from '../ui/PressableScale';
import { STAGE } from '../feed/stageColors';
import { FEED_SEGMENTS, type FeedSegment } from '../feed/FeedSegments';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { SPRING, springTo } from '../../lib/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { startWebSpring } from '../motion/webSpring';

/**
 * The underline is one bar this wide, scaled to the chosen word's rule and
 * centred on it: a transform, never a width, so it moves without relayout.
 */
export const UNDERLINE_BASE = 100;

type Rect = { x: number; y: number; w: number };
type Place = { left: number; top: number; width: number };

const underlineTransform = (left: number, width: number) => ({
  translateX: left + width / 2 - UNDERLINE_BASE / 2,
  scaleX: width / UNDERLINE_BASE,
});
const cssTransform = ({ left, width }: Place) => {
  const t = underlineTransform(left, width);
  return `translateX(${t.translateX}px) scaleX(${t.scaleX})`;
};

interface Props {
  value: FeedSegment;
  onChange: (next: FeedSegment) => void;
}

/**
 * The Feed's segment tabs (For You · Following · Communities) with an
 * underline that slides and resizes to the chosen word (motion spec §3.1
 * row 3, `fastSpatial`). The Feed used to swap one tab's rule for another's,
 * a jump cut in the first thing a member sees.
 *
 * Layout, copy, ink and accessibility are those of `../feed/FeedSegments`
 * (a tab bar on the always-dark stage; the active tab marked by weight AND a
 * rule, never colour alone). The weight switches at once — text never
 * animates — and only the underline moves:
 * - before the row can measure itself, the chosen tab draws its own rule, so
 *   no frame is ever without one;
 * - once measured, one shared underline sits on the chosen rule and the
 *   per-tab rules go transparent;
 * - native: reanimated springs on the UI thread; web: a compositor animation
 *   (WAAPI) with the same curve, because reanimated's web springs run on the
 *   main thread (jank audit #7);
 * - Reduce Motion: the underline jumps.
 */
export function FeedSegmentTabs({ value, onChange }: Props) {
  const isWeb = Platform.OS === 'web';
  const reducedMotion = useReducedMotion();
  const tabs = useRef<Partial<Record<FeedSegment, { x: number; y: number }>>>({});
  const rules = useRef<Partial<Record<FeedSegment, Rect>>>({});
  const [, setMeasured] = useState(0);

  const placeOf = (key: FeedSegment): Place | null => {
    const tab = tabs.current[key];
    const rule = rules.current[key];
    if (!tab || !rule) return null;
    return { left: tab.x + rule.x, top: tab.y + rule.y, width: rule.w };
  };
  const target = placeOf(value);

  const left = useSharedValue(target?.left ?? 0);
  const width = useSharedValue(target?.width ?? UNDERLINE_BASE);
  const placed = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  /** First placement: put the underline there before it shows (no slide in from 0). */
  const remeasure = useCallback(() => {
    const tab = tabs.current[valueRef.current];
    const rule = rules.current[valueRef.current];
    if (!placed.current && tab && rule) {
      placed.current = true;
      left.value = tab.x + rule.x;
      width.value = rule.w;
    }
    setMeasured((n) => n + 1);
  }, [left, width]);

  const onTabLayout = useCallback((key: FeedSegment) => (e: LayoutChangeEvent) => {
    const { x, y } = e.nativeEvent.layout;
    tabs.current[key] = { x, y };
    remeasure();
  }, [remeasure]);
  const onRuleLayout = useCallback((key: FeedSegment) => (e: LayoutChangeEvent) => {
    const { x, y, width: w } = e.nativeEvent.layout;
    rules.current[key] = { x, y, w };
    remeasure();
  }, [remeasure]);
  const tabLayouts = useMemo(
    () => Object.fromEntries(FEED_SEGMENTS.map((seg) => [seg.key, onTabLayout(seg.key)])),
    [onTabLayout],
  ) as Record<FeedSegment, (e: LayoutChangeEvent) => void>;
  const ruleLayouts = useMemo(
    () => Object.fromEntries(FEED_SEGMENTS.map((seg) => [seg.key, onRuleLayout(seg.key)])),
    [onRuleLayout],
  ) as Record<FeedSegment, (e: LayoutChangeEvent) => void>;

  // Native: slide and resize on the UI thread (Reduce Motion: jump).
  const toLeft = target?.left;
  const toWidth = target?.width;
  useEffect(() => {
    if (isWeb || toLeft === undefined || toWidth === undefined) return;
    if (reducedMotion) {
      left.value = toLeft;
      width.value = toWidth;
    } else {
      left.value = withSpring(toLeft, springTo('fastSpatial', { px: true }));
      width.value = withSpring(toWidth, springTo('fastSpatial', { px: true }));
    }
  }, [isWeb, reducedMotion, toLeft, toWidth, left, width]);

  // Web: the element rests at its target; the compositor plays the move from
  // where it was, before the browser paints the new place.
  const webLine = useRef<View>(null);
  const webFrom = useRef<Place | null>(null);
  const toTop = target?.top;
  useLayoutEffect(() => {
    if (!isWeb || toLeft === undefined || toWidth === undefined || toTop === undefined) return;
    const to = { left: toLeft, top: toTop, width: toWidth };
    const from = webFrom.current;
    webFrom.current = to;
    if (!from || reducedMotion) return;
    startWebSpring(
      webLine.current as unknown as Element,
      [{ transform: cssTransform(from) }, { transform: cssTransform(to) }],
      SPRING.fastSpatial,
    );
  }, [isWeb, reducedMotion, toLeft, toTop, toWidth]);

  const animatedLine = useAnimatedStyle(() => ({
    transform: [
      { translateX: left.value + width.value / 2 - UNDERLINE_BASE / 2 },
      { scaleX: width.value / UNDERLINE_BASE },
    ],
  }));

  const shown = target !== null;
  const resting = target ? underlineTransform(target.left, target.width) : null;
  const restingLine = resting
    ? { transform: [{ translateX: resting.translateX }, { scaleX: resting.scaleX }] }
    : null;
  const lineStyle = [
    s.underline,
    { top: target?.top ?? 0, opacity: shown ? 1 : 0 },
  ];

  return (
    <View style={s.row} accessibilityRole="tablist" testID="feed-segments">
      {FEED_SEGMENTS.map((seg) => {
        const on = seg.key === value;
        return (
          <TouchableOpacity
            key={seg.key}
            testID={`feed-segment-${seg.key}`}
            onPress={() => onChange(seg.key)}
            onLayout={tabLayouts[seg.key]}
            accessibilityRole="tab"
            {...a11yState({ selected: on })}
            accessibilityLabel={seg.label}
            activeOpacity={0.8}
            style={s.tab}
          >
            <Text style={[s.label, on ? s.labelOn : s.labelOff]}>{seg.label}</Text>
            <View
              testID={`feed-segment-rule-${seg.key}`}
              onLayout={ruleLayouts[seg.key]}
              style={[s.rule, on && !shown ? s.ruleOn : s.ruleOff]}
            />
          </TouchableOpacity>
        );
      })}
      {isWeb || reducedMotion ? (
        <View
          ref={webLine}
          testID="feed-segment-underline"
          pointerEvents="none"
          style={[lineStyle, restingLine]}
        />
      ) : (
        <Animated.View
          testID="feed-segment-underline"
          pointerEvents="none"
          style={[lineStyle, animatedLine]}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // As FeedSegments: tight, so the content owns the screen; the touch height
  // stays at MIN_TOUCH_TARGET.
  row: { flexDirection: 'row', justifyContent: 'center', gap: 18 },
  tab: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  label: { ...TYPE.bodyLg },
  labelOn: { color: STAGE.textPrimary, fontWeight: '700' },
  labelOff: { color: STAGE.textSecondary, fontWeight: '600' },
  rule: { height: 2, width: '100%', marginTop: 2, borderRadius: 2 },
  ruleOn: { backgroundColor: STAGE.primaryInk },
  ruleOff: { backgroundColor: 'transparent' },
  underline: {
    position: 'absolute',
    left: 0,
    width: UNDERLINE_BASE,
    height: 2,
    borderRadius: 2,
    backgroundColor: STAGE.primaryInk,
  },
});
