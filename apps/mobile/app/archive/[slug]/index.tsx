import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useArchiveStore } from '../../../store/archiveStore';
import { useMembership } from '../../../hooks/useMembership';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { RADII } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { Analytics } from '../../../lib/analytics';
import { logError } from '../../../lib/errorLogger';
import {
  fetchArchiveEntry, fetchArchiveEntryDetail, formatScore,
  type ArchiveEntry, type ArchiveEntryDetail,
} from '../../../lib/archive';
import { ScoreRing } from '../../../components/archive/ScoreRing';
import { VerdictLine } from '../../../components/archive/VerdictLine';
import { VoteCard } from '../../../components/archive/VoteCard';
import { ContentNoteChip, visibleNotes } from '../../../components/archive/ContentNoteChip';
import { PendingBanner } from '../../../components/archive/PendingBanner';

type Status = 'loading' | 'ready' | 'missing' | 'error';

/**
 * One Archive entry.
 *
 * The division that matters here is what a PENDING member may do. She may vote
 * and she may keep a watchlist — those write straight through RLS and the
 * product rule is that a score she casts while waiting counts and stays. She
 * may not write a review, add a note or suggest an edit, and each of those
 * controls opens an explanation rather than sitting greyed out. A dead control
 * tells her she is not allowed and nothing else, which is how she concludes the
 * app is broken rather than that she is early.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 1008–1090, behaviour 2003–2032 · 2026-09-01
 */
