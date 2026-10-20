import {
  waitAge,
  rejectionReasonLabel,
  REJECTION_REASONS,
  decisionLabel,
  idCheckLabel,
  decideErrorMessage,
  formatWait,
} from '@/lib/applicationQueue';

const NOW = new Date('2026-10-11T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe('waitAge — the SLA badge (G-10: we promise 48 hours)', () => {
  it('is on time under 24 hours', () => {
    expect(waitAge(hoursAgo(0), NOW).tone).toBe('ontime');
    expect(waitAge(hoursAgo(23.9), NOW).tone).toBe('ontime');
  });

  it('is due soon from 24 to just under 48 hours', () => {
    expect(waitAge(hoursAgo(24), NOW).tone).toBe('due');
    expect(waitAge(hoursAgo(47.9), NOW).tone).toBe('due');
  });

  it('is overdue at 48 hours and beyond', () => {
    expect(waitAge(hoursAgo(48), NOW).tone).toBe('overdue');
    expect(waitAge(hoursAgo(33 * 24), NOW).tone).toBe('overdue');
  });

  it('labels the wait in words a reviewer reads at a glance', () => {
    expect(waitAge(hoursAgo(0.2), NOW).label).toBe('Under an hour');
    expect(waitAge(hoursAgo(5), NOW).label).toBe('5h waiting');
    expect(waitAge(hoursAgo(30), NOW).label).toBe('1d 6h waiting');
    expect(waitAge(hoursAgo(50), NOW).label).toBe('2d 2h · overdue');
  });

  it('never claims a negative or unparseable wait', () => {
    expect(waitAge(new Date(NOW.getTime() + 3600_000).toISOString(), NOW).hours).toBe(0);
    expect(waitAge('not a date', NOW)).toEqual({ hours: 0, tone: 'ontime', label: 'Under an hour' });
    expect(waitAge(null, NOW)).toEqual({ hours: 0, tone: 'ontime', label: 'Under an hour' });
  });
});

describe('formatWait', () => {
  it('reads hours under a day and days after', () => {
    expect(formatWait(0)).toBe('under an hour');
    expect(formatWait(1)).toBe('1 hour');
    expect(formatWait(23)).toBe('23 hours');
    expect(formatWait(24)).toBe('1 day');
    expect(formatWait(800)).toBe('33 days');
  });
});

describe('reason categories', () => {
  it('match the database CHECK exactly (130 membership_applications_decision_reason_check)', () => {
    expect(REJECTION_REASONS.map((r) => r.value)).toEqual([
      'not_verified',
      'not_known',
      'incomplete',
      'safety',
      'other',
    ]);
  });

  it('label every key and never show a raw key', () => {
    for (const r of REJECTION_REASONS) {
      expect(rejectionReasonLabel(r.value)).toBe(r.label);
      expect(r.label).not.toMatch(/_/);
    }
    expect(rejectionReasonLabel(null)).toBe('');
    expect(rejectionReasonLabel('something_new')).toBe('Other');
  });
});

describe('decision log labels', () => {
  it('names every decision the append-only log can hold', () => {
    for (const d of [
      'approved', 'rejected', 'appeal_overturned', 'appeal_upheld', 'grandfathered',
      'grandfather_kept', 'grandfather_revoked', 'reviewer_granted', 'reviewer_revoked',
    ]) {
      expect(decisionLabel(d)).not.toBe(d);
      expect(decisionLabel(d)).not.toMatch(/_/);
    }
  });
});

describe('ID check status', () => {
  it('reads plainly, including when she never started one', () => {
    expect(idCheckLabel(null)).toBe('Not started');
    expect(idCheckLabel({ status: 'approved' })).toBe('Verified');
    expect(idCheckLabel({ status: 'declined' })).toBe('Declined');
    expect(idCheckLabel({ status: 'pending' })).toBe('In progress');
    expect(idCheckLabel({ status: 'approved', duplicate_signal: true })).toBe(
      'Verified · possible duplicate account',
    );
  });
});

describe('decideErrorMessage', () => {
  it('turns each server refusal into a sentence', () => {
    expect(decideErrorMessage('application already decided')).toMatch(/already decided/i);
    expect(decideErrorMessage('not authorised to decide this application')).toMatch(/not authorised/i);
    expect(decideErrorMessage('a rejection requires a note of at least 10 characters')).toMatch(/10 characters/);
    expect(decideErrorMessage('this application has not been sent for review yet')).toMatch(/not sent it/i);
    expect(decideErrorMessage('unknown reason category')).toMatch(/reason/i);
    expect(decideErrorMessage('duplicate key value')).toBe('Could not save that decision. Please try again.');
  });
});
