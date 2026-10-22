import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { RADII, SPACE, scrim as scrimColor } from '../../lib/theme';
import { GESTURE, fadeConfig, projectRelease, rubberBand, springTo } from '../../lib/motion';

/**
 * The ONE bottom sheet (polish/motion-spec.md §1.3 rules 2, 3, 5; §3.1 row 6;
 * budgets F5, F12). Wave 3 lane C0; adopters: Create (A), comments and feed
 * sheets (B), Hello Roxy (C), the rest (D).
 *
 * Motion:
 *  - Rises from the bottom edge on `SPRING.spatial` (pixel rest threshold);
 *    ONLY the scrim fades (`SPRING.effects`). The surface is never translucent.
 *  - The drag runs on the UI thread and tracks the finger 1:1 downward,
 *    rubber-bands upward. On release the end state comes from the PROJECTED
 *    position (WWDC18): dismiss past `GESTURE.dismissFraction` of the height
 *    or above `GESTURE.flingDpPerS`; otherwise spring back carrying the
 *    release velocity.
 *  - Every move retargets from where it is: reopening mid-exit, a scrim tap
 *    mid-open, a grab mid-flight. Nothing waits on a completion callback; it
 *    unmounts on a timer once it is off screen (`SHEET_EXIT_MS`).
 *  - Reduce Motion: the sheet is simply there / gone; the scrim fades 120 ms.
 *
 * Semantics: an RN `Modal` (Android back and web Escape → `onClose`; RN-web
 * traps focus inside and restores it), `accessibilityViewIsModal`, a name
 * (`accessibilityLabel`), VoiceOver's escape gesture, and the scrim is a
 * "Close" button. `dismissible={false}` turns every close path off.
 *
 * Contract: `onClose` is a REQUEST — set `visible` to false in it. The sheet
 * animates out and unmounts itself; `onClosed` fires after it is gone.
 * `dragFrom="handle"` (default) keeps scrolling content scrollable; use
 * `"sheet"` only for content that does not scroll.
 *
 * testIDs: `<testID>` surface, `<testID>-scrim` (the fading layer),
 * `<testID>-scrim-press` (the Close target), `<testID>-handle`;
 * gesture test id `<testID>-pan`.
 */

/** The scrim's ink alpha at full open (the stage's warm black). */
export const SHEET_SCRIM_ALPHA = 0.4;
/** Unmount after this long off screen (F5: settled ≤ 450 ms). */
export const SHEET_EXIT_MS = 450;

