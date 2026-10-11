import { supabase, callEdgeFunction } from './supabase';
import { logError } from './errorLogger';

/**
 * The Archive's safety and courtesy writes: Helpful marks, deleting her own
 * review, and reports. Every one RESOLVES only when the write landed and
 * REJECTS otherwise, so a screen can roll its optimistic state back.
 */

/** Which of these reviews she has marked helpful (own rows only — 096 RLS). */
export async function fetchMyHelpful(reviewIds: string[]): Promise<Set<string>> {
  if (reviewIds.length === 0) return new Set();
  const { data: auth } = await supabase.auth.getSession();
  const me = auth.session?.user.id;
  if (!me) return new Set();
  const { data, error } = await supabase
    .from('archive_review_helpful')
    .select('review_id')
    .eq('profile_id', me)
    .in('review_id', reviewIds);
  if (error) {
    logError(error, 'archiveSafety.fetchMyHelpful');
    return new Set();
  }
  return new Set(((data ?? []) as { review_id: string }[]).map((r) => r.review_id));
}

/**
 * Mark or unmark a review helpful. `helpful_count` is trigger-maintained (097)
 * from these rows, so this is the whole write. "Helpful" was display-only text
 * before (ARC-06): every review read "0 found this helpful" forever.
 */
export async function setReviewHelpful(reviewId: string, on: boolean): Promise<void> {
  const { data: auth } = await supabase.auth.getSession();
  const me = auth.session?.user.id;
  if (!me) throw new Error('signed-out');
  if (on) {
    const { error } = await supabase
      .from('archive_review_helpful')
      .insert({ review_id: reviewId, profile_id: me });
    // 23505: already marked — the state she asked for is the state it is in.
    if (error && error.code !== '23505') {
      logError(error, 'archiveSafety.setReviewHelpful');
      throw new Error('helpful-failed');
    }
    return;
  }
  const { error } = await supabase
    .from('archive_review_helpful')
    .delete()
    .eq('review_id', reviewId)
    .eq('profile_id', me);
  if (error) {
    logError(error, 'archiveSafety.setReviewHelpful');
    throw new Error('helpful-failed');
  }
}

/** Delete her own review (096 delete-own policy). Zero rows is not a delete. */
export async function deleteMyReview(reviewId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getSession();
  const me = auth.session?.user.id;
  if (!me) throw new Error('signed-out');
  const { error, count } = await supabase
    .from('archive_reviews')
    .delete({ count: 'exact' })
    .eq('id', reviewId)
    .eq('author_id', me);
  if (error || count === 0) {
    if (error) logError(error, 'archiveSafety.deleteMyReview');
    throw new Error('delete-failed');
  }
}

export type ArchiveReportReason =
  | 'archive_spoiler' | 'archive_review_abuse' | 'archive_bad_entry' | 'other';

/**
 * File an Archive report. The reasons and content types are the ones 099/100
 * added and Studio's Archive queue reads; until this the member app never
 * sent one, so that queue was always empty (ARC-03).
 */
export async function reportArchiveContent(params: {
  contentType: 'archive_review' | 'archive_entry';
  contentId: string;
  /** The author of a review; for an entry, whoever the screen can name (may be her own id). */
  userId: string;
  reason: ArchiveReportReason;
  detail?: string;
}): Promise<void> {
  const { error } = await callEdgeFunction('submit-report', {
    userId: params.userId,
    contentType: params.contentType,
    contentId: params.contentId,
    reason: params.reason,
    detail: params.detail?.trim() || undefined,
  });
  if (error) {
    logError(new Error(error), 'archiveSafety.report');
    throw new Error('report-failed');
  }
}
