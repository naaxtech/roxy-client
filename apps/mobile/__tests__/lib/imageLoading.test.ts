import {
  IMAGE_CACHE,
  IMAGE_FADE_MS,
  IMAGE_TRANSITION,
  NO_TRANSITION,
  isConstrainedConnection,
  prefetchImages,
  resetPrefetchMemory,
} from '../../lib/imageLoading';

/**
 * Budget F15 (motion-spec): frame 1 shows a placeholder, content images fade
 * in within 150 ms, an avatar never flickers on recycle, and the next pages'
 * images are already there when she lands. Wave 1 had no expo-image
 * transition anywhere and no prefetch.
 */
beforeEach(() => resetPrefetchMemory());

describe('image defaults', () => {
  it('fades content in over at least two frames and at most 150 ms', () => {
    expect(IMAGE_FADE_MS).toBeGreaterThanOrEqual(33);
    expect(IMAGE_FADE_MS).toBeLessThanOrEqual(150);
    expect(IMAGE_TRANSITION).toEqual(expect.objectContaining({ duration: IMAGE_FADE_MS, effect: 'cross-dissolve' }));
  });

  it('never fades a face in: a recycled avatar must not blink', () => {
    expect(NO_TRANSITION).toBe(0);
  });

  it('keeps decoded images in memory and on disk', () => {
    expect(IMAGE_CACHE).toBe('memory-disk');
  });
});

describe('prefetchImages', () => {
  it('warms each new http(s) url once', () => {
    const prefetch = jest.fn(() => Promise.resolve(true));
    expect(prefetchImages(['https://a/1.jpg', 'https://a/2.jpg', 'https://a/1.jpg'], { prefetch })).toEqual([
      'https://a/1.jpg', 'https://a/2.jpg',
    ]);
    expect(prefetch).toHaveBeenCalledWith(['https://a/1.jpg', 'https://a/2.jpg']);

    prefetch.mockClear();
    expect(prefetchImages(['https://a/2.jpg', 'https://a/3.jpg'], { prefetch })).toEqual(['https://a/3.jpg']);
    expect(prefetch).toHaveBeenCalledWith(['https://a/3.jpg']);
  });

  it('skips empty values and preset avatars, which are not files', () => {
    const prefetch = jest.fn(() => Promise.resolve(true));
    expect(prefetchImages([null, undefined, '', 'avatar://fox', 'https://a/1.jpg'], { prefetch })).toEqual(['https://a/1.jpg']);
  });

  it('does nothing when there is nothing new', () => {
    const prefetch = jest.fn(() => Promise.resolve(true));
    prefetchImages(['https://a/1.jpg'], { prefetch });
    prefetch.mockClear();
    prefetchImages(['https://a/1.jpg'], { prefetch });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it('leaves a constrained connection to the requests she is waiting on', () => {
    const prefetch = jest.fn(() => Promise.resolve(true));
    expect(prefetchImages(['https://a/1.jpg'], { prefetch, connection: { saveData: true } })).toEqual([]);
    expect(prefetchImages(['https://a/1.jpg'], { prefetch, connection: { effectiveType: '2g' } })).toEqual([]);
    expect(prefetch).not.toHaveBeenCalled();
    // Not remembered as warmed: a better connection later still fetches it.
    expect(prefetchImages(['https://a/1.jpg'], { prefetch, connection: { effectiveType: '4g' } })).toEqual(['https://a/1.jpg']);
  });

  it('swallows a failed prefetch: the image simply loads when shown', async () => {
    const prefetch = jest.fn(() => Promise.reject(new Error('offline')));
    expect(() => prefetchImages(['https://a/9.jpg'], { prefetch })).not.toThrow();
    await Promise.resolve();
  });
});

describe('isConstrainedConnection', () => {
  it('is true for data saver and 2G-class links only', () => {
    expect(isConstrainedConnection({ saveData: true })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: 'slow-2g' })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: '2g' })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: '3g' })).toBe(false);
    expect(isConstrainedConnection({ effectiveType: '4g' })).toBe(false);
    expect(isConstrainedConnection(undefined)).toBe(false);
  });
});
