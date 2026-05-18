import { getPostImageUrl } from '../lib/media';

process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';

describe('getPostImageUrl', () => {
  it('thumb: width=120 quality=60 format=avif', () => {
    const url = getPostImageUrl('u1/p1/photo.jpg', 'thumb');
    expect(url).toContain('/render/image/public/post-media/u1/p1/photo.jpg');
    expect(url).toContain('width=120');
    expect(url).toContain('quality=60');
    expect(url).toContain('format=webp');
  });

  it('feed: width=400 quality=75', () => {
    const url = getPostImageUrl('u1/p1/photo.jpg', 'feed');
    expect(url).toContain('width=400');
    expect(url).toContain('quality=75');
  });

  it('detail: width=800 quality=85', () => {
    const url = getPostImageUrl('u1/p1/photo.jpg', 'detail');
    expect(url).toContain('width=800');
    expect(url).toContain('quality=85');
  });

  it('returns absolute URLs unchanged (seed / external media)', () => {
    const external = 'https://picsum.photos/seed/roxy-hike/800/600';
    expect(getPostImageUrl(external, 'feed')).toBe(external);
  });
});
