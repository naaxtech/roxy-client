import type { ReactNode } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { DiscoverLayout } from './discoverFilters';

export type RailStatus = 'loading' | 'ready' | 'error';

/**
 * How a section lays out its children:
 * `rail` scrolls sideways (the mixed For you view), `grid` wraps and fills the
 * screen (one category chosen), `list` stacks full-width rows (communities,
 * live rooms, games — rows read better than cards whatever the chip).
 */
export type SectionLayout = DiscoverLayout | 'list';

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
  /** Defaults to `rail` so no caller changes behaviour by omission. */
  layout?: SectionLayout;
  /** "See all" — pass it only when there is more than the section shows. */
  linkLabel?: string;
  onLinkPress?: () => void;
  testID?: string;
}

/** Skeleton geometry: cards at the poster's size, rows at the row's. */
const SKELETON_CARD_W = 140;
const SKELETON_CARD_H = 180;
const SKELETON_ROW_H = 48;
const SKELETON_COUNT = 3;

/**
 * One Discover section: a `title` heading, optional chips, its content.
 *
 * The section owns all three states so no caller can forget one (direction ›
 * Bans: spinners as a loading state). Loading is skeletons at the final
 * layout; error says what happened and offers Try again; empty says what will
 * appear and when. "See all" appears only when the caller has more to show.
 */
export function Rail({
  title, status, count, emptyBody, onRetry, children, filters,
  layout = 'rail', linkLabel, onLinkPress, testID,
}: Props) {
  const colors = useThemeColors();
  const s = styles(colors);
  const rows = layout === 'list';

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.head}>
        <Text style={s.title} accessibilityRole="header">{title}</Text>
        {linkLabel && onLinkPress ? (
          <TouchableOpacity
            onPress={onLinkPress}
            accessibilityRole="button"
            accessibilityLabel={`${linkLabel}, ${title}`}
            style={s.link}
            testID={testID ? `${testID}-link` : undefined}
          >
            <Text style={s.linkText}>{linkLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {filters}

      {status === 'loading' && (
        <View
          style={rows ? s.skeletonRows : s.skeletonCards}
          testID={testID ? `${testID}-loading` : undefined}
          accessibilityLabel={`Loading ${title}`}
        >
          {Array.from({ length: SKELETON_COUNT }, (_, i) =>
            rows ? (
              <View key={i} style={s.skeletonRow}>
                <View style={[s.skeletonCrest, { backgroundColor: colors.raised }]} />
                <View style={[s.skeletonLine, { backgroundColor: colors.raised }]} />
              </View>
            ) : (
              <View key={i} style={[s.skeletonCard, { backgroundColor: colors.raised }]} />
            ),
          )}
        </View>
      )}

      {status === 'error' && (
        <View style={s.state} testID={testID ? `${testID}-error` : undefined}>
          <Text style={s.stateText}>{`${title} didn’t load. Check your connection and try again.`}</Text>
          <TouchableOpacity
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={`Try loading ${title} again`}
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

      {/* The content state needs its own testID like the other three: the
          wrapper's testID is mounted in EVERY status, so an e2e assertion on it
          passed for a section that was still loading or erroring. */}
      {status === 'ready' && count > 0 && (
        layout === 'rail' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.cards}
            testID={testID ? `${testID}-cards` : undefined}
          >
            {children}
          </ScrollView>
        ) : (
          // No ScrollView: the page already scrolls, and nesting a vertical
          // scroller inside it would trap the gesture.
          <View style={rows ? s.list : s.grid} testID={testID ? `${testID}-cards` : undefined}>
            {children}
          </View>
        )
      )}
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { gap: SPACE[1], paddingTop: SPACE[5] },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingLeft: MARGIN, paddingRight: SPACE[1], minHeight: MIN_TOUCH_TARGET,
  },
  title: { ...TYPE.title, color: colors.ink, flexShrink: 1 },
  link: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
    paddingHorizontal: SPACE[1], borderRadius: RADII.pill,
  },
  linkText: { ...TYPE.label, color: colors.pinkInk },
  cards: { gap: SPACE[2], paddingHorizontal: MARGIN },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[2], paddingHorizontal: MARGIN },
  list: {},
  state: { paddingHorizontal: MARGIN, paddingVertical: SPACE[2], gap: SPACE[2], alignItems: 'flex-start' },
  stateText: { ...TYPE.body, color: colors.ink2 },
  retry: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
    paddingHorizontal: SPACE[4], borderRadius: RADII.pill,
    backgroundColor: colors.raised,
  },
  retryText: { ...TYPE.label, color: colors.ink },
  skeletonCards: { flexDirection: 'row', gap: SPACE[2], paddingHorizontal: MARGIN },
  skeletonCard: { width: SKELETON_CARD_W, height: SKELETON_CARD_H, borderRadius: RADII.md },
  skeletonRows: { paddingHorizontal: MARGIN, gap: SPACE[3], paddingVertical: SPACE[2] },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  skeletonCrest: { width: SKELETON_ROW_H, height: SKELETON_ROW_H, borderRadius: RADII.press },
  skeletonLine: { flex: 1, height: SPACE[2], borderRadius: RADII.pill, marginRight: SPACE[7] },
});
