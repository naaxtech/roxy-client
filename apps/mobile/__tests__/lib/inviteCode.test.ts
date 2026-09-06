import {
  normaliseInviteCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
} from '../../lib/inviteCode';

/**
 * The gate's error copy promises "codes never contain I, L, O or U"
 * (gateStore.CODE_MESSAGES). If any of those four survives normalisation the
 * app sends a character the generator cannot have produced and tells a woman
 * with a perfectly good code that it is invalid.
 */
describe('normaliseInviteCode — Crockford substitutions', () => {
  it('folds I to 1', () => {
    expect(normaliseInviteCode('I')).toBe('1');
  });

  // Fails before the fix: the old normalise() mapped only I and O.
  it('folds L to 1', () => {
    expect(normaliseInviteCode('L')).toBe('1');
  });

  it('folds O to 0', () => {
    expect(normaliseInviteCode('O')).toBe('0');
  });

  // Fails before the fix: U was passed through untouched.
  it('folds U to V', () => {
    expect(normaliseInviteCode('U')).toBe('V');
  });

  it('folds a code that uses all four excluded letters', () => {
    expect(normaliseInviteCode('ILOU')).toBe('110V');
  });
});

describe('normaliseInviteCode — output stays inside the generator alphabet', () => {
  /**
   * The property that matters: whatever she types, what leaves this function
   * must be something migration 070's generator could have produced. This is
   * the test that would have caught the missing L and U without anyone having
   * to think of them individually.
   */
  it('never emits a character outside the migration 070 alphabet', () => {
    const everyTypeableChar = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const out = normaliseInviteCode(everyTypeableChar);
    const escaped = [...out].filter((c) => !INVITE_CODE_ALPHABET.includes(c));
    expect(escaped).toEqual([]);
  });

  it('excludes I, L, O and U from the alphabet it normalises towards', () => {
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(INVITE_CODE_ALPHABET).not.toContain(excluded);
    }
  });
});

describe('normaliseInviteCode — input hygiene', () => {
  it('uppercases lowercase input', () => {
    expect(normaliseInviteCode('abc')).toBe('ABC');
  });

  it('folds lowercase excluded letters too', () => {
    expect(normaliseInviteCode('ilou')).toBe('110V');
  });

  it('strips spaces, dashes and punctuation from a pasted code', () => {
    expect(normaliseInviteCode(' 7KX-9M2 ')).toBe('7KX9M2');
  });

  it('leaves an already-valid generated code untouched', () => {
    const generated = 'H7K9MNPQRS';
    expect(generated).toHaveLength(INVITE_CODE_LENGTH);
    expect(normaliseInviteCode(generated)).toBe(generated);
  });

  it('returns empty string for input with nothing usable in it', () => {
    expect(normaliseInviteCode('   ---   ')).toBe('');
  });
});
