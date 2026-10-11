import { captchaSiteKey, captchaRequired } from '../../lib/captcha';

/**
 * Turnstile is switched on by one public env var (inlined at build time, so
 * the tests pass the value in). Unset (today) means no widget and no token,
 * so nothing changes for anyone.
 */
describe('captcha config', () => {
  it('is off in this build (no site key configured)', () => {
    expect(captchaSiteKey()).toBeNull();
    expect(captchaRequired('web')).toBe(false);
  });

  it('is off without a site key, and off for a blank one', () => {
    expect(captchaSiteKey(undefined)).toBeNull();
    expect(captchaSiteKey('   ')).toBeNull();
    expect(captchaRequired('web', '')).toBe(false);
  });

  it('with a site key: required on web only (native has no widget yet)', () => {
    const key = '0x4AAAAAAA-test';
    expect(captchaSiteKey(key)).toBe(key);
    expect(captchaRequired('web', key)).toBe(true);
    expect(captchaRequired('ios', key)).toBe(false);
    expect(captchaRequired('android', key)).toBe(false);
  });
});
