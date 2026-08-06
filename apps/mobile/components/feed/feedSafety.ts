import { callEdgeFunction } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';

/**
 * Why a post is being reported.
 *
 * These keys are not a UI list — they are the exact set `reports.reason`'s
 * CHECK constraint accepts. Adding a sixth here without a migration writes a
 * row the database refuses, so the labels move and the keys do not.
 *
 * src: supabase/migrations/008_safety.sql · reason CHECK · read 2026-08-07
 */
export const REPORT_REASONS = [
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'hate_speech', label: 'Hate speech' },
  { key: 'inappropriate', label: 'Nudity or sexual content' },
  { key: 'spam', label: 'Spam or a scam' },
  { key: 'other', label: 'Something else' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['key'];

/** Free text is optional, and long enough for a sentence rather than an essay. */
export const REPORT_DETAIL_MAX = 500;

/**
 * File a report against a post.
 *
 * Writes `reports` through the `submit-report` edge function, which is the only
 * writer of that table: `reports_insert_own` allows a client insert, but the
 * function owns rate limiting (10/day) and sets `reporter_id` from the verified
 * JWT rather than from anything the client says.
 *
 * ## Why this does not call `safetyStore.submitReport`
 *
 * It should, and it cannot yet. `submitReport` does
 * `await callEdgeFunction('submit-report', …)` and then discards the
 * `{ error }` the call returns — `callEdgeFunction` never throws, it returns.
 * So a report that failed resolves exactly like one that succeeded, and the
 * chat screen already shows "Report submitted. Thank you for keeping our
 * community safe" over a write that did not happen. Telling a woman her report
 * is filed when it is not is the worst available failure mode for this control,
 * so the feed calls the same function and reads the same envelope honestly.
 * Fixing the store is its own change; this file does not silently inherit it.
 *
 * Rejects on failure so the caller can keep her on the form with what she wrote.
 */
export async function reportPost(params: {
  postId: string;
  authorId: string;
  reason: ReportReason;
  detail: string;
}): Promise<void> {
  const detail = params.detail.trim().slice(0, REPORT_DETAIL_MAX);
  const { error } = await callEdgeFunction('submit-report', {
    userId: params.authorId,
    contentType: 'post',
    contentId: params.postId,
    reason: params.reason,
    detail: detail || undefined,
  });
  if (error) {
    // Logged, not surfaced: the message can carry a database detail and the
    // viewer needs "it did not send", not a Postgres error code.
    logError(new Error(error), 'feedSafety.reportPost');
    throw new Error('report-failed');
  }
}
