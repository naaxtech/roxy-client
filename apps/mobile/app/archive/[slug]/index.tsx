import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useArchiveStore } from '../../../store/archiveStore';
import { useAuthStore } from '../../../store/authStore';
import { useMembership } from '../../../hooks/useMembership';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { RADII } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { Analytics } from '../../../lib/analytics';
import { logError } from '../../../lib/errorLogger';
import {
  applyLocalStarVote,
  applyLocalStarWithdraw, fetchArchiveEntry, fetchArchiveEntryDetail,
  firstVoteLanded, scoreFromEntry, starsToRecommend,
  type ArchiveEntry, type ArchiveEntryDetail,
} from '../../../lib/archive';
import { submitReview } from '../../../components/archive/composerActions';
import { ScoreRing } from '../../../components/archive/ScoreRing';
import { VerdictLine } from '../../../components/archive/VerdictLine';
import { VoteCard } from '../../../components/archive/VoteCard';
import { ContentNoteChip, NOTE_AGREEMENT_GATE } from '../../../components/archive/ContentNoteChip';
import { ArchiveActionsSheet, type ArchiveActionTarget } from '../../../components/archive/ArchiveActionsSheet';
import { fetchMyHelpful, setReviewHelpful } from '../../../lib/archiveSafety';
import { useSafetyStore } from '../../../store/safetyStore';
import { tapLight } from '../../../lib/haptics';
import { PendingBanner } from '../../../components/archive/PendingBanner';
import { EntryHero } from '../../../components/archive/EntryHero';

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

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const myVotes = useArchiveStore((s) => s.myVotes);
  const watchlist = useArchiveStore((s) => s.watchlist);
  const noteAgreements = useArchiveStore((s) => s.noteAgreements);
  const vote = useArchiveStore((s) => s.vote);
  const withdrawVote = useArchiveStore((s) => s.withdrawVote);
  const toggleWatch = useArchiveStore((s) => s.toggleWatch);
  const agreeNote = useArchiveStore((s) => s.agreeNote);
  const unagreeNote = useArchiveStore((s) => s.unagreeNote);
  const hydrateMine = useArchiveStore((s) => s.hydrateMine);
  const blockedIds = useSafetyStore((s) => s.blockedUserIds);
  const mutedIds = useSafetyStore((s) => s.mutedUserIds);

  const [entry, setEntry] = useState<ArchiveEntry | null>(null);
  const [detail, setDetail] = useState<ArchiveEntryDetail>({ notes: [], reviews: [], lastEdit: null });
  const [status, setStatus] = useState<Status>('loading');
  const [lockedOpen, setLockedOpen] = useState(false);
  // Above every early return — this screen returns early for loading, missing
  // and error, and a hook declared after those runs in a different order on
  // each of them.
  const [actionError, setActionError] = useState<string | null>(null);
  const [firstVoteOpen, setFirstVoteOpen] = useState(false);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewAck, setReviewAck] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionTarget, setActionTarget] = useState<ArchiveActionTarget | null>(null);
  const [myHelpful, setMyHelpful] = useState<Set<string>>(() => new Set());
  const [helpfulDelta, setHelpfulDelta] = useState<Record<string, number>>({});
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [flaggedNotes, setFlaggedNotes] = useState<Set<string>>(() => new Set());

  // Blocked authors' reviews are withheld by RLS too (133 §4); this makes a
  // block from this screen take effect at once, and applies her mutes.
  const reviews = useMemo(() => {
    const hidden = new Set([...(blockedIds ?? []), ...(mutedIds ?? [])]);
    return detail.reviews.filter((r) => !r.author?.id || !hidden.has(r.author.id));
  }, [detail.reviews, blockedIds, mutedIds]);

  useEffect(() => {
    let cancelled = false;
    void fetchMyHelpful(detail.reviews.map((r) => r.id)).then((ids) => {
      if (!cancelled) { setMyHelpful(ids); setHelpfulDelta({}); }
    });
    return () => { cancelled = true; };
  }, [detail.reviews]);

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

  // Pull-to-refresh re-reads the entry and its lists without the full-screen
  // spinner (ARC-12).
  const onRefresh = useCallback(async () => {
    if (!entry) return;
    setRefreshing(true);
    try {
      const [fresh, nextDetail] = await Promise.all([
        fetchArchiveEntry(entry.slug),
        fetchArchiveEntryDetail(entry.id),
      ]);
      if (fresh) setEntry(fresh);
      setDetail(nextDetail);
    } catch (e) {
      logError(e, 'archiveEntry.refresh');
    } finally {
      setRefreshing(false);
    }
  }, [entry]);

  useEffect(() => {
    if (userId) void hydrateMine(userId);
  }, [userId, hydrateMine]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    backBtn: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    content: { gap: 16, paddingBottom: 48 },
    section: { paddingHorizontal: 16, gap: 8 },
    scoreRow: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingHorizontal: 16 },
    unrated: { paddingHorizontal: 16, gap: 3 },
    unratedTitle: { ...TYPE.title, color: colors.textPrimary },
    unratedBody: { ...TYPE.caption, color: colors.textSecondary },
    scoreText: { flex: 1 },
    title: { ...TYPE.headline, color: colors.textPrimary },
    meta: { ...TYPE.caption, color: colors.textMuted },
    summary: { ...TYPE.body, color: colors.textSecondary, paddingHorizontal: 16 },

    sectionTitle: { ...TYPE.title, color: colors.textPrimary },
    notes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    hint: { ...TYPE.micro, color: colors.textMuted },
    actionError: { ...TYPE.caption, color: colors.error, fontWeight: '700' },
    review: {
      gap: 4, padding: 12, borderRadius: RADII.md,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    },
    reviewAuthor: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '800' },
    reviewBody: { ...TYPE.body, color: colors.textSecondary },
    reviewMeta: { ...TYPE.micro, color: colors.textMuted },
    reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    reviewMore: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
    reviewFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    helpful: {
      minHeight: 32, paddingHorizontal: 10, justifyContent: 'center', borderRadius: RADII.pill,
      borderWidth: 1, borderColor: colors.line,
    },
    helpfulOn: { borderColor: colors.primary },
    helpfulOnText: { color: colors.primaryInk, fontWeight: '800' },
    entryMore: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 32 },
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
      gap: 4, padding: 12, borderRadius: RADII.md, marginHorizontal: 16,
      borderWidth: 1, borderColor: colors.line,
    },
    lastEdit: { ...TYPE.micro, color: colors.textMuted, paddingHorizontal: 16 },
    voteWrap: { paddingHorizontal: 16 },
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

  const score = scoreFromEntry(entry);
  const myStars = entry.id in myVotes ? myVotes[entry.id] : null;
  const watched = watchlist.includes(entry.id);
  const lastEdit = detail.lastEdit;
  // Every visible note shows (ARC-01). The 3-agree gate hid all 95 seeded
  // notes forever: under the gate a note never rendered, so nobody could
  // agree it over the gate. Notes now show until reported (133 §6 flags);
  // agreements are a count, confirmed ones sort first.
  const allNotes = detail.notes
    .filter((n) => !flaggedNotes.has(n.id))
    .map((n) => ({ ...n, agreed: noteAgreements.includes(n.id) }))
    .sort((a, b) => b.agreeCount - a.agreeCount);
  const unconfirmed = allNotes.filter((n) => n.agreeCount < NOTE_AGREEMENT_GATE).length;
  const meta = [entry.release_year, entry.creator, entry.length_label]
    .filter((p) => p !== null && p !== undefined && String(p).length > 0)
    .join(' · ');

  // Every one of these store actions THROWS by design — agreeNote's own
  // docstring says a pending member's 42501 "must reach the caller as a real,
  // specific error — never swallowed into a silent no-op". The screen was the
  // caller that swallowed it: `void vote(...)` with no catch, so a failed vote
  // lit the button, silently reverted, and said nothing.
  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      logError(e, `archiveEntry.${label}`);
      setActionError(e instanceof Error ? e.message : 'That did not save. Please try again.');
    }
  };

  const castVote = async (stars: number) => {
    // 0 is "take it back", not a score. The stars column cannot hold zero and
    // should not: not having rated something is the absence of a row.
    if (stars === 0) {
      const previous = myStars ?? undefined;
      await runAction('vote', async () => {
        await withdrawVote(entry.id);
        setEntry((current) => (current ? applyLocalStarWithdraw(current, previous) : current));
      });
      return;
    }
    // Analytics AFTER the write, not before: firing first counted votes that
    // never landed, which is the same lie in the metrics as in the UI.
    const wasFirst = firstVoteLanded(myStars !== null, entry.vote_count);
    const previous = myStars ?? undefined;
    await runAction('vote', async () => {
      await vote(entry.id, stars);
      setEntry((current) => current ? applyLocalStarVote(current, previous, stars) : current);
      Analytics.archiveVoteCast(entry.slug, starsToRecommend(stars), membership.status);
      if (wasFirst) setFirstVoteOpen(true);
    });
  };

  const postReview = async () => {
    const body = reviewComment.trim();
    if (!body || !membership.canReview || myStars == null || !reviewAck) return;
    setReviewBusy(true);
    await runAction('review', async () => {
      const res = await submitReview(
        entry.id,
        body,
        // Her verdict comes from her own stars; VoteCard only offers the box
        // once she has rated, and the ack is hers to tick (ARC-05).
        starsToRecommend(myStars ?? 0),
        reviewAck,
      );
      if (res.error) throw new Error(res.error);
      setReviewComment('');
      setReviewAck(false);
      const [fresh, nextDetail] = await Promise.all([
        fetchArchiveEntry(entry.slug),
        fetchArchiveEntryDetail(entry.id),
      ]);
      if (fresh) setEntry(fresh);
      setDetail(nextDetail);
      Analytics.archiveReviewPublished(entry.slug);
    });
    setReviewBusy(false);
  };

  const requireApproved = (then: () => void) => {
    if (!membership.canReview) { setLockedOpen(true); return; }
    then();
  };

  const toggleHelpful = async (reviewId: string) => {
    const on = !myHelpful.has(reviewId);
    tapLight();
    const flip = (next: boolean) => {
      setMyHelpful((cur) => {
        const n = new Set(cur);
        if (next) n.add(reviewId); else n.delete(reviewId);
        return n;
      });
      setHelpfulDelta((cur) => ({ ...cur, [reviewId]: (cur[reviewId] ?? 0) + (next === on ? (on ? 1 : -1) : (on ? -1 : 1)) }));
    };
    flip(on);
    try {
      await setReviewHelpful(reviewId, on);
    } catch (e) {
      logError(e, 'archiveEntry.helpful');
      flip(!on);
      setActionError('That did not save. Please try again.');
    }
  };

  const shownReviews = showAllReviews ? reviews : reviews.slice(0, 5);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {back}
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={colors.primary} colors={[colors.primary]} />}
        testID="archive-entry-scroll"
      >
        {/* The design leads with colour: a 196px banner and a poster across
            its lower edge. The page had neither, and a bare ring on a flat
            background read as a settings row rather than a catalogue entry. */}
        <EntryHero
          slug={entry.slug}
          title={entry.title}
          mediaType={entry.media_type}
          meta={meta}
          coverGradient={entry.cover_gradient}
          testID="archive-entry-hero"
        />
        <Pressable
          onPress={() => setActionTarget({ kind: 'entry', id: entry.id, reporterId: userId ?? '' })}
          style={s.entryMore}
          testID="archive-entry-more"
          accessibilityRole="button"
          accessibilityLabel="Report this entry"
          hitSlop={8}
        >
          <Ionicons name="flag-outline" size={16} color={colors.textMuted} />
          <Text style={s.hint}>Something wrong or a spoiler here? Report it</Text>
        </Pressable>

        {/* A ring exists to hold a percentage. With no rating it is an empty
            circle with the word "Unreviewed" spilling out of it — so an unrated
            entry gets the invitation instead, which is the thing actually worth
            saying at that moment. */}
        {score.hasScore ? (
          <View style={s.scoreRow}>
            <ScoreRing score={score} size={72} testID="archive-entry-ring" />
            <View style={s.scoreText}>
              <VerdictLine score={score} reviewCount={entry.review_count} />
            </View>
          </View>
        ) : (
          <View style={s.unrated} testID="archive-entry-unrated">
            <Text style={s.unratedTitle}>
              {score.total === 0 ? 'Nobody has rated this yet' : `${score.total} ${score.total === 1 ? 'rating' : 'ratings'} so far`}
            </Text>
            <Text style={s.unratedBody}>
              {score.total === 0
                ? 'Yours would be the first. Rate it out of 5 — it counts from the moment you cast it.'
                : 'A few more and this shows a community average.'}
            </Text>
          </View>
        )}

        {actionError ? (
          <Text style={s.actionError} testID="archive-action-error">{actionError}</Text>
        ) : null}

        {firstVoteOpen ? (
          <View style={s.sheet} testID="archive-first-vote">
            <Text style={s.unratedTitle}>You rated this first</Text>
            <Text style={s.unratedBody}>
              That rating is live. A review is the second loop — only if you want it.
            </Text>
            {membership.canReview ? (
              <Pressable
                onPress={() => {
                  setFirstVoteOpen(false);
                  router.push(`/archive/${entry.slug}/review` as never);
                }}
                style={s.action}
                testID="archive-first-vote-review"
                accessibilityRole="button"
                accessibilityLabel="Write a review"
              >
                <Text style={s.actionText}>Write a review</Text>
              </Pressable>
            ) : (
              <Text style={s.hint}>Written reviews unlock once you are approved.</Text>
            )}
            <Pressable
              onPress={() => setFirstVoteOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
            >
              <Text style={s.link}>Keep browsing</Text>
            </Pressable>
          </View>
        ) : null}

        {entry.summary ? <Text style={s.summary}>{entry.summary}</Text> : null}

        <View style={s.voteWrap}>
        <VoteCard
          myStars={myStars}
          onRate={(stars) => void castVote(stars)}
          canComment={membership.canReview}
          comment={reviewComment}
          onCommentChange={setReviewComment}
          onSubmitComment={() => void postReview()}
          commentBusy={reviewBusy}
          ack={reviewAck}
          onAckChange={setReviewAck}
          note={
            membership.canReview
              ? 'Stars are the score. A review comment is optional and carries your name.'
              : 'Star ratings work while pending. Written reviews unlock on approval.'
          }
          testID="archive-vote"
          footer={
            <View style={s.actionRow}>
              <Pressable
                onPress={() => void runAction('toggleWatch', async () => {
                  await toggleWatch(entry.id);
                  if (!watched) Analytics.archiveWatchlistAdded(entry.slug);
                })}
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
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Content notes</Text>
          {allNotes.length > 0 ? (
            <>
              <View style={s.notes}>
                {allNotes.map((note, i) => (
                  <ContentNoteChip
                    key={note.id}
                    label={note.label}
                    agreeCount={note.agreeCount}
                    agreed={note.agreed}
                    index={i}
                    // Agreeing is a write that needs approval: a pending member
                    // gets the unlock explanation, not a refused insert (ARC-02).
                    onPress={() => requireApproved(() => void runAction('agreeNote', async () => {
                      if (note.agreed) {
                        await unagreeNote(note.id);
                      } else {
                        await agreeNote(note.id);
                        Analytics.archiveNoteAgreed(entry.slug);
                      }
                    }))}
                    onLongPress={() => setActionTarget({ kind: 'note', id: note.id, label: note.label })}
                    testID={`archive-note-${note.id}`}
                  />
                ))}
              </View>
              <Text style={s.hint} testID="archive-notes-hint">
                {unconfirmed > 0
                  ? `Tap a note you agree with${unconfirmed === 1 ? '' : ` — ${unconfirmed} are waiting for agreement`}. Hold one to flag it.`
                  : 'Tap a note you agree with. Hold one to flag it.'}
              </Text>
            </>
          ) : (
            <Text style={s.hint}>
              No content notes yet. Add the first — what is in it, never how it ends.
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
          {reviews.length > 0 ? (
            <>
            {shownReviews.map((review) => {
              const authorId = review.author?.id ?? null;
              const isMine = !!authorId && authorId === userId;
              const name = review.author?.display_name ?? review.author?.username ?? 'A member';
              const helpful = Math.max(0, review.helpful_count + (helpfulDelta[review.id] ?? 0));
              const marked = myHelpful.has(review.id);
              return (
                <View key={review.id} style={s.review} testID={`archive-review-${review.id}`}>
                  <View style={s.reviewHead}>
                    <Pressable
                      onPress={authorId ? () => router.push(`/user/${authorId}` as never) : undefined}
                      testID={`archive-review-${review.id}-author`}
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${name}'s profile`}
                      style={{ flex: 1 }}
                    >
                      <Text style={s.reviewAuthor}>{isMine ? `${name} (you)` : name}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setActionTarget({ kind: 'review', id: review.id, authorId: authorId ?? '', authorName: name, isMine })}
                      testID={`archive-review-${review.id}-more`}
                      accessibilityRole="button"
                      accessibilityLabel={isMine ? 'Edit or delete your review' : `Report or block ${name}`}
                      hitSlop={10}
                      style={s.reviewMore}
                    >
                      <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
                    </Pressable>
                  </View>
                  <Text style={s.reviewBody}>{review.body}</Text>
                  <View style={s.reviewFoot}>
                    <Text style={s.reviewMeta}>
                      {review.is_recommend ? '👍 recommends' : '👎 does not'}
                      {helpful > 0 ? ` · ${helpful} found this helpful` : ''}
                    </Text>
                    {isMine ? null : (
                      <Pressable
                        onPress={() => void toggleHelpful(review.id)}
                        testID={`archive-review-${review.id}-helpful`}
                        accessibilityRole="button"
                        accessibilityLabel={marked ? 'Remove your helpful mark' : 'Mark this review helpful'}
                        style={[s.helpful, marked && s.helpfulOn]}
                      >
                        <Text style={[s.reviewMeta, marked && s.helpfulOnText]}>{marked ? '✓ Helpful' : 'Helpful?'}</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
            {reviews.length > shownReviews.length ? (
              <Pressable
                onPress={() => setShowAllReviews(true)}
                style={s.action}
                testID="archive-reviews-see-all"
                accessibilityRole="button"
                accessibilityLabel={`See all ${reviews.length} reviews`}
              >
                <Text style={s.actionText}>See all {reviews.length} reviews</Text>
              </Pressable>
            ) : null}
            </>
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

        {/* "Last edit: …" — the design's own credit line. It is what makes
            "member-maintained" a visible fact rather than a claim: someone's
            name is on the most recent change. Absent until an edit has actually
            been published, because inventing one would be the opposite. */}
        {lastEdit ? (
          <Text style={s.lastEdit} testID="archive-last-edit">Last edit: {lastEdit}</Text>
        ) : null}
      </ScrollView>

      <ArchiveActionsSheet
        target={actionTarget}
        onClose={() => setActionTarget(null)}
        onReviewDeleted={(id) => setDetail((d) => ({ ...d, reviews: d.reviews.filter((r) => r.id !== id) }))}
        onEditReview={() => router.push(`/archive/${entry.slug}/review` as never)}
        onNoteFlagged={(id) => setFlaggedNotes((cur) => new Set(cur).add(id))}
      />

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
