import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

/**
 * The keyboard, followed frame by frame in a chat (motion spec F14, §3.1 #15).
 *
 * - **iOS and Android 11+**: reanimated's `useAnimatedKeyboard` drives a
 *   spacer under the composer on the UI thread, so the composer rides the
 *   keyboard's top edge while it animates and an inverted message list keeps
 *   the newest message in view. No jump at the end (Android's `adjustResize`
 *   used to resize once, after the animation).
 * - **Android 10 and below**: the hook's tracking is unreliable there, and
 *   while mounted it turns the system resize off for the WHOLE app (reanimated
 *   docs; spec §4.1). So below API 30 nothing is mounted and the system
 *   resize (`softwareKeyboardLayoutMode: resize`) does the work, as before.
 * - **Web**: no keyboard events. The composer sits on `visualViewport`: the
 *   bottom inset is the part of the layout viewport the keyboard covers.
 *
 * Mount it on chat screens only (DM, channel): the hook is app-wide while
 * mounted.
 */

/** Android 11 (API 30): from here `useAnimatedKeyboard` tracks reliably. */
export const ANDROID_TRACKING_MIN_API = 30;

export type KeyboardMode = 'track' | 'legacy' | 'web';

export function keyboardMode(os: string = Platform.OS, version: number | string = Platform.Version): KeyboardMode {
  if (os === 'web') return 'web';
  if (os === 'android' && Number(version) < ANDROID_TRACKING_MIN_API) return 'legacy';
  return 'track';
}

/** How much of the layout viewport's bottom the on-screen keyboard covers (px). */
export function keyboardOverlap(innerHeight: number, vv: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(innerHeight - (vv.height + vv.offsetTop)));
}

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function KeyboardTrackingView(props: Props) {
  const mode = keyboardMode();
  if (mode === 'web') return <ViewportView {...props} />;
  if (mode === 'legacy') {
    return (
      <KeyboardAvoidingView style={props.style} behavior={undefined} testID={props.testID}>
        {props.children}
      </KeyboardAvoidingView>
    );
  }
  return <TrackingView {...props} />;
}

function TrackingView({ children, style, testID }: Props) {
  // Expo draws under a translucent Android status bar (SafeAreaView adds the
  // top inset), so the hook must not add it again.
  const keyboard = useAnimatedKeyboard({ isStatusBarTranslucentAndroid: true });
  const spacer = useAnimatedStyle(() => ({ height: Math.max(0, keyboard.height.value) }));
  return (
    <View style={style} testID={testID}>
      {children}
      <Animated.View style={spacer} testID={testID ? `${testID}-spacer` : undefined} />
    </View>
  );
}

type VisualViewportLike = {
  height: number;
  offsetTop: number;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
};

function ViewportView({ children, style, testID }: Props) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const w = globalThis as unknown as {
      visualViewport?: VisualViewportLike;
      innerHeight?: number;
      requestAnimationFrame?: (f: () => void) => number;
      cancelAnimationFrame?: (id: number) => void;
    };
    const vv = w.visualViewport;
    if (!vv) return undefined;
    let raf = 0;
    const update = () => {
      // One state write per frame at most, however many events fire.
      if (raf && w.cancelAnimationFrame) w.cancelAnimationFrame(raf);
      const apply = () => setInset(keyboardOverlap(w.innerHeight ?? vv.height, vv));
      raf = w.requestAnimationFrame ? w.requestAnimationFrame(apply) : (apply(), 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      if (raf && w.cancelAnimationFrame) w.cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <View style={[style, { paddingBottom: inset }]} testID={testID}>
      {children}
    </View>
  );
}
