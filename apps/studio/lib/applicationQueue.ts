/**
 * Pure helpers for the applicant review tooling: the SLA badge, reason
 * categories, decision-log labels and server error wording. No I/O, so they
 * are unit-tested (__tests__/gate/applicationQueue.test.ts) and shared by the
 * queue, the appeals page and the staff dashboard card.
 *
 * G-10: applicants are told "usually within 48 hours". The queue makes that
 * promise visible to the people who have to keep it.
 */

export type WaitTone = 'ontime' | 'due' | 'overdue';

export interface WaitAge {
  hours: number;
  tone: WaitTone;
  label: string;
}

/** Under 24h: on time. 24h up to 48h: due soon. 48h and over: overdue. */
export const DUE_AFTER_HOURS = 24;
export const OVERDUE_AFTER_HOURS = 48;

export function toneForHours(hours: number): WaitTone {
  if (hours >= OVERDUE_AFTER_HOURS) return 'overdue';
  if (hours >= DUE_AFTER_HOURS) return 'due';
  return 'ontime';
}

/** How long an application has waited since she sent it (ready_at). */
export function waitAge(since: string | null | undefined, now: Date = new Date()): WaitAge {
  const t = since ? new Date(since).getTime() : NaN;
  if (!Number.isFinite(t)) return { hours: 0, tone: 'ontime', label: 'Under an hour' };
  const hours = Math.max(0, (now.getTime() - t) / 3_600_000);
  const tone = toneForHours(hours);
  const whole = Math.floor(hours);
  let span: string;
  if (whole < 1) span = 'Under an hour';
  else if (whole < 24) span = `${whole}h`;
  else span = `${Math.floor(whole / 24)}d ${whole % 24}h`;
  const label = whole < 1 ? span : tone === 'overdue' ? `${span} · overdue` : `${span} waiting`;
  return { hours, tone, label };
}

/** "under an hour" · "1 hour" · "23 hours" · "1 day" · "33 days". */
export function formatWait(hours: number): string {
  const h = Math.floor(Math.max(0, hours));
  if (h < 1) return 'under an hour';
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** Tailwind classes per tone, matching the green/amber/red used across Studio. */
export const TONE_CLASSES: Record<WaitTone, string> = {
  ontime: 'border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300',
  due: 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  overdue: 'border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
};

/**
 * Reason categories. Must equal membership_applications_decision_reason_check
 * (migration 130). The applicant sees the category in plain words in her email;
 * the free-text note stays with reviewers.
 */
export const REJECTION_REASONS: readonly { value: string; label: string }[] = [
  { value: 'not_verified', label: 'Couldn’t verify her details' },
  { value: 'not_known', label: 'The inviting community doesn’t know her' },
  { value: 'incomplete', label: 'Not enough to go on' },
  { value: 'safety', label: 'Safety concern' },
  { value: 'other', label: 'Other' },
];

export function rejectionReasonLabel(value: string | null | undefined): string {
  if (!value) return '';
  return REJECTION_REASONS.find((r) => r.value === value)?.label ?? 'Other';
}

const DECISION_LABELS: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  appeal_overturned: 'Appeal: overturned (approved)',
  appeal_upheld: 'Appeal: rejection upheld',
  grandfathered: 'Grandfathered (joined before the gate)',
  grandfather_kept: 'Grandfathered: reviewed, kept',
  grandfather_revoked: 'Grandfathered: sent to the waiting room',
  reviewer_granted: 'Made a reviewer',
  reviewer_revoked: 'Reviewer access removed',
};

export function decisionLabel(decision: string): string {
  return DECISION_LABELS[decision] ?? 'Decision';
}

export interface IdCheck {
  status: string;
  decided_at?: string | null;
  duplicate_signal?: boolean;
}

const ID_STATUS: Record<string, string> = {
  approved: 'Verified',
  declined: 'Declined',
  pending: 'In progress',
  expired: 'Expired',
  abandoned: 'Abandoned',
};

export function idCheckLabel(check: IdCheck | null | undefined): string {
  if (!check) return 'Not started';
  const base = ID_STATUS[check.status] ?? 'Unknown';
  return check.duplicate_signal ? `${base} · possible duplicate account` : base;
}

/** Server refusals from decide_application, as sentences. Never the raw text. */
export function decideErrorMessage(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already decided')) return 'Someone else has already decided this one.';
  if (m.includes('not authorised')) return 'You are not authorised to decide this application.';
  if (m.includes('at least 10 characters')) return 'A rejection needs a note of at least 10 characters.';
  if (m.includes('not been sent for review')) return 'She has not sent it for review yet.';
  if (m.includes('reason category')) return 'Pick one of the listed reasons.';
  return 'Could not save that decision. Please try again.';
}
