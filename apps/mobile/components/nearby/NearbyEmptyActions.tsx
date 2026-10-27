import { View, Text, StyleSheet } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, SPACE, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { widenLabel, type NearbyEmptyAdvice } from '../../lib/nearbyFilters';
import { byTheme } from '../discover/byTheme';

interface Props {
  advice: NearbyEmptyAdvice;
  onClearFilters: () => void;
  onWiden: () => void;
  onChooseCity: () => void;
}

/**
 * The moves an empty Nearby answer offers (`nearbyEmptyAdvice`), shared by
 * Discover's rail and the nearby browser: Clear filters or Widen to the next
 * distance, then Choose a city, always. Members cannot start a community in
 * the app, so there is no "start one" here. Quiet pills that hug their labels
 * and wrap in longer languages; none is the screen's primary action.
 */
export function NearbyEmptyActions({ advice, onClearFilters, onWiden, onChooseCity }: Props) {
  const colors = useThemeColors();
  const s = styles(colors);
  return (
    <View style={s.row}>
      {advice.clearFilters ? (
        <Pill label="Clear filters" onPress={onClearFilters} testID="nearby-empty-clear" styles={s} />
      ) : null}
      {advice.widenTo ? (
        <Pill label={widenLabel(advice.widenTo)} onPress={onWiden} testID="nearby-empty-widen" styles={s} />
      ) : null}
      <Pill label="Choose a city" onPress={onChooseCity} testID="nearby-empty-city" styles={s} />
    </View>
  );
}

function Pill({ label, onPress, testID, styles: s }: {
  label: string;
  onPress: () => void;
  testID: string;
  styles: ReturnType<typeof styles>;
}) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={s.pill} testID={testID}>
      <Text style={s.label} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

// Built once per theme, not on every render (jank audit #8).
const styles = byTheme((colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[1] },
  pill: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
    paddingHorizontal: SPACE[4], borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  label: { ...TYPE.label, color: colors.ink },
}));
