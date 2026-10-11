import { authErrorCopy } from '../../lib/authErrorCopy';

describe('authErrorCopy', () => {
  it('a dropped connection is never shown as a raw "Failed to fetch"', () => {
    const c = authErrorCopy({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 });
    expect(c.title).toBe("Can't reach Roxy");
    expect(c.body).not.toMatch(/fetch/i);
  });

  it.each(['Failed to fetch', 'Network request failed', 'Load failed', 'NetworkError when attempting to fetch resource.'])(
    'browser/native network wording "%s" maps to the connection message',
    (message) => {
      expect(authErrorCopy({ message }).title).toBe("Can't reach Roxy");
    },
  );

  it('throttling tells her to wait instead of blaming her password', () => {
    for (const e of [{ status: 429, message: 'x' }, { message: 'Request rate limit reached' }, { message: 'Too many requests' }]) {
      const c = authErrorCopy(e);
      expect(c.title).toBe('Slow down a little');
      expect(c.body).toMatch(/few minutes/);
    }
  });

  it('anything else keeps the server message under the old title', () => {
    expect(authErrorCopy({ message: 'Invalid login credentials', status: 400 })).toEqual({
      title: 'Error',
      body: 'Invalid login credentials',
    });
  });

  it('survives a missing error object', () => {
    expect(authErrorCopy(undefined).title).toBe('Error');
  });
});
