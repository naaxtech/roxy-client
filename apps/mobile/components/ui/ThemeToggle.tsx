import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '../../store/themeStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { logError } from '../../lib/errorLogger';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

type Choice = { key: 'dark' | 'light'; label: string; icon: keyof typeof Ionicons.glyphMap };

const CHOICES: Choice[] = [
  { key: 'dark', label: 'Dark', icon: 'moon' },
  { key: 'light', label: 'Light', icon: 'sunny' },
];

/**
 * Appearance: two named buttons, not a sliding switch.
 *
 * The switch this replaces was a 72×36 track with a moon at one end and a sun at
 * the other, and it was genuinely ambiguous — a sun on the right could mean "it
 * is light now" or "tap here for light", and nothing on it said which. Two
 * labelled buttons with a selected state cannot be read two ways, which is why
 * the prototype draws it that way too.
 *
 * It also fixes three smaller things the old control got wrong: it hardcoded
 * `#2d1b4e` and `#C4B5FF` outside the token set, it used `hitSlop={8}` where the
 * rest of the app measures a real 48dp target, and it was the app's only
 * `setTheme` call site while announcing itself as a generic switch.
 *
 * `setTheme` writes AsyncStorage and then best-effort syncs `profiles`, so a
 * failed sync must not look like a failed choice — the local theme has already
 * changed and the UI is already correct. The catch only logs.
 */
export function ThemeToggle() {
  const colors = useThemeColors();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const s = styles(colors);

  return (
    <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel="Appearance" testID="theme-toggle">
      {CHOICES.map((choice) => {
        const on = theme === choice.key;
        return (
          <TouchableOpacity
            key={choice.key}
            testID={`theme-${choice.key}`}
            onPress={() => {
              void setTheme(choice.key).catch((e: unknown) => logError(e, 'ThemeToggle.setTheme'));
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={`${choice.label} mode`}
            activeOpacity={0.85}
            style={[
              s.choice,
              on
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { backgroundColor: 'transparent', borderColor: colors.line },
            ]}
          >
            <Ionicons
              name={choice.icon}
              size={15}
              color={on ? inkOn(colors.primary) : colors.textSecondary}
            />
            <Text style={[s.label, { color: on ? inkOn(colors.primary) : colors.textSecondary }]}>
              {choice.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = (_colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 14,
    borderRadius: RADII.pill, borderWidth: 1,
  },
  label: { ...TYPE.caption, fontWeight: '700' },
});
