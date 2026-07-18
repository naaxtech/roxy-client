import {
  IDENTITY_LABELS,
  INTERESTS,
  PRONOUNS,
  MAX_INTERESTS,
  ROXY_SISTER_MAX_TURNS,
  USERNAME_REGEX,
} from '../../lib/constants';

describe('constants', () => {
  it('INTERESTS has exactly 24 items', () => {
    expect(INTERESTS).toHaveLength(24);
  });

  it('IDENTITY_LABELS has exactly 8 items and no opt-out option', () => {
    expect(IDENTITY_LABELS).toHaveLength(8);
    expect(IDENTITY_LABELS).not.toContain('Prefer not to say');
  });

  it('PRONOUNS has exactly 3 items and no any/all or other', () => {
    expect(PRONOUNS).toHaveLength(3);
    expect(PRONOUNS).not.toContain('any/all');
    expect(PRONOUNS).not.toContain('other');
  });

  it('MAX_INTERESTS is 8', () => {
    expect(MAX_INTERESTS).toBe(8);
  });

  it('ROXY_SISTER_MAX_TURNS is 10', () => {
    expect(ROXY_SISTER_MAX_TURNS).toBe(10);
  });

  it('USERNAME_REGEX allows alphanumeric and underscore', () => {
    expect(USERNAME_REGEX.test('hello_world123')).toBe(true);
    expect(USERNAME_REGEX.test('hello-world')).toBe(false);
    expect(USERNAME_REGEX.test('hello world')).toBe(false);
  });
});
