/**
 * The Studio reports queue: vocabulary and pure decisions.
 *
 * Every type a member can report (submit-report REPORT_CONTENT_TYPES, the
 * reports.content_type CHECK from migrations 094 + 100) lands in ONE queue at
 * /staff/reports. Resolution goes through staff_resolve_report() (migration
 * 131): it hides what can be hidden, closes every pending report about the same
 * content, optionally suspends the reported member and writes the audit row in
 * the same transaction. Nothing here talks to the database.
 */

export const REPORT_CONTENT_TYPES = [
  'post',
  'message',
  'profile',
  'room',
  'speed_date',
  'archive_entry',
  'archive_review',
  // 132 (chat): a whole DM or group; content_id is the conversation id.
  'conversation',
  // 133 (feed): a comment; content_id is the comment id.
  'comment',
] as const;
export type ReportContentType = (typeof REPORT_CONTENT_TYPES)[number];

export const REPORT_STATUSES = ['pending', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type StatusFilter = ReportStatus | 'all';
export type TypeFilter = ReportContentType | 'all';

export interface ReportFilters {
  status: StatusFilter;
  type: TypeFilter;
}

/** Content staff_resolve_report knows how to hide (its CASE on content_type). */
const HIDEABLE: readonly string[] = ['post', 'archive_entry', 'archive_review', 'room'];

export function canHide(contentType: string): boolean {
  return HIDEABLE.includes(contentType);
}

const TYPE_LABELS: Record<ReportContentType, string> = {
  post: 'Post',
  message: 'Message',
  profile: 'Profile',
  room: 'Room',
  speed_date: 'Speed date',
  archive_entry: 'Archive entry',
  archive_review: 'Archive review',
  conversation: 'Conversation',
  comment: 'Comment',
};

export function contentTypeLabel(type: string): string {
  return (TYPE_LABELS as Record<string, string>)[type] ?? type;
}

const REASON_LABELS: Record<string, string> = {
  harassment: 'Harassment',
  spam: 'Spam',
  inappropriate: 'Inappropriate',
  hate_speech: 'Hate speech',
  other: 'Other',
  archive_spoiler: 'Archive spoiler',
  archive_bad_entry: 'Bad Archive entry',
  archive_review_abuse: 'Review abuse',
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** URL search params → a filter the query can trust (unknown values fall back). */
export function parseReportFilters(
  params: Record<string, string | string[] | undefined>,
): ReportFilters {
  const status = first(params.status);
  const type = first(params.type);
  return {
    status:
      status === 'all' || (REPORT_STATUSES as readonly string[]).includes(status ?? '')
        ? (status as StatusFilter)
        : 'pending',
    type:
      type && (REPORT_CONTENT_TYPES as readonly string[]).includes(type)
        ? (type as ReportContentType)
        : 'all',
  };
}

/** What staff can choose in the detail panel. */
export const RESOLUTION_CHOICES = ['dismiss', 'action', 'hide', 'suspend', 'hide_suspend'] as const;
export type ResolutionChoice = (typeof RESOLUTION_CHOICES)[number];

export interface ResolveArgs {
  p_action: 'dismiss' | 'action' | 'hide';
  p_suspend_author: boolean;
}

export function resolutionFor(choice: ResolutionChoice): ResolveArgs | null {
  switch (choice) {
    case 'dismiss':
      return { p_action: 'dismiss', p_suspend_author: false };
    case 'action':
      return { p_action: 'action', p_suspend_author: false };
    case 'hide':
      return { p_action: 'hide', p_suspend_author: false };
    case 'suspend':
      return { p_action: 'action', p_suspend_author: true };
    case 'hide_suspend':
      return { p_action: 'hide', p_suspend_author: true };
    default:
      return null;
  }
}

export const RESOLUTION_NOTE_MAX = 2000;

interface RpcError {
  code?: string;
  message?: string;
}

const MISSING_FUNCTION = ['PGRST202', '42883'];

/**
 * staff_resolve_report raises with deliberate, human wording for every
 * validation case (22023 / P0002); anything else is a database fault whose text
 * staff should not have to read.
 */
export function resolveErrorMessage(error: RpcError): string {
  const code = error.code ?? '';
  if (MISSING_FUNCTION.includes(code)) {
    return 'Report resolution is not live on this database yet (migration 131). Nothing was changed.';
  }
  if (code === '42501') {
    return 'Only Roxy staff can resolve reports, and only core staff can suspend another staff member.';
  }
  if (code === '55000') {
    return 'This report was already resolved by someone else. Reload to see the outcome.';
  }
  if ((code === '22023' || code === 'P0002' || code === '23505') && error.message) {
    return error.message;
  }
  return 'Could not resolve that report. Nothing was changed — try again.';
}

export interface ResolveResult {
  status: string;
  resolved: number;
  hidden: boolean;
  suspension_id: string | null;
}

export function resolveSuccessMessage(result: ResolveResult): string {
  const verb = result.status === 'dismissed' ? 'Dismissed' : 'Actioned';
  const n = Number(result.resolved) || 0;
  const parts = [`${verb} ${n} report${n === 1 ? '' : 's'}.`];
  if (result.hidden) parts.push('The content is hidden.');
  if (result.suspension_id) parts.push('The member is suspended.');
  return parts.join(' ');
}
