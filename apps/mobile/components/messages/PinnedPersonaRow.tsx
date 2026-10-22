import { View, Text, StyleSheet } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { RoxyO } from '../roxy/RoxyO';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../lib/theme';

export type Persona = 'roxy' | 'sister';

/** Avatar size on a 72 dp row (direction › Spacing: rows 56 / 64 / 72). */
export const PERSONA_AVATAR = 48;
const ROW_MIN = 72;
/** The unread dot (direction › Navigation: unread is an 8 dp `pink` dot). */
const DOT = SPACE[1];

/**
 * The two pinned rows at the top of Messages (v2 board v2-06, normal state).
 *
 * **Roxy AI** is the emotional AI companion; Messages is one of the screens
 * where she is a pinned row instead of the floating button. **Sister** is the
 * quieter companion: a private space for the days that are not going well.
 *
 * They must be tellable apart **without colour**, because colour is the one
 * signal a viewer may not have and because these two do very different jobs:
 *   1. wording — "Roxy AI" + "Only you see this chat." vs "Sister" + "Just for
 *      you. Nothing leaves here.", in the row and in the accessibility label;
 *   2. mark — her circle carries a letter, Sister's disc carries nothing;
 *   3. colour — `pink` vs `sister`.
 *
 * v2 drops v0's caps tags (WINGWOMAN, PRIVATE), the gradient ring, the sparkle
 * and the emoji: rows sit on the ground like every other row in the inbox.
 *
 * Sister carries no gamification: no streak, no points, no badge count, no
 * unread dot. Turning a vent space into something with a score is the fastest
 * way to make it useless, so the component draws nothing countable for her.
 */
interface Props {
  persona: Persona;
  onPress: () => void;
  /** Roxy AI has written since she last looked. Ignored for Sister. */
  unread?: boolean;
}

const COPY: Record<Persona, { name: string; sub: string; a11y: string }> = {
  roxy: {
    name: 'Roxy AI',
    sub: 'Only you see this chat.',
    a11y: 'Roxy AI, your companion. Only you see this chat.',
  },
  sister: {
    name: 'Sister',
    sub: 'Just for you. Nothing leaves here.',
    a11y: 'Sister, a private space to talk. Nothing here is shared, scored or saved to your profile.',
  },
};

export function PinnedPersonaRow({ persona, onPress, unread = false }: Props) {
  const colors = useThemeColors();
  const s = styles(colors);
  const copy = COPY[persona];
  const isRoxy = persona === 'roxy';
  const showDot = isRoxy && unread;

  return (
    <TouchableOpacity
      testID={`persona-row-${persona}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={showDot ? `${copy.a11y} New message.` : copy.a11y}
      style={s.row}
    >
      {isRoxy ? (
        // Her own mark, the Roxy O (lane roxy-ai), at the row's avatar size.
        // Decorative here: the row's label already names her.
        <RoxyO size={PERSONA_AVATAR} testID="persona-roxy-o" />
      ) : (
        <View style={[s.avatar, { backgroundColor: colors.sister }]} testID="persona-sister-plate" />
      )}

      <View style={s.text}>
        <Text testID={`persona-name-${persona}`} style={s.name} numberOfLines={1}>
          {copy.name}
        </Text>
        <Text style={s.sub} numberOfLines={1}>{copy.sub}</Text>
      </View>

      {showDot ? (
        <View style={[s.dot, { backgroundColor: colors.pink }]} testID={`persona-unread-${persona}`} />
      ) : null}
    </TouchableOpacity>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    minHeight: ROW_MIN,
    paddingHorizontal: MARGIN, paddingVertical: SPACE[1],
  },
  avatar: {
    width: PERSONA_AVATAR, height: PERSONA_AVATAR, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  initial: { ...TYPE.title },
  text: { flex: 1, gap: SPACE[0] / 2 },
  name: { ...TYPE.label, color: colors.ink },
  sub: { ...TYPE.body, color: colors.ink2 },
  dot: { width: DOT, height: DOT, borderRadius: RADII.pill },
});
