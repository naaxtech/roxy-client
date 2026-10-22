import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { RADII } from '../../lib/theme';
import { scoreFromEntry, type ArchiveEntry } from '../../lib/archive';
import { archiveTypeLabel } from '../../lib/archiveTypes';
import { PressableScale } from '../ui/PressableScale';
import { ArchiveCover } from './ArchiveCover';
import { COVER_ASPECT, COVER_WIDTH } from './archiveTokens';
import { describeScore } from './scoreWords';

interface Props {
  entries: ArchiveEntry[];
  /** The catalogue size, not `entries.length` — the rail is a sample of it. */
  total: number;
  onPressEntry: (entry: ArchiveEntry) => void;
  onSeeAll: () => void;
  status?: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
  testID?: string;
}

const RAIL_TITLE = 'From the Archive';
/** Skeleton covers while loading: two full and a peek, like the loaded rail. */
const SKELETON_COUNT = 3;

/**
 * The Archive's rail on Discover (design direction v2 › Discover, board v2-05
 * "From the Archive").
 *
 * A section like every other on Discover: a `title` heading and "See all" only
 * when there is more than the rail shows. Each card is a 2:3 cover — the
 * uploaded one, or the designed type cover (`ArchiveCover`) — with the title
 * and "Type · year" under it and the score in words. Nothing is written over a
 * cover, and nothing is a gradient.
 *
 * v0 headed it "The WLW Archive" with a blurb and "Browse all N →", which read
 * "Browse all 0 →" on an empty catalogue; the v2 copy hides the count and the
 * empty state says the next step in words instead.
 *
 * src: polish/design-direction.md · v2 › Screen notes › Discover, Archive · 2026-10-21
 */
export function ArchiveRail({
  entries,
  total,
  onPressEntry,
  onSeeAll,
  status = 'ready',
  onRetry,
  testID = 'archive-rail',
}: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    wrap: { gap: 12, paddingVertical: 12 },
    header: {
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    title: { ...TYPE.title, color: colors.ink, flexShrink: 1 },
    link: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'flex-end' },
    linkText: { ...TYPE.label, color: colors.pinkInk },
    rail: { gap: 12, paddingHorizontal: 16 },
    card: { width: COVER_WIDTH.rail, gap: 8, minHeight: MIN_TOUCH_TARGET },
    cardText: { gap: 2 },
    cardTitle: { ...TYPE.label, color: colors.ink },
    cardMeta: { ...TYPE.meta, color: colors.ink2 },
    twoLines: { minHeight: 2 * TYPE.meta.lineHeight },
    bone: {
      width: COVER_WIDTH.rail,
      height: COVER_WIDTH.rail * COVER_ASPECT,
      borderRadius: RADII.sm,
      backgroundColor: colors.raised,
    },
    state: { paddingHorizontal: 16, gap: 4, alignItems: 'flex-start' },
    stateText: { ...TYPE.body, color: colors.ink2 },
    action: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    actionText: { ...TYPE.label, color: colors.pinkInk },
  });

  const body = () => {
    if (status === 'loading') {
      return (
        <View
          style={[s.rail, { flexDirection: 'row' }]}
          testID={`${testID}-loading`}
          accessibilityLabel="Loading the Archive"
        >
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <View key={i} style={s.bone} testID={`${testID}-skeleton`} />
          ))}
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={s.state} testID={`${testID}-error`}>
          <Text style={s.stateText}>The Archive didn&apos;t load. Check your connection and try again.</Text>
          <PressableScale
            onPress={onRetry}
            style={s.action}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.actionText}>Try again</Text>
          </PressableScale>
        </View>
      );
    }

    if (entries.length === 0) {
      return (
        <View style={s.state} testID={`${testID}-empty`}>
          <Text style={s.stateText}>
            Nothing in the Archive yet. Add the first film, show or book you think belongs here.
          </Text>
          <PressableScale
            onPress={onSeeAll}
            style={s.action}
            testID={`${testID}-link`}
            accessibilityRole="button"
            accessibilityLabel="Open the Archive"
          >
            <Text style={s.actionText}>Open the Archive</Text>
          </PressableScale>
        </View>
      );
    }

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {entries.map((entry) => {
          const score = scoreFromEntry(entry);
          const words = describeScore(score);
          const meta = [archiveTypeLabel(entry.media_type), entry.release_year ?? null]
            .filter((part) => part !== null)
            .join(' · ');

          return (
            <PressableScale
              key={entry.id}
              onPress={() => onPressEntry(entry)}
              accessible={false}
              feedback="layer"
            >
              {/* Keyed and identified by SLUG, not index: the caller gets the
                  entry back, and a rail that reorders between renders must not
                  hand back the wrong one. */}
              <View
                style={s.card}
                testID={`${testID}-card-${entry.slug}`}
                accessibilityRole="button"
                accessibilityLabel={`${entry.title}. ${meta}. ${words}.`}
              >
                <ArchiveCover
                  entryId={entry.id}
                  title={entry.title}
                  coverUrl={entry.cover_url}
                  width={COVER_WIDTH.rail}
                  testID={`${testID}-art-${entry.slug}`}
                />
                <View style={s.cardText}>
                  <Text style={s.cardTitle} numberOfLines={2}>{entry.title}</Text>
                  {/* Two lines, reserved: in a 104 dp card "Comics & Manga · 2006"
                      and "4.4 from 7 members" are wider than one line, and a
                      single line clipped them on live (Wave 2 discover-audit). */}
                  <Text style={[s.cardMeta, s.twoLines]} numberOfLines={2}>{meta}</Text>
                  <Text style={[s.cardMeta, s.twoLines]} numberOfLines={2}>{words}</Text>
                </View>
              </View>
            </PressableScale>
          );
        })}
      </ScrollView>
    );
  };

  // "See all" only when there is more than the rail shows (v2 sections).
  const more = status === 'ready' && entries.length > 0 && total > entries.length;

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.header}>
        <Text style={s.title} accessibilityRole="header">{RAIL_TITLE}</Text>
        {more ? (
          <PressableScale
            onPress={onSeeAll}
            style={s.link}
            testID={`${testID}-link`}
            accessibilityRole="button"
            accessibilityLabel={`See all ${total} Archive entries`}
          >
            <Text style={s.linkText}>See all</Text>
          </PressableScale>
        ) : null}
      </View>
      {body()}
    </View>
  );
}
