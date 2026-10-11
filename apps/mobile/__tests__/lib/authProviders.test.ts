import { enabledOAuthProviders } from '../../lib/authProviders';

/** G-03: no dead buttons. A provider shows only when the build turns it on. */
describe('enabledOAuthProviders', () => {
  it('is email-only when unset or empty', () => {
    expect(enabledOAuthProviders(undefined)).toEqual([]);
    expect(enabledOAuthProviders('')).toEqual([]);
  });

  it('reads a comma list, case and space tolerant, in a stable order', () => {
    expect(enabledOAuthProviders(' Google , apple ')).toEqual(['apple', 'google']);
    expect(enabledOAuthProviders('apple')).toEqual(['apple']);
  });

  it('ignores providers it does not know', () => {
    expect(enabledOAuthProviders('apple,facebook')).toEqual(['apple']);
  });

  it('refuses Google without Apple (App Store 4.8)', () => {
    expect(enabledOAuthProviders('google')).toEqual([]);
  });
});
