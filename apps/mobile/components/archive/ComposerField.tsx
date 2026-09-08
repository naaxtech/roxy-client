import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: 'default' | 'number-pad';
  testID?: string;
}

/** A labelled input. The label is a real label, not a placeholder pretending. */
export function ComposerField({
  label, value, onChangeText, placeholder, multiline, maxLength, keyboardType, testID,
}: FieldProps) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    wrap: { gap: 6 },
    label: { ...TYPE.micro, color: colors.textMuted, fontWeight: '800', letterSpacing: 0.6 },
    input: {
      ...TYPE.body,
      color: colors.textPrimary,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: RADII.md,
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
      <Text style={s.label}>{label.toUpperCase()}</Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType ?? 'default'}
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

interface SubmitProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}

export function ComposerSubmit({ label, onPress, disabled, busy, testID }: SubmitProps) {
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
