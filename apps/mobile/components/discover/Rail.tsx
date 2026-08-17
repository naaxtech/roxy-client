import type { ReactNode } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

export type RailStatus = 'loading' | 'ready' | 'error';

interface Props {
  title: string;
  status: RailStatus;
  /** Number of cards the caller is about to render. Drives the empty state. */
  count: number;
  /** Shown when `count` is 0 and status is ready. Never a blank strip. */
  emptyBody: string;
  onRetry: () => void;
  children: ReactNode;
  /** An optional chip row rendered under the title, above the cards. */
  filters?: ReactNode;
  /** Optional "see all" affordance. */
  linkLabel?: string;
  onLinkPress?: () => void;
  testID?: string;
}

/**
 * One horizontal rail: title, optional chips, cards.
 *
 * The rail owns all three states so no caller can forget one. That is the whole
 * reason it exists — seven rails each hand-rolling loading/empty/error is seven
 * chances to ship a silent blank strip, which reads as a broken app rather than
 * an empty one.
 *
 * The cards scroll inside their own `ScrollView`; the page never scrolls
 * sideways. `contentContainerStyle` carries the padding rather than the
 * ScrollView itself, so the first card starts at the gutter and the last one can
 * still reach the edge.
 */
export function Rail({
  title, status, count, emptyBody, onRetry, children, filters,
  linkLabel, onLinkPress, testID,
}: Props) {
  const colors = useThemeColors();
  const s = styles(colors);

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header">{title}</Text>
        {linkLabel && onLinkPress ? (
          <TouchableOpacity
            onPress={onLinkPress}
            accessibilityRole="button"
            accessibilityLabel={`${linkLabel}, ${title}`}
            activeOpacity={0.75}
            style={s.link}
            testID={testID ? `${testID}-link` : undefined}
          >
            <Text style={s.linkText}>{linkLabel}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.roxy} />
          </TouchableOpacity>
        ) : null}
      </View>

      {filters}

      {status === 'loading' && (
        <View style={s.state} testID={testID ? `${testID}-loading` : undefined}>
          <ActivityIndicator color={colors.roxy} />
        </View>
      )}

      {status === 'error' && (
        <View style={s.state} testID={testID ? `${testID}-error` : undefined}>
          <Text style={s.stateText}>That did not load.</Text>
          <TouchableOpacity
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={`Try loading ${title} again`}
            activeOpacity={0.8}
            style={s.retry}
          >
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'ready' && count === 0 && (
        <View style={s.state} testID={testID ? `${testID}-empty` : undefined}>
          <Text style={s.stateText}>{emptyBody}</Text>
        </View>
      )}

      {status === 'ready' && count > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.cards}
        >
          {children}
        </ScrollView>
      )}
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { gap: 8, paddingVertical: 10 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  title: { ...TYPE.title, color: colors.textPrimary },
  link: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingLeft: 10,
  },
  linkText: { ...TYPE.caption, color: colors.roxy, fontWeight: '700' },
  cards: { gap: 10, paddingHorizontal: 16 },
  state: { paddingHorizontal: 16, paddingVertical: 16, gap: 10, alignItems: 'flex-start' },
  stateText: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 18 },
  retry: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
    paddingHorizontal: 18, borderRadius: RADII.pill,
    borderWidth: 1.5, borderColor: colors.roxy,
  },
  retryText: { ...TYPE.caption, color: colors.roxy, fontWeight: '800' },
});
