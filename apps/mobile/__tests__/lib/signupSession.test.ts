import {
  isGhostSignupUser,
  sessionEmailMatches,
  storedProfileIsForUser,
} from '../../lib/signupSession';

describe('sessionEmailMatches', () => {
  it('requires the live session to be the email she just typed', () => {
    expect(
      sessionEmailMatches(
        { user: { email: 'thepurrfessionals@gmail.com' } },
        'thepurrfessionals@gmail.com',
      ),
    ).toBe(true);
    expect(
      sessionEmailMatches(
        { user: { email: 'naaxtech.official@gmail.com' } },
        'thepurrfessionals@gmail.com',
      ),
    ).toBe(false);
    expect(sessionEmailMatches(null, 'thepurrfessionals@gmail.com')).toBe(false);
    expect(sessionEmailMatches({ user: { email: null } }, 'a@b.com')).toBe(false);
  });

  it('ignores case and surrounding space', () => {
    expect(
      sessionEmailMatches(
        { user: { email: 'ThePurrfessionals@gmail.com' } },
        '  thepurrfessionals@gmail.com ',
      ),
    ).toBe(true);
  });
});

describe('isGhostSignupUser', () => {
  it('treats an identities-empty user as "this email already has an account"', () => {
    expect(isGhostSignupUser({ identities: [] })).toBe(true);
    expect(isGhostSignupUser({ identities: [{ id: 'i1' }] })).toBe(false);
    expect(isGhostSignupUser(null)).toBe(false);
  });
});

describe('storedProfileIsForUser', () => {
  it('rejects a leftover profile from the previous account', () => {
    expect(storedProfileIsForUser('juicypeach-id', 'purrfessional-id')).toBe(false);
    expect(storedProfileIsForUser('purrfessional-id', 'purrfessional-id')).toBe(true);
    expect(storedProfileIsForUser('juicypeach-id', null)).toBe(false);
    expect(storedProfileIsForUser(null, 'purrfessional-id')).toBe(false);
  });
});
