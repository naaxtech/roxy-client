import { useEffect, useState } from 'react';
import { I18nManager, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { THEMES } from '../../lib/theme';

/**
 * The Roxy O — Roxy AI's mark (design direction v2 › The Roxy AI button).
 *
 * The O of the wordmark with a face in its counter: a ring in `pink`
 * (`brandPink` on the dark feed stage), a face disc at 64% of the diameter,
 * two eyes glancing toward the content and a lopsided smile. The face is the
 * same in both themes (light `surface` #FFFDFD, light `ink` #1A1216): she is a
 * character, not a surface, and the pairs are measured in the direction
 * (white face in the pink ring 5.60:1; on `brandPink` 3.88:1, marks need 3:1).
 *
 * Moods: `open` (rest), `happy` (greeting, success), `rest` (eyes closed:
 * tucked, or switched off in Settings), `think` (eyes up, flat mouth: writing).
 * With `blink` she closes her eyes for a moment every 4-7 s while `open`;
 * Reduce Motion keeps her still. In right to left only her glance mirrors.
 *
 * Paths are the concept boards' (`polish/concepts/roxy-concepts-v2.js`
 * `roxyO()`), viewBox 0 0 56 56. The app icon stays the wordmark.
 */
export type RoxyMood = 'open' | 'happy' | 'rest' | 'think';

export const BLINK_MIN_MS = 4000;
export const BLINK_MAX_MS = 7000;
/** How long her eyes stay closed in a blink. */
export const BLINK_HOLD_MS = 140;

/** The next wait between blinks, 4-7 s. `rand` is injectable for tests. */
export function nextBlinkDelay(rand: () => number = Math.random): number {
  return Math.round(BLINK_MIN_MS + rand() * (BLINK_MAX_MS - BLINK_MIN_MS));
}

const VIEW = 56;
const C = VIEW / 2;
/** The face disc: 64% of the diameter (r 18 of 28). */
const FACE_R = 18;
const STROKE = 2.8;

/** The face is a character, the same in both themes. */
const FACE = THEMES.light.surface;
const EYE = THEMES.light.ink;

const SMILE = 'M21.6 33.2q4.6 3.4 9.8-.8';

function Face({ mood, testID }: { mood: RoxyMood; testID?: string }) {
  const id = testID ? `${testID}-${mood}` : undefined;
  // Only the glance mirrors in right to left; the smile keeps its tilt.
  const mirror = I18nManager.isRTL ? `translate(${VIEW} 0) scale(-1 1)` : undefined;

  if (mood === 'happy') {
    return (
      <G testID={id}>
        <Path d="M18.6 27.2q2.8-4 5.6 0M28.4 27.2q2.8-4 5.6 0" fill="none" stroke={EYE} strokeWidth={STROKE} strokeLinecap="round" />
        <Path d="M21.2 32q5.2 4.8 10.6-.4" fill="none" stroke={EYE} strokeWidth={STROKE} strokeLinecap="round" />
      </G>
    );
  }
  if (mood === 'rest') {
    return (
      <G testID={id}>
        <Path d="M18.8 25.4q2.7 3.1 5.4 0M28.6 25.4q2.7 3.1 5.4 0" fill="none" stroke={EYE} strokeWidth={STROKE} strokeLinecap="round" />
        <Path d={SMILE} fill="none" stroke={EYE} strokeWidth={2.6} strokeLinecap="round" />
      </G>
    );
  }
  if (mood === 'think') {
    return (
      <G testID={id}>
        <G transform={mirror}>
          <Ellipse cx={25.4} cy={23} rx={2.8} ry={3.6} fill={EYE} />
          <Ellipse cx={34.2} cy={23} rx={2.8} ry={3.6} fill={EYE} />
        </G>
        <Path d="M25.4 33h6.4" stroke={EYE} strokeWidth={2.6} strokeLinecap="round" />
      </G>
    );
  }
  return (
    <G testID={id}>
      <G transform={mirror}>
        <Ellipse cx={21.4} cy={25} rx={2.8} ry={3.7} fill={EYE} />
        <Ellipse cx={30.8} cy={25} rx={2.8} ry={3.7} fill={EYE} />
      </G>
      <Path d={SMILE} fill="none" stroke={EYE} strokeWidth={2.6} strokeLinecap="round" />
    </G>
  );
}

export type RoxyOProps = {
  size?: number;
  mood?: RoxyMood;
  /** Ring colour. Default `pink`; `brandPink` on the stage; `control` when off. */
  ring?: string;
  /** Blink every 4-7 s while `open` (the FAB at rest). */
  blink?: boolean;
  /** Give it a name only where it stands alone; inside a labelled control it is decorative. */
  accessibilityLabel?: string;
  testID?: string;
};

export function RoxyO({ size = VIEW, mood = 'open', ring, blink = false, accessibilityLabel, testID }: RoxyOProps) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const [blinking, setBlinking] = useState(false);
  const canBlink = blink && mood === 'open' && !reducedMotion;

  useEffect(() => {
    if (!canBlink) {
      setBlinking(false);
      return undefined;
    }
    let open: ReturnType<typeof setTimeout> | null = null;
    let next: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      next = setTimeout(() => {
        setBlinking(true);
        open = setTimeout(() => {
          setBlinking(false);
          schedule();
        }, BLINK_HOLD_MS);
      }, nextBlinkDelay());
    };
    schedule();
    return () => {
      if (next) clearTimeout(next);
      if (open) clearTimeout(open);
    };
  }, [canBlink]);

  const shown: RoxyMood = blinking ? 'rest' : mood;
  const named = Boolean(accessibilityLabel);

  return (
    <View
      testID={testID}
      style={{ width: size, height: size }}
      accessible={named}
      accessibilityRole={named ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!named}
      importantForAccessibility={named ? 'yes' : 'no-hide-descendants'}
      pointerEvents="none"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <Circle testID={testID ? `${testID}-ring` : undefined} cx={C} cy={C} r={C} fill={ring ?? colors.pink} />
        <Circle testID={testID ? `${testID}-face` : undefined} cx={C} cy={C} r={FACE_R} fill={FACE} />
        <Face mood={shown} testID={testID} />
      </Svg>
    </View>
  );
}
