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
 *   2. shape — Roxy gets a gradient ring, Sister a quiet rounded plate
 *   3. weight — Roxy's name is bold display, Sister's is regular
 *   4. colour — warm brand ramp vs `colors.sister`
 *
 * Sister carries no gamification: no streak, no points, no badge count, no unread
 * count. Turning a vent space into something with a score is the fastest way to
 * make it useless, so the component has no prop that could put one there.
 *
 * Copy matches the 3.0 prototype inbox (markup 402–418).
 */
interface Props {
  persona: Persona;
  onPress: () => void;
}

const COPY: Record<Persona, {
  name: string;
  sub: string;
  tag: string;
  a11y: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = {
  roxy: {
    name: 'Roxy',
    sub: 'Openers, plans, pep talks — always on 💗',
    tag: 'WINGWOMAN',
    a11y: 'Roxy, your wingwoman. Chat about dating, confidence and her texts.',
    icon: 'sparkles',
  },
  sister: {
    name: 'Sister',
    sub: 'A quiet place to let it out. Never shared.',
    tag: 'PRIVATE',
    a11y: 'Sister, a private space to talk. Nothing here is shared, scored or saved to your profile.',
    icon: 'moon',
  },
};

const SISTER_PLATE = ['#4B54A8', '#8E9BFF'] as const;

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
          <View style={[s.ringInner, { backgroundColor: colors.backgroundAlt }]}>
            <Ionicons name={copy.icon} size={18} color={colors.primaryInk} />
          </View>
        </LinearGradient>
      ) : (
        <LinearGradient
          colors={SISTER_PLATE}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.plate}
          testID="persona-sister-plate"
        >
          <Ionicons name={copy.icon} size={20} color="#F2F4FF" />
        </LinearGradient>
      )}

      <View style={s.text}>
        <View style={s.nameRow}>
          <Text
            testID={`persona-name-${persona}`}
            style={[s.name, isRoxy ? s.nameRoxy : s.nameSister]}
          >
            {copy.name}
          </Text>
          <View style={[s.tag, isRoxy ? s.tagRoxy : s.tagSister]}>
            <Text style={[s.tagText, isRoxy ? s.tagTextRoxy : s.tagTextSister]}>
              {copy.tag}
            </Text>
          </View>
        </View>
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
    paddingHorizontal: 12, paddingVertical: 11,
    borderRadius: RADII.lg, borderWidth: 1,
  },
  rowRoxy: { backgroundColor: colors.surface, borderColor: colors.primary },
  rowSister: { backgroundColor: colors.background, borderColor: colors.sister },
  ring: {
    width: 46, height: 46, borderRadius: RADII.pill,
    padding: 2, alignItems: 'center', justifyContent: 'center',
  },
  ringInner: {
    width: '100%', height: '100%', borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  plate: {
    width: 46, height: 46, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  name: { color: colors.textPrimary },
  nameRoxy: { ...TYPE.title },
  nameSister: { ...TYPE.bodyLg, fontWeight: '600' },
  tag: {
    borderRadius: RADII.pill, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  tagRoxy: { backgroundColor: colors.surfaceLight, borderColor: colors.primary },
  tagSister: { backgroundColor: 'transparent', borderColor: colors.sister },
  tagText: { ...TYPE.micro, fontWeight: '800', letterSpacing: 0.8 },
  tagTextRoxy: { color: colors.primaryInk },
  tagTextSister: { color: colors.sisterInk },
  sub: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 17 },
});
