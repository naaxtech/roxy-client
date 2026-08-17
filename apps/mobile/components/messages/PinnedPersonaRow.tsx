import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, BRAND_GRADIENT, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

export type Persona = 'roxy' | 'sister';

/**
 * The two pinned AI rows in the inbox.
 *
 * They must be tellable apart **without colour**, because colour is the one
 * signal a viewer may not have and because these two do very different jobs: one
 * is a wingwoman who will hype you up about a date, the other is a private space
 * for the days that are not going well. Confusing them is not a cosmetic bug.
 *
 * So the difference is carried four ways, only one of which is hue:
 *   1. wording — "wingwoman" vs "private space", in the subtitle and the label
 *   2. shape — Roxy gets a gradient ring, Sister a plain quiet plate
 *   3. weight — Roxy's name is bold display, Sister's is regular
 *   4. colour — warm brand ramp vs `colors.sister`
 *
 * Sister carries no gamification: no streak, no points, no badge, no unread
 * count. Turning a vent space into something with a score is the fastest way to
 * make it useless, so the component has no prop that could put one there.
 */
interface Props {
  persona: Persona;
  onPress: () => void;
}

const COPY: Record<Persona, { name: string; sub: string; a11y: string; icon: keyof typeof Ionicons.glyphMap }> = {
  roxy: {
    name: 'Roxy',
    sub: 'Your wingwoman — openers, date spots, decoding her texts',
    a11y: 'Roxy, your wingwoman. Chat about dating, confidence and her texts.',
    icon: 'sparkles',
  },
  sister: {
    name: 'Sister',
    sub: 'A private space. Nothing here is shared, scored or saved.',
    a11y: 'Sister, a private space to talk. Nothing here is shared, scored or saved to your profile.',
    icon: 'moon',
  },
};

export function PinnedPersonaRow({ persona, onPress }: Props) {
  const colors = useThemeColors();
  const s = styles(colors);
  const copy = COPY[persona];
  const isRoxy = persona === 'roxy';

  return (
    <TouchableOpacity
      testID={`persona-row-${persona}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={copy.a11y}
      activeOpacity={0.85}
      style={[s.row, isRoxy ? s.rowRoxy : s.rowSister]}
    >
      {isRoxy ? (
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.ring}
          testID="persona-roxy-ring"
        >
          <Ionicons name={copy.icon} size={20} color={inkOn(BRAND_GRADIENT[1])} />
        </LinearGradient>
      ) : (
        <View style={s.plate} testID="persona-sister-plate">
          <Ionicons name={copy.icon} size={20} color={colors.sisterInk} />
        </View>
      )}

      <View style={s.text}>
        <Text
          testID={`persona-name-${persona}`}
          style={[s.name, isRoxy ? s.nameRoxy : s.nameSister]}
        >
          {copy.name}
        </Text>
        <Text style={s.sub} numberOfLines={2}>{copy.sub}</Text>
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: MIN_TOUCH_TARGET + 16,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: RADII.lg, borderWidth: 1,
  },
  rowRoxy: { backgroundColor: colors.surface, borderColor: colors.line },
  // Quieter on purpose: less fill, more air. The vent space should not shout
  // from the inbox the way the wingwoman is allowed to.
  rowSister: { backgroundColor: colors.background, borderColor: colors.line },
  ring: { width: 44, height: 44, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
  plate: {
    width: 44, height: 44, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceLight,
    borderWidth: 1, borderColor: colors.line,
  },
  text: { flex: 1, gap: 2 },
  name: { color: colors.textPrimary },
  nameRoxy: { ...TYPE.title },
  nameSister: { ...TYPE.bodyLg, fontWeight: '600' },
  sub: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 17 },
});
