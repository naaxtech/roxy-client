import { View, StyleSheet, Platform } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import { useThemeColors } from '../../hooks/useThemeColors';

interface Props {
  rank: number;
}

/**
 * The Netflix rank numeral — an outlined digit that sits half-behind its card.
 *
 * Drawn with `react-native-svg` rather than a `<Text>` with a shadow, because
 * the effect is a *stroke*: the numeral is hollow, and the card art shows
 * through it. RN has no text-stroke, so this is SVG or nothing.
 *
 * On Android the stroke is applied via `stroke`/`strokeWidth` on the glyph,
 * which older Android WebView/Skia combinations render inconsistently at large
 * sizes. Rather than block the rail on it, Android gets a filled numeral in the
 * line colour — the ranking still reads, only the outline treatment is dropped.
 * That is the documented degrade, not an accident.
 */
export function RankNumeral({ rank }: Props) {
  const colors = useThemeColors();
  const label = String(rank);
  // Two digits need a wider box or the "1" of "10" clips at the leading edge.
  const width = label.length > 1 ? 72 : 46;

  return (
    <View style={[s.wrap, { width }]} pointerEvents="none" accessibilityElementsHidden>
      {/* 104, not 96. A 92px glyph with a 3px stroke overshoots its em box at
          the top and bottom, so a 96px canvas clipped the curve of every
          numeral — measured in the browser as scrollHeight 106 against
          clientHeight 100. The extra eight pixels are the stroke's room. */}
      <Svg width={width} height={104} viewBox={`0 0 ${width} 104`}>
        <SvgText
          x={width / 2}
          y={84}
          textAnchor="middle"
          fontSize={92}
          fontWeight="800"
          fill={Platform.OS === 'android' ? colors.line : 'none'}
          stroke={colors.lineStrong}
          strokeWidth={Platform.OS === 'android' ? 0 : 3}
        >
          {label}
        </SvgText>
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { justifyContent: 'flex-end', marginRight: -10 },
});
