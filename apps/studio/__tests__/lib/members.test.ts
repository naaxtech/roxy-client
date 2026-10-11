import {
  validateSuspension,
  validateLift,
  memberErrorMessage,
  vettingLabel,
  SUSPEND_REASON_MIN,
} from '@/lib/members';

const NOW = new Date('2026-10-11T12:00:00.000Z');

describe('validateSuspension', () => {
  it('needs a reason of 3 to 2000 characters', () => {
    expect(validateSuspension('  ', '', NOW)).toEqual({ ok: false, error: `Give a reason (at least ${SUSPEND_REASON_MIN} characters).` });
    expect(validateSuspension('ab', '', NOW)).toMatchObject({ ok: false });
    expect(validateSuspension('x'.repeat(2001), '', NOW)).toEqual({ ok: false, error: 'Keep the reason under 2000 characters.' });
    expect(validateSuspension('  harassment  ', '', NOW)).toEqual({ ok: true, reason: 'harassment', until: null });
  });

  it('turns an end date into the end of that UTC day, and only in the future', () => {
    expect(validateSuspension('spam ring', '2026-11-01', NOW)).toEqual({
      ok: true,
      reason: 'spam ring',
      until: '2026-11-01T23:59:59.000Z',
    });
    expect(validateSuspension('spam ring', '2026-10-10', NOW)).toEqual({
      ok: false,
      error: 'The end date has to be in the future.',
    });
    expect(validateSuspension('spam ring', 'not-a-date', NOW)).toEqual({
      ok: false,
      error: 'That end date could not be read. Pick it again.',
    });
  });
});

describe('validateLift', () => {
  it('allows an empty note and caps a long one', () => {
    expect(validateLift('   ')).toEqual({ ok: true, note: null });
    expect(validateLift(' appeal upheld ')).toEqual({ ok: true, note: 'appeal upheld' });
    expect(validateLift('x'.repeat(2001))).toEqual({ ok: false, error: 'Keep the note under 2000 characters.' });
  });
});

describe('memberErrorMessage', () => {
  it('maps the RPC codes to plain words', () => {
    expect(memberErrorMessage({ code: 'PGRST202', message: '' })).toMatch(/migration 131/);
    expect(memberErrorMessage({ code: '42501', message: 'Only core staff can suspend a staff member' })).toBe(
      'Only core staff can suspend a staff member',
    );
    expect(memberErrorMessage({ code: '23505', message: 'This member is already suspended' })).toBe(
      'This member is already suspended',
    );
    expect(memberErrorMessage({ code: 'P0002', message: 'This member is not suspended' })).toBe(
      'This member is not suspended',
    );
    expect(memberErrorMessage({ code: 'XX000', message: 'internal' })).toBe(
      'That did not go through. Nothing was changed — try again.',
    );
  });
});

describe('vettingLabel', () => {
  it('labels known states and passes unknown ones through', () => {
    expect(vettingLabel('approved')).toBe('Approved member');
    expect(vettingLabel('pending')).toBe('Applicant');
    expect(vettingLabel(null)).toBe('Unknown');
    expect(vettingLabel('mystery')).toBe('mystery');
  });
});
