import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from '../ui/PressableScale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE, emphasized } from '../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { byTheme } from '../discover/byTheme';

/** Why the last attempt to find her did not work, when it was not a refusal. */
export type LocationProblem = 'unavailable' | 'timeout' | null;

interface Props {
  /** She refused location: offer a city only, and never ask again from here. */
  denied: boolean;
  problem: LocationProblem;
  onUseLocation: () => void;
  onChooseCity: () => void;
}

function bodyFor(denied: boolean, problem: LocationProblem): string {
  if (denied) return 'Location is off for Roxy. Pick a city and you’ll see the communities that meet there.';
  if (problem === 'timeout') return 'Finding your location took too long. Try again, or choose a city.';
  if (problem === 'unavailable') return 'Couldn’t find your location just now. Try again, or choose a city.';
  return 'Roxy rounds your location to about 11 km on your phone and never stores it. Or pick a city.';
}

/**
 * Nearby's way in (spec › Safety 2: permission asked in context, never at
 * launch). "Use my location" is the only thing that asks the phone for her
 * position; "Choose a city" asks nothing. After a refusal only the city stays.
 *
 * A flat `surface` card on the ground (no nested card, no tinted icon tile):
 * the tonal pill is the lead action, the quiet pill the alternative. Neither
 * is the screen's one lipped primary; Discover has none.
 */
export function NearbyPrompt({ denied, problem, onUseLocation, onChooseCity }: Props) {
  const colors = useThemeColors();
  const s = styles(colors);
  return (
    <View style={s.card} testID="nearby-prompt">
      <Ionicons
        name="location-outline"
        size={SPACE[5]}
        color={colors.ink2}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={s.text}>
        <Text style={s.title}>See communities near you</Text>
        <Text style={s.body} accessibilityLiveRegion="polite">{bodyFor(denied, problem)}</Text>
        <View style={s.actions}>
          {denied ? null : (
            <TouchableOpacity
              onPress={onUseLocation}
              accessibilityRole="button"
              accessibilityLabel="Use my location"
              accessibilityHint="Asks your phone for your approximate location"
              style={[s.pill, { backgroundColor: colors.pinkContainer }]}
              testID="nearby-use-location"
            >
              <Text style={[s.pillLabel, { color: colors.onPinkContainer }]} numberOfLines={1}>Use my location</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={onChooseCity}
            accessibilityRole="button"
            accessibilityLabel="Choose a city"
            style={[s.pill, { backgroundColor: colors.raised }]}
            testID="nearby-choose-city"
          >
            <Text style={[s.pillLabel, { color: colors.ink }]} numberOfLines={1}>Choose a city</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// Built once per theme, not on every render (jank audit #8).
const styles = byTheme((colors: ThemeColors) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[2],
    marginHorizontal: MARGIN, padding: SPACE[3],
    borderRadius: RADII.md, backgroundColor: colors.surface,
  },
  text: { flex: 1, gap: SPACE[1] },
  title: { ...emphasized('body'), color: colors.ink },
  body: { ...TYPE.body, color: colors.ink2 },
  // Pills hug their labels and wrap onto a second line in longer languages.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[1], marginTop: SPACE[1] },
  pill: {
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[3],
    borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
  },
  pillLabel: { ...TYPE.label },
}));
