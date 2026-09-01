/**
 * What a report can be about.
 *
 * One list, because three places have to agree and did not: this constant, the
 * CHECK on `reports.content_type`, and the allowlist in
 * `supabase/functions/submit-report`. `safetyStore` widened its union to include
 * `room` and `speed_date` when the live surfaces got report buttons and left a
 * comment asking a future session to widen the other two. A comment is not a
 * mechanism — `__tests__/lib/reportContentTypes.test.ts` reads the migration and
 * the edge function off disk and fails when any of the three drifts.
 *
 * The two live values are not decoration. Reporting a video date as though it
 * were a `profile` throws away the one detail a moderator needs to find it —
 * which session, at what time — and a report a moderator cannot act on is a
 * report that did not happen.
 */
export const REPORT_CONTENT_TYPES = [
  'message',
  'post',
  'profile',
  'room',
  'speed_date',
] as const;

export type ReportContentType = (typeof REPORT_CONTENT_TYPES)[number];
