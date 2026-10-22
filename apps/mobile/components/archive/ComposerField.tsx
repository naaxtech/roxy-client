import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { PrimaryButton } from '../ui/PrimaryButton';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: 'default' | 'number-pad' | 'url';
  /** Focus this field on open ("Add a cover" opens the editor on the cover). */
  autoFocus?: boolean;
  testID?: string;
}

/**
 * A labelled input. The label is a real label, not a placeholder pretending,
 * in sentence case (v2 bans tracked capitals).
 */
export function ComposerField({
  label, value, onChangeText, placeholder, multiline, maxLength, keyboardType, autoFocus, testID,
}: FieldProps) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    wrap: { gap: 6 },
    label: { ...TYPE.label, color: colors.ink2 },
    input: {
      ...TYPE.body,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      // v2: inputs take the small radius (direction › Spacing, radius).
      borderRadius: RADII.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: multiline ? 120 : MIN_TOUCH_TARGET,
      textAlignVertical: multiline ? 'top' : 'center',
    },
    count: { ...TYPE.micro, color: colors.textMuted, alignSelf: 'flex-end' },
  });

  return (
    <View style={s.wrap}>
      {/* A placeholder disappears the moment she types, taking the only
          description of the field with it. The label stays. */}
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={keyboardType === 'url' ? 'none' : undefined}
        autoCorrect={keyboardType === 'url' ? false : undefined}
        autoFocus={autoFocus}
        accessibilityLabel={label}
        testID={testID}
      />
      {maxLength ? (
        <Text style={s.count}>{value.length}/{maxLength}</Text>
      ) : null}
    </View>
  );
}

interface CheckProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
  testID?: string;
}

/**
 * The no-spoilers acknowledgement.
 *
 * `archive_reviews.no_spoilers_ack` carries a CHECK that it is true, so an
 * unchecked submit is refused by Postgres with a 23514 she cannot read. This is
 * blocked client-side instead — and the box says what she is agreeing to rather
 * than "I agree", because the rule only works if she knows what it is.
 */
export function ComposerCheckbox({ label, checked, onToggle, testID }: CheckProps) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: MIN_TOUCH_TARGET,
    },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: checked ? colors.primary : colors.line,
      backgroundColor: checked ? colors.primary : 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    tick: { ...TYPE.micro, color: colors.textPrimary, fontWeight: '800' },
    label: { ...TYPE.caption, color: colors.textSecondary, flex: 1 },
  });

  return (
    <Pressable onPress={onToggle} accessible={false}>
      {/* a11y identity on the View: RN's Pressable drops `aria-*`, and
          accessibilityState alone renders nothing on react-native-web 0.19. */}
      <View
        style={s.row}
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        {...a11yState({ checked })}
      >
        <View style={s.box}>{checked ? <Text style={s.tick}>✓</Text> : null}</View>
        <Text style={s.label}>{label}</Text>
      </View>
    </Pressable>
  );
}

interface ChoiceProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * One option of a single-choice row (media type, 👍/👎).
 *
 * These used to be `ComposerSubmit` buttons with `disabled={!selected}` —
 * and a disabled submit has no onPress, so every option but the default was
 * dead: every suggestion was filed as a film and every review as 👍 (ARC-04).
 * A choice is a radio: always pressable, `checked` says which.
 */
export function ComposerChoice({ label, selected, onPress, testID }: ChoiceProps) {
  const colors = useThemeColors();
  const s = StyleSheet.create({
    btn: {
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADII.pill,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: selected ? colors.primary : colors.line,
      backgroundColor: selected ? colors.primary : colors.surfaceLight,
    },
    text: {
      ...TYPE.body,
      fontWeight: '800',
      color: selected ? inkOn(colors.primary) : colors.textSecondary,
    },
  });
  return (
    <Pressable onPress={onPress} accessible={false}>
      <View
        style={s.btn}
        testID={testID}
        accessibilityRole="radio"
        accessibilityLabel={label}
        {...a11yState({ checked: selected })}
      >
        <Text style={s.text}>{label}</Text>
      </View>
    </Pressable>
  );
}

interface SubmitProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}

/**
 * The composer's one primary action: v2's lipped `PrimaryButton` (pink face
 * on a 3 dp lip, `onPink` label; `raised` + `ink3` while waiting). v0 painted
 * the label in `textPrimary` on the action pink, which fails contrast in the
 * light theme (the dark ink on #C8126A).
 */
export function ComposerSubmit({ label, onPress, disabled, busy, testID }: SubmitProps) {
  return (
    <PrimaryButton
      label={label}
      onPress={onPress}
      disabled={!!disabled}
      busy={!!busy}
      testID={testID}
      accessibilityLabel={label}
    />
  );
}

/**
 * RETIRED (v2, 2026-10-21): v0's flat submit pill, replaced by `PrimaryButton`
 * above. Origin: the Roxy 3.0 Archive composers (`git log -S ComposerSubmit`).
 * Kept for a revert; not rendered anywhere.
 */
export function LegacyComposerSubmit({ label, onPress, disabled, busy, testID }: SubmitProps) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    btn: {
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADII.pill,
      paddingHorizontal: 18,
      backgroundColor: disabled ? colors.surfaceLight : colors.primary,
    },
    text: {
      ...TYPE.body,
      fontWeight: '800',
      color: disabled ? colors.textMuted : colors.textPrimary,
    },
  });

  return (
    <Pressable onPress={disabled || busy ? undefined : onPress} accessible={false}>
      <View
        style={s.btn}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        {...a11yState({ disabled: !!disabled, busy: !!busy })}
      >
        <Text style={s.text}>{busy ? 'Sending…' : label}</Text>
      </View>
    </Pressable>
  );
}
