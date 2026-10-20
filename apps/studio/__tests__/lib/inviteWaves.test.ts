import { validateWave, codesToCsv, csvCell, WAVE_MAX_CODES } from '@/lib/inviteWaves';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const COMMUNITY = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

describe('validateWave', () => {
  it('accepts 1 to 200 whole codes with a label and a future expiry', () => {
    expect(validateWave({ count: '50', label: ' Wave 1 — Pride ', expiry: '2026-11-01', communityId: '' }, NOW)).toEqual({
      ok: true,
      count: 50,
      label: 'Wave 1 — Pride',
      expiresAt: '2026-11-01T23:59:59.000Z',
      communityId: null,
    });
    expect(validateWave({ count: '1', label: 'w', expiry: '2026-10-12', communityId: COMMUNITY }, NOW)).toMatchObject({
      ok: true,
      count: 1,
      communityId: COMMUNITY,
    });
  });

  it('rejects counts outside 1..200 or not whole', () => {
    for (const count of ['0', '201', '2.5', '', 'abc', '-3']) {
      expect(validateWave({ count, label: 'w', expiry: '2026-11-01', communityId: '' }, NOW)).toEqual({
        ok: false,
        error: `How many codes? A whole number from 1 to ${WAVE_MAX_CODES}.`,
      });
    }
  });

  it('needs a wave label up to 80 characters', () => {
    expect(validateWave({ count: '5', label: '  ', expiry: '2026-11-01', communityId: '' }, NOW)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/label/i),
    });
    expect(validateWave({ count: '5', label: 'x'.repeat(81), expiry: '2026-11-01', communityId: '' }, NOW)).toMatchObject({
      ok: false,
    });
  });

  it('needs an expiry in the future and within a year', () => {
    expect(validateWave({ count: '5', label: 'w', expiry: '', communityId: '' }, NOW)).toMatchObject({ ok: false });
    expect(validateWave({ count: '5', label: 'w', expiry: '2026-10-10', communityId: '' }, NOW)).toMatchObject({
      ok: false,
    });
    expect(validateWave({ count: '5', label: 'w', expiry: '2028-01-01', communityId: '' }, NOW)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/year/i),
    });
  });

  it('rejects a community id that is not a uuid', () => {
    expect(validateWave({ count: '5', label: 'w', expiry: '2026-11-01', communityId: 'roxy' }, NOW)).toEqual({
      ok: false,
      error: 'Choose a community from the list.',
    });
  });
});

describe('codesToCsv', () => {
  it('writes a header and one row per code', () => {
    const csv = codesToCsv([
      { code: 'ABCD2345', label: 'Wave 1', communityName: 'Roxy Official', expiresAt: '2026-11-01T23:59:59.000Z' },
      { code: 'EFGH6789', label: 'Wave 1', communityName: 'Roxy Official', expiresAt: '2026-11-01T23:59:59.000Z' },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'code,wave,community,expires_utc',
      'ABCD2345,Wave 1,Roxy Official,2026-11-01',
      'EFGH6789,Wave 1,Roxy Official,2026-11-01',
    ]);
  });

  it('quotes commas and quotes, and defuses spreadsheet formulas', () => {
    expect(csvCell('Pride, June')).toBe('"Pride, June"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@me')).toBe("'@me");
  });
});
