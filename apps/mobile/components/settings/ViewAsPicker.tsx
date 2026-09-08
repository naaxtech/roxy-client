import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useViewAsStore } from '../../store/viewAsStore';
import { useAccess } from '../../hooks/useAccess';
import { useThemeColors } from '../../hooks/useThemeColors';
import {
  ACCOUNT_KIND_LABEL,
  type AccountKind,
} from '../../lib/features';
import { TYPE } from '../../lib/typography';
import { RADII, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';

const CHOICES: AccountKind[] = ['core', 'staff', 'member', 'communityOwner', 'pending'];

/**
 * Core-only: preview the app as each live account type.
 *
 * The signed-in HQ row does not change. Pending preview stays in the app
 * (Archive plus the status chip), same as a real applicant.
 */
export function ViewAsPicker() {
  const colors = useThemeColors();
  const router = useRouter();
  const { isCore, kind } = useAccess();
  const setPreview = useViewAsStore((s) => s.setPreview);
  const [open, setOpen] = useState(false);
  const s = styles(colors);

  if (!isCore) return null;

  const select = (next: AccountKind) => {
    const previous = kind;
    setPreview(next === 'core' ? null : next);
    setOpen(false);
    if (previous === 'pending' || next === 'pending') {
      router.replace('/(tabs)/feed' as never);
    }
  };

  return (
    <View style={s.wrap} testID="view-as-picker">
      <Text style={s.hint}>
        You are Roxy core. Preview what each account type sees. Community owner
        is tagged in Studio — never self-serve.
      </Text>
      <TouchableOpacity
        style={s.trigger}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`Preview as ${ACCOUNT_KIND_LABEL[kind]}. ${open ? 'Close' : 'Open'} list`}
        testID="view-as-trigger"
      >
        <Text style={s.triggerLabel}>Preview as</Text>
        <Text style={s.triggerValue}>{ACCOUNT_KIND_LABEL[kind]} {open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={s.menu} accessibilityRole="radiogroup" accessibilityLabel="Account type">
          {CHOICES.map((choice) => {
            const on = kind === choice;
            return (
              <TouchableOpacity
                key={choice}
                testID={`view-as-${choice}`}
                onPress={() => select(choice)}
                accessibilityRole="radio"
                {...a11yState({ selected: on, checked: on })}
                accessibilityLabel={ACCOUNT_KIND_LABEL[choice]}
                style={[s.option, on && s.optionOn]}
              >
                <Text style={[s.optionText, on && s.optionTextOn]}>
                  {ACCOUNT_KIND_LABEL[choice]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { gap: 10 },
  hint: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 18 },
  trigger: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  triggerLabel: { ...TYPE.body, color: colors.textSecondary },
  triggerValue: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  menu: {
    borderRadius: RADII.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  optionOn: { backgroundColor: colors.surfaceLight },
  optionText: { ...TYPE.body, color: colors.textPrimary },
  optionTextOn: { fontWeight: '700', color: colors.primaryInk },
});
