import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { scoreTone, type ArchiveScore } from '../../lib/archive';
import { scoreGradient, scoreIcon } from './archiveTokens';

interface Props {
  score: ArchiveScore;
  testID?: string;
}

/**
 * The score badge, and the honest version of "no score yet".
 *
 * Below the gate this is deliberately a different KIND of object: a neutral
 * surface with words on it, not a coloured pill with a smaller number. A grey
 * "100%" would still read as a score at a glance, and glancing is all anyone
 * does to a badge in a list. So under ten votes there is no percentage, no
 * gradient and no flower — an icon here is a verdict the votes do not support.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 1978–1980 · 2026-09-01
 */
export function ScorePill({ score, testID }: Props) {
  const colors = useThemeColors();
  const tone = scoreTone(score);
  const gradient = scoreGradient(tone);
  const icon = scoreIcon(tone);

  const s = StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: RADII.pill,
    },
    unscored: {
      backgroundColor: colors.surfaceLight,
      borderWidth: 1,
      borderColor: colors.line,
    },
    text: { ...TYPE.micro, fontWeight: '800' },
    unscoredText: { ...TYPE.micro, fontWeight: '800', color: colors.textSecondary },
  });

  if (!gradient || score.percent === null) {
    return (
      <View
        style={[s.pill, s.unscored]}
        testID={testID}
        accessibilityLabel={`Not scored yet, ${score.total} ${score.total === 1 ? 'vote' : 'votes'} so far`}
      >
        <Text style={s.unscoredText}>{score.label}</Text>
      </View>
    );
  }

  const ink = inkOn(gradient[1]);

  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.pill}
      testID={testID}
      // A flower is not a sentence. Assistive tech gets the claim the pill is
      // actually making, including the sample size it rests on.
      accessibilityLabel={`${score.percent}% of ${score.total} members recommend it`}
    >
      {icon ? <Text style={[s.text, { color: ink }]}>{icon}</Text> : null}
      <Text style={[s.text, { color: ink }]}>{score.label}</Text>
    </LinearGradient>
  );
}
