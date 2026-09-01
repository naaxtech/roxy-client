import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { formatScore, type ArchiveEntry } from '../../lib/archive';
import { ScorePill } from './ScorePill';
import { ContentNoteChip, visibleNotes, type ArchiveNote } from './ContentNoteChip';

interface Props {
  entry: ArchiveEntry;
  notes?: ArchiveNote[];
  onPress: () => void;
  testID?: string;
}

/** The two that fit on a row before it stops being a row. */
const NOTES_ON_A_ROW = 2;

/**
 * One result in the Archive browse list.
 *
 * The score comes from `formatScore` like every other surface, which is what
 * stops a one-vote entry rendering 100% in a list where nobody reads the vote
 * count. The meta line is assembled from the parts that exist rather than a
 * template with holes — an entry with no year and no creator gets "100 votes",
 * not " ·  · 100 votes".
 *
 * The whole row is ONE button. Splitting the cover, the title and the notes
 * into separate targets would make a screen reader walk four stops to learn one
 * thing; the notes become tappable on the entry screen, where agreeing with one
 * is a real action rather than a way to open the row.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 968–1006 · 2026-09-01
 */
export function ArchiveRow({ entry, notes = [], onPress, testID }: Props) {
  const colors = useThemeColors();
  const [coverFailed, setCoverFailed] = useState(false);

  const score = formatScore(entry.up_count, entry.vote_count);
  const shown = visibleNotes(notes, NOTES_ON_A_ROW);

  const meta = [
    entry.release_year ?? null,
    entry.creator ?? null,
    `${entry.vote_count} ${entry.vote_count === 1 ? 'vote' : 'votes'}`,
  ]
    .filter((part) => part !== null && String(part).length > 0)
    .join(' · ');

  const s = StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: 12,
      padding: 12,
      minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
    },
    coverWrap: {
      width: 56,
      height: 78,
      borderRadius: RADII.sm,
      overflow: 'hidden',
      backgroundColor: colors.surfaceLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cover: { width: '100%', height: '100%' },
    coverPlate: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    coverType: { ...TYPE.micro, color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.6 },
    body: { flex: 1, gap: 4 },
    title: { ...TYPE.body, color: colors.textPrimary, fontWeight: '800' },
    meta: { ...TYPE.micro, color: colors.textMuted },
    blurb: { ...TYPE.caption, color: colors.textSecondary },
    notes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    reviews: { ...TYPE.micro, color: colors.textMuted },
  });

  const showImage = !!entry.cover_url && !coverFailed;
  const gradient = entry.cover_gradient
    ? ([colors.surfaceLight, colors.surface] as const)
    : ([colors.surfaceLight, colors.surface] as const);

  return (
    <Pressable onPress={onPress} accessible={false}>
      {/* The a11y identity lives on this View rather than the Pressable: RN's
          Pressable drops unknown props, so `aria-*` never reaches the node, and
          accessibilityState alone is inert on react-native-web 0.19. */}
      <View
        style={s.row}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}. ${score.label}. ${meta}`}
      >
        <View style={s.coverWrap}>
          <LinearGradient colors={gradient} style={s.coverPlate} />
          {showImage ? (
            <ExpoImage
              source={{ uri: entry.cover_url as string }}
              style={s.cover}
              contentFit="cover"
              testID={testID ? `${testID}-cover-image` : undefined}
              // A broken cover must fall back to the plate, not leave a hole
              // where the poster was.
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <Text style={s.coverType}>{entry.media_type.toUpperCase()}</Text>
          )}
        </View>

        <View style={s.body}>
          <Text style={s.title} numberOfLines={2}>{entry.title}</Text>
          <ScorePill score={score} />
          <Text style={s.meta} numberOfLines={1}>{meta}</Text>
          {entry.summary ? (
            <Text style={s.blurb} numberOfLines={2}>{entry.summary}</Text>
          ) : null}

          {shown.length > 0 ? (
            <View style={s.notes}>
              {shown.map((note, i) => (
                <ContentNoteChip
                  key={note.id}
                  label={note.label}
                  agreeCount={note.agreeCount}
                  agreed={note.agreed}
                  index={i}
                  // Agreeing belongs on the entry screen. Here it would mean a
                  // tap inside a row does something other than open the row.
                  onPress={onPress}
                />
              ))}
            </View>
          ) : null}

          {entry.review_count > 0 ? (
            <Text style={s.reviews}>
              {entry.review_count} {entry.review_count === 1 ? 'review' : 'reviews'}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