export default function ArchiveEntryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const membership = useMembership();

  const myVotes = useArchiveStore((s) => s.myVotes);
  const watchlist = useArchiveStore((s) => s.watchlist);
  const noteAgreements = useArchiveStore((s) => s.noteAgreements);
  const vote = useArchiveStore((s) => s.vote);
  const toggleWatch = useArchiveStore((s) => s.toggleWatch);
  const agreeNote = useArchiveStore((s) => s.agreeNote);

  const [entry, setEntry] = useState<ArchiveEntry | null>(null);
  const [detail, setDetail] = useState<ArchiveEntryDetail>({ notes: [], reviews: [] });
  const [status, setStatus] = useState<Status>('loading');
  const [lockedOpen, setLockedOpen] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setStatus('loading');
    try {
      const found = await fetchArchiveEntry(slug);
      if (!found) { setStatus('missing'); return; }
      setEntry(found);
      Analytics.archiveEntryViewed(found.slug);
      setDetail(await fetchArchiveEntryDetail(found.id));
      setStatus('ready');
    } catch (e) {
      logError(e, 'archiveEntry.load');
      setStatus('error');
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    backBtn: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    content: { padding: 16, gap: 16, paddingBottom: 48 },
    hero: { flexDirection: 'row', gap: 16, alignItems: 'center' },
    heroText: { flex: 1, gap: 4 },
    title: { ...TYPE.headline, color: colors.textPrimary },
    meta: { ...TYPE.caption, color: colors.textMuted },
    summary: { ...TYPE.body, color: colors.textSecondary },
    section: { gap: 8 },
    sectionTitle: { ...TYPE.title, color: colors.textPrimary },
    notes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    hint: { ...TYPE.micro, color: colors.textMuted },
    review: {
      gap: 4, padding: 12, borderRadius: RADII.md,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    },
    reviewAuthor: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '800' },
    reviewBody: { ...TYPE.body, color: colors.textSecondary },
    reviewMeta: { ...TYPE.micro, color: colors.textMuted },
    actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    action: {
      minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 14,
      borderRadius: RADII.pill, borderWidth: 1, borderColor: colors.line,
      backgroundColor: colors.surfaceLight,
    },
    actionText: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700' },
    state: { padding: 24, gap: 10, alignItems: 'flex-start' },
    stateText: { ...TYPE.body, color: colors.textSecondary },
    link: { ...TYPE.body, color: colors.primaryInk, fontWeight: '700' },
    sheet: {
      margin: 16, padding: 14, gap: 10, borderRadius: RADII.md,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    },
    edit: {
      gap: 4, padding: 12, borderRadius: RADII.md,
      borderWidth: 1, borderColor: colors.line,
    },
  });

  const back = (
    <View style={s.header}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/archive' as never))}
        style={s.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
      </Pressable>
    </View>
  );

  if (status === 'loading') {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        {back}
        <View style={s.state} testID="archive-entry-loading">
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'missing') {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        {back}
        <View style={s.state} testID="archive-entry-missing">
          <Text style={s.stateText}>
            That entry is not in the Archive. It may have been merged into another one.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'error' || !entry) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        {back}
        <View style={s.state} testID="archive-entry-error">
          <Text style={s.stateText}>Could not load this entry.</Text>
          <Pressable
            onPress={() => void load()}
            testID="archive-entry-retry"
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
          >
            <Text style={s.link}>Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const score = formatScore(entry.up_count, entry.vote_count);
  const myVote = entry.id in myVotes ? (myVotes[entry.id] ? 'up' : 'down') : null;
  const watched = watchlist.includes(entry.id);
  const notes = visibleNotes(
    detail.notes.map((n) => ({ ...n, agreed: noteAgreements.includes(n.id) }))
  );
  const meta = [entry.release_year, entry.creator, entry.length_label]
    .filter((p) => p !== null && p !== undefined && String(p).length > 0)
    .join(' · ');

  const castVote = async (value: boolean) => {
    Analytics.archiveVoteCast(entry.slug, value, membership.status);
    await vote(entry.id, value);
  };

  const requireApproved = (then: () => void) => {
    if (!membership.canReview) { setLockedOpen(true); return; }
    then();
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {back}
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <ScoreRing score={score} size={84} testID="archive-entry-ring" />
          <View style={s.heroText}>
            <Text style={s.title}>{entry.title}</Text>
            <Text style={s.meta}>{meta}</Text>
          </View>
        </View>

        <VerdictLine score={score} reviewCount={entry.review_count} />

        {entry.summary ? <Text style={s.summary}>{entry.summary}</Text> : null}

        <VoteCard
          myVote={myVote}
          onUp={() => void castVote(true)}
          onDown={() => void castVote(false)}
          note={
            membership.canReview
              ? 'Your score is public as a number only — your review carries your name.'
              : 'Scoring works while pending. Written reviews unlock on approval.'
          }
          testID="archive-vote"
          footer={
            <View style={s.actionRow}>
              <Pressable
                onPress={() => {
                  if (!watched) Analytics.archiveWatchlistAdded(entry.slug);
                  void toggleWatch(entry.id);
                }}
                style={s.action}
                testID="archive-watch"
                accessibilityRole="button"
                accessibilityLabel={watched ? 'Remove from your watchlist' : 'Add to your watchlist'}
              >
                <Text style={s.actionText}>{watched ? '✓ On your list' : '+ Watchlist'}</Text>
              </Pressable>

              <Pressable
                onPress={() => requireApproved(() => router.push(`/archive/${entry.slug}/review` as never))}
                style={s.action}
                testID="archive-write-review"
                accessibilityRole="button"
                accessibilityLabel={membership.canReview ? 'Write a review' : 'Writing a review is locked while your membership is pending'}
              >
                <Text style={s.actionText}>
                  {membership.canReview ? '✎ Write a review' : '🔒 Write a review'}
                </Text>
              </Pressable>
            </View>
          }
        />

        <View style={s.section}>
          <Text style={s.sectionTitle}>Content notes</Text>
          {notes.length > 0 ? (
            <View style={s.notes}>
              {notes.map((note, i) => (
                <ContentNoteChip
                  key={note.id}
                  label={note.label}
                  agreeCount={note.agreeCount}
                  agreed={note.agreed}
                  index={i}
                  onPress={() => {
                    Analytics.archiveNoteAgreed(entry.slug);
                    void agreeNote(note.id);
                  }}
                  testID={`archive-note-${note.id}`}
                />
              ))}
            </View>
          ) : (
            <Text style={s.hint}>
              No content notes yet. They appear once three members agree, so nobody is
              labelling this on their own.
            </Text>
          )}
          {/* Endings are never tagged. That is the one Archive rule and it is
              stated where a member is about to add a note, not buried in help. */}
          <Text style={s.hint}>Notes describe what is in it. Never how it ends.</Text>
          <Pressable
            onPress={() => requireApproved(() => router.push(`/archive/${entry.slug}/note` as never))}
            style={s.action}
            testID="archive-add-note"
            accessibilityRole="button"
            accessibilityLabel={membership.canEdit ? 'Add a content note' : 'Adding a content note is locked while your membership is pending'}
          >
            <Text style={s.actionText}>{membership.canEdit ? '+ Add a note' : '🔒 Add a note'}</Text>
          </Pressable>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Member reviews</Text>
          {detail.reviews.length > 0 ? (
            detail.reviews.map((review) => (
              <View key={review.id} style={s.review}>
                <Text style={s.reviewAuthor}>
                  {review.author?.display_name ?? review.author?.username ?? 'A member'}
                </Text>
                <Text style={s.reviewBody}>{review.body}</Text>
                <Text style={s.reviewMeta}>
                  {review.is_recommend ? '👍 recommends' : '👎 does not'} · {review.helpful_count} found this helpful
                </Text>
              </View>
            ))
          ) : (
            <Text style={s.hint}>No reviews yet — spoiler-free ones welcome.</Text>
          )}
        </View>

        <Pressable
          style={s.edit}
          onPress={() => requireApproved(() => router.push(`/archive/${entry.slug}/edit` as never))}
          accessibilityRole="button"
          accessibilityLabel={membership.canEdit ? 'Suggest an edit' : 'Suggesting an edit is locked while your membership is pending'}
          testID="archive-suggest-edit"
        >
          <Text style={s.actionText}>
            {membership.canEdit ? 'Something wrong? Suggest an edit' : '🔒 Suggest an edit'}
          </Text>
          <Text style={s.hint}>
            The Archive is member-maintained. Edits are published by a mod, credited to you.
          </Text>
        </Pressable>
      </ScrollView>

      {lockedOpen ? (
        <View style={s.sheet} testID="archive-locked-sheet">
          <PendingBanner variant="locked" />
          <Pressable
            onPress={() => setLockedOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
          >
            <Text style={s.link}>Got it</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
