import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE, emphasized } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { scoreFromEntry, type ArchiveEntry } from '../../lib/archive';
import { archiveTypeLabel } from '../../lib/archiveTypes';
import { PressableScale } from '../ui/PressableScale';
import { ContentNoteChip, visibleNotes, type ArchiveNote } from './ContentNoteChip';
import { ArchiveCover } from './ArchiveCover';
import { COVER_WIDTH } from './archiveTokens';
import { describeScore } from './scoreWords';

interface Props {
  entry: ArchiveEntry;
  notes?: ArchiveNote[];
  onPress: () => void;
  testID?: string;
}

/** The two that fit on a row before it stops being a row. */
const NOTES_ON_A_ROW = 2;

/**
 * Type, year and creator, from the parts that exist. An entry with no year and
 * no creator gets "Movies", not "Movies ·  · ".
 */
export function archiveRowMeta(entry: Pick<ArchiveEntry, 'media_type' | 'release_year' | 'creator'>): string {
  return [archiveTypeLabel(entry.media_type), entry.release_year ?? null, entry.creator ?? null]
    .filter((part) => part !== null && String(part).length > 0)
    .join(' · ');
}

/**
 * One result in the Archive browse list (design direction v2 › Archive).
 *
 * A 2:3 cover and words: the uploaded cover, or the designed type cover when
 * there is none (`ArchiveCover`); the title; type · year · creator; the score
 * said in words with its sample size ("4.4 from 7 members"), never a coloured
 * pill or a flower. Rows are separated by space, not bordered cards.
 *
 * The whole row is ONE button. Splitting the cover, the title and the notes
 * into separate targets would make a screen reader walk four stops to learn one
 * thing; the notes become tappable on the entry screen, where agreeing with one
 * is a real action rather than a way to open the row.
 *
 * src: polish/design-direction.md · v2 › Screen notes › Archive · 2026-10-21
 */
export function ArchiveRow({ entry, notes = [], onPress, testID }: Props) {
  const colors = useThemeColors();

  const score = scoreFromEntry(entry);
  const scoreWords = describeScore(score);
  const shown = visibleNotes(notes, NOTES_ON_A_ROW);
  const meta = archiveRowMeta(entry);

  const s = StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: 16,
      minHeight: MIN_TOUCH_TARGET,
    },
    body: { flex: 1, gap: 4 },
    title: { ...TYPE.title, color: colors.ink },
    meta: { ...TYPE.meta, color: colors.ink3 },
    score: { ...TYPE.label, color: colors.ink, marginTop: 4 },
    invite: { ...emphasized('meta'), color: colors.pinkInk },
    blurb: { ...TYPE.body, color: colors.ink2 },
    notes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    reviews: { ...TYPE.meta, color: colors.ink3 },
  });

  const reviewsLine = score.total === 0
    ? null
    : entry.review_count > 0
      ? `${entry.review_count} ${entry.review_count === 1 ? 'review' : 'reviews'}`
      : 'No reviews yet';

  return (
    <PressableScale onPress={onPress} accessible={false} feedback="layer">
      {/* The a11y identity lives on this View rather than the Pressable: RN's
          Pressable drops unknown props, so `aria-*` never reaches the node, and
          accessibilityState alone is inert on react-native-web 0.19. */}
      <View
        style={s.row}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={[entry.title, scoreWords, meta].join('. ')}
      >
        <ArchiveCover
          entryId={entry.id}
          title={entry.title}
          coverUrl={entry.cover_url}
          width={COVER_WIDTH.row}
          testID={testID ? `${testID}-cover` : undefined}
        />

        <View style={s.body}>
          <Text style={s.title} numberOfLines={2}>{entry.title}</Text>
          <Text style={s.meta} numberOfLines={1}>{meta}</Text>
          <Text style={s.score}>{scoreWords}</Text>
          {/* An unrated entry is an invitation, not a gap: at this stage of
              the Archive that is the whole product loop. */}
          {score.total === 0 ? <Text style={s.invite}>Be the first to rate it</Text> : null}
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

          {reviewsLine ? <Text style={s.reviews}>{reviewsLine}</Text> : null}
        </View>
      </View>
    </PressableScale>
  );
}
