import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { formatScore, type ArchiveEntry } from '../../lib/archive';
import { ScorePill } from './ScorePill';

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

const RAIL_TITLE = 'The WLW Archive';
const RAIL_BLURB =
  'Films, shows, books, comics and music — scored by us, for us. ' +
  'Open to everyone, even while your membership is pending.';

/**
 * The Archive's rail on Discover.
 *
 * The blurb says "open to everyone, even while your membership is pending"
 * because this rail is the one thing on Discover a pending member can actually
 * use, and she has no way to know that from a row of posters. Migration 079 is
 * the postmortem for what happens when nothing tells her.
 *
 * `Browse all N →` shows the CATALOGUE total, not the number of cards on the
 * rail. A rail capped at a handful that advertised its own length would be a
 * link promising less than it delivers — and the same mistake the communities
 * rail made before it got a "See all".
 *
 * The link survives every state, including empty and error. It is the route to
 * the full Archive, and the moment it is most worth offering is when the rail
 * itself has nothing to show.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · behaviour 1994–1996 · 2026-09-01
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
    wrap: { gap: 8, paddingVertical: 12 },
    header: { paddingHorizontal: 16, gap: 4 },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    title: { ...TYPE.title, color: colors.textPrimary },
    link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    linkText: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '700' },
    blurb: { ...TYPE.caption, color: colors.textSecondary },
    rail: { gap: 10, paddingHorizontal: 16, paddingTop: 4 },
    card: {
      width: 148,
      gap: 6,
      padding: 10,
      borderRadius: RADII.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      minHeight: MIN_TOUCH_TARGET,
    },
    cardTitle: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '800' },
    cardMeta: { ...TYPE.micro, color: colors.textMuted },
    state: { paddingHorizontal: 16, paddingVertical: 14, gap: 8, alignItems: 'flex-start' },
    stateText: { ...TYPE.caption, color: colors.textSecondary },
    retry: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '700' },
    retryHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  });

  const body = () => {
    if (status === 'loading') {
      return (
        <View style={s.state} testID={`${testID}-loading`}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={s.state} testID={`${testID}-error`}>
          <Text style={s.stateText}>Could not load the Archive.</Text>
          <Pressable
            onPress={onRetry}
            style={s.retryHit}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={s.retry}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    if (entries.length === 0) {
      return (
        <View style={s.state} testID={`${testID}-empty`}>
          <Text style={s.stateText}>
            Nothing scored yet. Be the first — every score counts from the moment you cast it.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {entries.map((entry) => {
          const score = formatScore(entry.up_count, entry.vote_count);
          // "0 votes" beside a pill already reading "Unreviewed" is the same
          // fact twice, and the second telling reads as a defect. Same rule
          // ArchiveRow follows — it was fixed there and missed here, which is
          // what a shared helper would have prevented.
          const meta = [
            entry.release_year ?? null,
            entry.vote_count > 0
              ? `${entry.vote_count} ${entry.vote_count === 1 ? 'vote' : 'votes'}`
              : null,
          ]
            .filter((part) => part !== null)
            .join(' · ');

          return (
            <Pressable
              key={entry.id}
              onPress={() => onPressEntry(entry)}
              accessible={false}
            >
              {/* Keyed and identified by SLUG, not index: the caller gets the
                  entry back, and a rail that reorders between renders must not
                  hand back the wrong one. */}
              <View
                style={s.card}
                testID={`${testID}-card-${entry.slug}`}
                accessibilityRole="button"
                accessibilityLabel={`${entry.title}. ${score.label}.`}
              >
                <ScorePill score={score} />
                <Text style={s.cardTitle} numberOfLines={2}>{entry.title}</Text>
                <Text style={s.cardMeta} numberOfLines={1}>{meta}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  };

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Text style={s.title}>{RAIL_TITLE}</Text>
          <Pressable
            onPress={onSeeAll}
            style={s.link}
            testID={`${testID}-link`}
            accessibilityRole="button"
            accessibilityLabel={`Browse all ${total} Archive entries`}
          >
            <Text style={s.linkText}>Browse all {total} →</Text>
          </Pressable>
        </View>
        <Text style={s.blurb}>{RAIL_BLURB}</Text>
      </View>
      {body()}
    </View>
  );
}