export type SheetProps = {
  visible: boolean;
  /** She asked to close (scrim, drag, back, Escape). Set `visible` false here. */
  onClose: () => void;
  children: ReactNode;
  /** After it has left the screen and unmounted. */
  onClosed?: () => void;
  /** Screen-reader name of the sheet, e.g. "Create". */
  accessibilityLabel?: string;
  /** Label of the scrim's close action (default "Close"). */
  closeLabel?: string;
  /** false: no scrim / drag / back / Escape close (a step she must finish). */
  dismissible?: boolean;
  /** Where a drag can start. Default `handle`. */
  dragFrom?: 'handle' | 'sheet';
  /** Show the grabber bar (default true). */
  showHandle?: boolean;
  /** Tallest the sheet may grow (default 90% of the window). */
  maxHeight?: DimensionValue;
  /** The surface (padding, gap). Colour and shape are the sheet's. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// Partial jest mocks elsewhere may lack these; degrade to static views.
const animatable = typeof Reanimated?.createAnimatedComponent === 'function';
const AnimatedView = (animatable ? Reanimated.View : View) as unknown as typeof View;
const RootView = (GestureHandlerRootView ?? View) as unknown as typeof View;
const canPan = typeof Gesture?.Pan === 'function' && typeof GestureDetector === 'function';
const NoInsets = createContext<EdgeInsets | null>(null);
const InsetsContext = SafeAreaInsetsContext ?? NoInsets;

export function Sheet({
  visible,
  onClose,
  children,
  onClosed,
  accessibilityLabel,
  closeLabel = 'Close',
  dismissible = true,
  dragFrom = 'handle',
  showHandle = true,
  maxHeight = '90%',
  style,
  testID = 'sheet',
}: SheetProps) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const insets = useContext(InsetsContext);
  const { height: windowH } = useWindowDimensions();

  const [mounted, setMounted] = useState(visible);
  /** Offset from the open position, px (0 = open, sheet height = gone). */
  const y = useSharedValue(windowH);
  /** Measured sheet height, px. */
  const h = useSharedValue(0);
  /** Scrim progress 0 → 1. */
  const scrimP = useSharedValue(0);
  const dragStart = useSharedValue(0);

  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByGesture = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const open = useCallback(() => {
    if (reduced) {
      y.value = 0;
      scrimP.value = withTiming(1, fadeConfig());
    } else {
      y.value = withSpring(0, springTo('spatial', { px: true }));
      scrimP.value = withSpring(1, springTo('effects'));
    }
  }, [reduced, y, scrimP]);

  const leave = useCallback(() => {
    const off = h.value > 0 ? h.value : windowH;
    if (reduced) {
      y.value = off;
      scrimP.value = withTiming(0, fadeConfig());
    } else {
      y.value = withSpring(off, springTo('spatial', { px: true }));
      scrimP.value = withSpring(0, springTo('effects'));
    }
  }, [reduced, y, h, scrimP, windowH]);

  useEffect(() => {
    if (visible) {
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
      unmountTimer.current = null;
      closedByGesture.current = false;
      setMounted(true);
      open();
      return;
    }
    if (!mounted) return;
    // A fling already sent it away on the UI thread, with its velocity.
    if (!closedByGesture.current) leave();
    closedByGesture.current = false;
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    unmountTimer.current = setTimeout(() => {
      unmountTimer.current = null;
      setMounted(false);
      onClosedRef.current?.();
    }, reduced ? fadeConfig().duration : SHEET_EXIT_MS);
    // Only `visible` drives open/close; the callbacks are read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(
    () => () => {
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
    },
    [],
  );

  const requestClose = useCallback(() => {
    if (dismissible) onCloseRef.current();
  }, [dismissible]);

  const dismissedByGesture = useCallback(() => {
    closedByGesture.current = true;
    onCloseRef.current();
  }, []);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      h.value = e.nativeEvent.layout.height;
    },
    [h],
  );

  const pan = canPan
    ? Gesture.Pan()
        .withTestId(`${testID}-pan`)
        .onStart(() => {
          dragStart.value = y.value;
        })
        .onUpdate((e) => {
          const height = h.value > 0 ? h.value : windowH;
          const next = dragStart.value + e.translationY;
          // Up past open, or any way at all when she cannot dismiss: resist.
          y.value = next < 0 || !dismissible ? rubberBand(next, height) : next;
          scrimP.value = 1 - Math.min(Math.max(y.value / height, 0), 1);
        })
        .onEnd((e) => {
          const height = h.value > 0 ? h.value : windowH;
          const projected = projectRelease(y.value, e.velocityY);
          const dismiss =
            dismissible && (projected > height * GESTURE.dismissFraction || e.velocityY > GESTURE.flingDpPerS);
          if (dismiss) {
            if (reduced) {
              y.value = height;
              scrimP.value = withTiming(0, fadeConfig());
            } else {
              y.value = withSpring(height, springTo('spatial', { px: true, velocity: e.velocityY }));
              scrimP.value = withSpring(0, springTo('effects'));
            }
            runOnJS(dismissedByGesture)();
          } else if (reduced) {
            y.value = 0;
            scrimP.value = withTiming(1, fadeConfig());
          } else {
            y.value = withSpring(0, springTo('spatial', { px: true, velocity: e.velocityY }));
            scrimP.value = withSpring(1, springTo('effects'));
          }
        })
    : null;

  const sheetMotion = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const scrimMotion = useAnimatedStyle(() => ({ opacity: scrimP.value }));

  if (!mounted) return null;

  const handle = showHandle ? (
    <View testID={`${testID}-handle`} style={styles.handleZone} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.grabber, { backgroundColor: colors.control }]} />
    </View>
  ) : null;

  const surface = (
    <AnimatedView
      testID={testID}
      accessibilityViewIsModal
      accessibilityLabel={accessibilityLabel}
      onAccessibilityEscape={requestClose}
      onLayout={onLayout}
      style={[
        styles.sheet,
        { backgroundColor: colors.surface, paddingBottom: insets?.bottom ?? 0, maxHeight },
        style,
        sheetMotion,
      ] as StyleProp<ViewStyle>}
    >
      {pan && dragFrom === 'handle' && handle ? <GestureDetector gesture={pan}>{handle}</GestureDetector> : handle}
      {children}
    </AnimatedView>
  );

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      <RootView style={styles.root}>
        <Pressable
          testID={`${testID}-scrim-press`}
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessible={dismissible}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        >
          <AnimatedView
            testID={`${testID}-scrim`}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor(SHEET_SCRIM_ALPHA) }, scrimMotion] as StyleProp<ViewStyle>}
          />
        </Pressable>
        {pan && dragFrom === 'sheet' ? <GestureDetector gesture={pan}>{surface}</GestureDetector> : surface}
      </RootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: FRAME_MAX_WIDTH,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    overflow: 'hidden',
  },
  handleZone: { alignItems: 'center', paddingTop: SPACE[1], paddingBottom: SPACE[1], minHeight: SPACE[5] },
  grabber: { width: 32, height: 4, borderRadius: RADII.pill },
});
