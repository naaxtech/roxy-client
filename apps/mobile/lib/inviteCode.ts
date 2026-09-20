/**
 * Invite-code normalisation, shared by the gate screen and anything else that
 * takes a code from a human.
 *
 * Codes are Crockford base32. The generator in migration 070 draws from
 * '0123456789ABCDEFGHJKMNPQRSTVWXYZ' — I, L, O and U are absent because they are
 * misread when spoken aloud or copied off a screen, which is exactly how these
 * codes travel: read out in a DM, retyped from a friend's phone.
 *
 * Crockford's decoder folds the excluded letters back to what the writer meant:
 * I and L to 1, O to 0. U is excluded for a different reason (it keeps the
 * alphabet from spelling accidental obscenities) and the spec gives it no decode
 * mapping, so we fold it to V — the only alphabet character it is confused with
 * in handwriting, and the substitution a human typing a code she misread would
 * make anyway.
 *
 * This is not cosmetic. gateStore's CODE_MESSAGES tells the applicant outright
 * that "codes never contain I, L, O or U"; letting any of the four reach the
 * server means the app contradicts its own error message and she is told her
 * valid code is invalid.
 *
 * src: https://www.crockford.com/base32.html · 2026-08-02
 */

/** The generator alphabet from migration 070. Kept here so a test can prove no substitution escapes it. */
export const INVITE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Codes are ten characters wide (migration 070: ten draws from the alphabet). */
export const INVITE_CODE_LENGTH = 10;

/**
 * Fold a typed code to the alphabet the server actually issues.
 *
 * Uppercases, drops anything that is not a letter or digit (spaces and dashes
 * survive a copy-paste far more often than they should), then applies the
 * Crockford substitutions.
 */
export const normaliseInviteCode = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
