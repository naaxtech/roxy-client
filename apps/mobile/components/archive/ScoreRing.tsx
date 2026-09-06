import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { scoreTone, type ArchiveScore } from '../../lib/archive';
import { ringDash, scoreRingColor } from './archiveTokens';

interface Props {
  score: ArchiveScore;
  size?: number;
  testID?: string;
}

const DEFAULT_SIZE = 72;
/** Stroke as a share of the diameter, so the ring reads the same at any size. */
const STROKE_RATIO = 0.11;

/**
 * The score ring from the entry header.
 *
 * The prototype draws it with a CSS `conic-gradient` swept to `pct * 3.6deg`.
 * React Native has no conic gradient, so this is an SVG circle whose
 * `strokeDasharray` fills the same proportion — `archiveTokens.ringDash` owns
 * that conversion and is tested against the circumference directly.
 *
 * Below the gate there is NO arc. Not a grey one, not a faint one: a nearly
 * full circle reads as a high score at a glance whatever the label underneath
 * says, and a glance is all a header gets. An unscored entry shows the track,
 * the word NEW, and its vote count.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 1996–1998 · 2026-09-01
 */
export function ScoreRing({ score, size = DEFAULT_SIZE, testID }: Props) {
  const colors = useThemeColors();
  const tone = scoreTone(score);

  const strokeWidth = Math.round(size * STROKE_RATIO);
  const radius = (size - strokeWidth) / 2;
  const centre = size / 2;
  const stroke = scoreRingColor(tone, colors);

  const s = StyleSheet.create({
    wrap: { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
    hole: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    percent: { ...TYPE.title, color: colors.textPrimary, fontWeight: '800' },
    caption: { ...TYPE.micro, color: colors.textMuted, fontWeight: '800' },
    newLabel: { ...TYPE.body, color: colors.textSecondary, fontWeight: '800' },
  });

  // Narrowed inline rather than through a boolean: TypeScript cannot carry a
  // null-check across a separate variable, and `scored` would leave
  // `score.percent` typed as possibly-null at the call below.
  const dash = score.percent !== null ? ringDash(score.percent, radius) : null;
  const scored = dash !== null;

  return (
    <View style={s.wrap}>
      <Svg
        width={size}
        height={size}
        testID={testID}
        // The ring IS the announcement — one phrase, not a percentage read out
        // separately from the word REC underneath it.
        accessibilityLabel={score.label}
      >
        <Circle
          cx={centre}
          cy={centre}
          r={radius}
          stroke={colors.line}
          strokeWidth={strokeWidth}
          fill="none"
          testID={testID ? `${testID}-track` : undefined}
        />
        {dash ? (
          <Circle
            cx={centre}
            cy={centre}
            r={radius}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            strokeLinecap="round"
            fill="none"
            // Start the sweep at twelve o'clock rather than three, which is
            // where SVG puts zero degrees.
            transform={`rotate(-90 ${centre} ${centre})`}
            testID={testID ? `${testID}-progress` : undefined}
          />
        ) : null}
      </Svg>

      <View style={s.hole} pointerEvents="none">
        {scored ? (
          <>
            <Text style={s.percent}>{score.label}</Text>
            <Text style={s.caption}>REC</Text>
          </>
        ) : (
          // Nobody has rated it. "0 votes" reads as a defect; "Unreviewed"
          // reads as an invitation, which is what an empty entry actually is.
          <Text style={s.newLabel}>Unreviewed</Text>
        )}
      </View>
    </View>
  );
}
