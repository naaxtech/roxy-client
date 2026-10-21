import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';

/** The seal's diameter in dp (board v2-03: about a quarter of the poster). */
export const SEAL_SIZE = 104;
/** Points on the burst — the one 16-point burst in Roxy's shape library. */
export const SEAL_POINTS = 16;
/** The stamp's angle on the poster corner. */
export const SEAL_TILT = '9deg';
/** The seal's surface-coloured rim, a hard edge (no blur). */
const RIM = 3;

/**
 * The SVG path of a `points`-point burst inscribed in a `size` box: outer
 * vertices on the rim, inner vertices a little inside, straight edges. Kept
 * pure so a test can count the vertices — a burst with petals would be the
 * banned flower.
 */
export function burstPath(size: number, points = SEAL_POINTS, depth = 0.86): string {
  const c = size / 2;
  const outer = c - RIM;
  const inner = outer * depth;
  const parts: string[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? outer : inner;
    const x = (c + r * Math.cos(angle)).toFixed(2);
    const y = (c + r * Math.sin(angle)).toFixed(2);
    parts.push(`${i === 0 ? 'M' : 'L'}${x} ${y}`);
  }
  return `${parts.join(' ')} Z`;
}

interface Props {
  size?: number;
  testID?: string;
}

/**
 * "You're going" — the RSVP seal (design direction v2 › signature moment 3,
 * board v2-03). A 16-point burst in `pink` with a `surface` rim, a check and
 * the words in `onPink`. Static: the event screen springs it from the
 * "I'm going" button into the poster's corner and tilts it 9°.
 *
 * The burst is the only star shape Roxy allows; M3's flower, clover, cookie,
 * soft-burst and puffy shapes are banned because they read as flowers.
 */
export function GoingSeal({ size = SEAL_SIZE, testID }: Props) {
  const colors = useThemeColors();
  const s = StyleSheet.create({
    wrap: { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
    words: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 0 },
    text: { ...TYPE.label, color: colors.onPink, textAlign: 'center' },
  });
  return (
    <View style={s.wrap} testID={testID} accessible accessibilityLabel="You're going">
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Path
          d={burstPath(size)}
          fill={colors.pink}
          stroke={colors.surface}
          strokeWidth={RIM}
          strokeLinejoin="round"
        />
      </Svg>
      <View style={s.words} pointerEvents="none">
        <Ionicons name="checkmark" size={20} color={colors.onPink} />
        <Text style={s.text}>{'You’re\ngoing'}</Text>
      </View>
    </View>
  );
}
