import type { ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { PendingBanner } from './PendingBanner';

interface Props {
  title: string;
  intro: string;
  locked: boolean;
  onClose: () => void;
  /** Shown below the intro only when unlocked — the CTA's supporting line. */
  footNote?: string;
  /** A failed submit's message. Kept alive across retries; never clears her text. */
  error?: string | null;
  /** Form fields — rendered only when unlocked. */
  children?: ReactNode;
  /** Submit button row — rendered only when unlocked. */
  footer?: ReactNode;
  testID?: string;
}

/**
 * The chrome every Archive composer sheet shares: presented as a
 * `presentation: 'modal'` route (see app/archive/_layout.tsx and
 * app/archive/[slug]/_layout.tsx), styled as the bottom-sheet card that
 * presentation implies — RADII.sheet on the top corners only, a grabber for
 * the affordance, a title + close control.
 *
 * The title and intro render UNCONDITIONALLY, locked or not — the prototype's
 * own `editVals` does this too (`edTitle`/`edIntro` sit outside the
 * `edOpen` branch). Only the FORM is behind the gate. That is what makes this
 * an explanation rather than a dead control: a pending member reads exactly
 * what she would be doing here and exactly when it unlocks, never a greyed-out
 * button with no sentence attached to it.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · editVals, lines 2033–2051 · 2026-09-01
 */
export function ComposerShell({
  title, intro, locked, onClose, footNote, error, children, footer, testID,
}: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      borderTopLeftRadius: RADII.sheet,
      borderTopRightRadius: RADII.sheet,
      overflow: 'hidden',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      marginTop: 10,
      backgroundColor: colors.line,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 4,
    },
    title: { ...TYPE.headline, color: colors.textPrimary, flex: 1 },
    closeBtn: {
      minWidth: MIN_TOUCH_TARGET,
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: { padding: 16, paddingTop: 4, gap: 14 },
    intro: { ...TYPE.body, color: colors.textSecondary },
    error: { ...TYPE.caption, color: colors.errorInk, fontWeight: '700' },
    footNote: { ...TYPE.micro, color: colors.textMuted },
  });

  return (
    <SafeAreaView style={s.container} edges={['bottom']} testID={testID}>
      <View style={s.grabber} />
      <View style={s.header}>
        <Text style={s.title}>{title}</Text>
        <Pressable
          onPress={onClose}
          style={s.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID={testID ? `${testID}-close` : undefined}
        >
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.intro}>{intro}</Text>
        {locked ? (
          <PendingBanner
            variant="locked"
            testID={testID ? `${testID}-locked` : undefined}
          />
        ) : (
          <>
            {children}
            {error ? (
              <Text
                style={s.error}
                accessibilityRole="alert"
                testID={testID ? `${testID}-error` : undefined}
              >
                {error}
              </Text>
            ) : null}
            {footer}
            {footNote ? <Text style={s.footNote}>{footNote}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
