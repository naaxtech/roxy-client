import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { LIP, RADII } from '../../lib/theme';
import { PRESS, headStart, springTo } from '../../lib/motion';
import { TYPE } from '../../lib/typography';

/** Face height (direction › Spacing: buttons 52). */
export const PRIMARY_FACE_HEIGHT = 52;

type Props = {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  /** Shows a progress indicator and blocks presses while work is in flight. */
  busy?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Layout only (margins, alignSelf, width). Colours and shape are the button's. */
  style?: StyleProp<ViewStyle>;
};

/**
 * The ONE primary button per screen (design direction v2 › Motion › Press
 * states; Duolingo's lip).
 *
 * A `pink` face sits on a 3 dp `pinkLip` (a hard offset, no blur). Press-in
 * drops the face onto the lip on `SPRING.fastSpatial`; release springs it back.
 * Disabled (or busy): a `raised` face, an `ink3` label, no lip — visibly
 * waiting, not broken. The label is `onPink`: white on the light #C8126A
 * (5.60:1), the dark ink on the dark #F22481 (4.96:1).
 *
 * Every other pressable uses `PressableScale`; this is the only control with
 * a lip, which is what makes "the one thing to do here" read at a glance.
 *
 * The drop is a reanimated shared value set in the press handler (Wave 3,
 * motion spec F1): it starts on the UI thread in the next frame, no React
 * render per frame, and on web there is no 50 ms press delay.
 */

/** RN-web reads `delayPressIn` (default 50 ms); native Pressable has no delay. */
function noPressDelay(): Record<string, number> {
  return Platform.OS === 'web' ? { delayPressIn: 0 } : {};
}
export function PrimaryButton({
  label,
  onPress,
  testID,
  disabled = false,
  busy = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: Props) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const drop = useSharedValue(0);
  const inert = disabled || busy;

  const press = (to: number) => {
    if (inert) return;
    if (reducedMotion) {
      drop.value = to;
    } else if (to > 0 && drop.value <= 0.01) {
      // From rest: leave one frame into the spring (F1, painted next frame).
      const { start, config } = headStart(0, to, 'fastSpatial', { px: true });
      drop.value = start;
      drop.value = withSpring(to, config);
    } else {
      drop.value = withSpring(to, springTo('fastSpatial', { px: true }));
    }
  };
  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drop.value }] }));

  const faceColor = inert ? colors.raised : colors.pink;
  const inkColor = inert ? colors.ink3 : colors.onPink;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onPressIn={() => press(PRESS.lipDrop)}
      onPressOut={() => press(0)}
      {...noPressDelay()}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy }}
      style={[s.hit, style]}
    >
      {inert ? null : (
        <View
          testID={testID ? `${testID}-lip` : undefined}
          pointerEvents="none"
          style={[s.lip, { backgroundColor: colors.pinkLip }]}
        />
      )}
      <Animated.View
        testID={testID ? `${testID}-face` : undefined}
        style={[s.face, { backgroundColor: faceColor }, faceStyle]}
      >
        {busy ? (
          <ActivityIndicator testID={testID ? `${testID}-busy` : undefined} color={inkColor} />
        ) : (
          <Text style={[s.label, { color: inkColor }]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  hit: {
    minHeight: PRIMARY_FACE_HEIGHT + LIP,
    justifyContent: 'flex-start',
  },
  lip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: LIP,
    height: PRIMARY_FACE_HEIGHT,
    borderRadius: RADII.pill,
  },
  face: {
    height: PRIMARY_FACE_HEIGHT,
    borderRadius: RADII.pill,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...TYPE.button,
  },
});
