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

  it('IDENTITY_LABELS has exactly 9 items', () => {
    expect(IDENTITY_LABELS).toHaveLength(9);
  });

  it('PRONOUNS has exactly 5 items', () => {
    expect(PRONOUNS).toHaveLength(5);
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
