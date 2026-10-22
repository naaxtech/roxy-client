import { feedCellImageUrls, imagesAhead, PREFETCH_AHEAD } from '../../../components/feed/feedPrefetch';

/**
 * Budget F15 / motion-spec §3 row 8: "the next 2 cells are mounted and their
 * first image prefetched". What a feed page shows first: the photo, or the
 * clip's poster, and the author's face.
 */
const post = (over: Record<string, unknown>) => ({
  id: 'p', post_type: 'standard', media_urls: null, video_url: null, video_thumbnail_url: null,
  profiles: { display_name: 'A', avatar_url: null }, ...over,
});

describe('feedCellImageUrls', () => {
  it('a photo post: its first photo at the size the cell draws, and her face', () => {
    expect(feedCellImageUrls(post({
      post_type: 'photo',
      media_urls: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'],
      profiles: { display_name: 'A', avatar_url: 'https://cdn.test/face.jpg' },
    }) as never)).toEqual(['https://cdn.test/1.jpg', 'https://cdn.test/face.jpg']);
  });

  it('a clip: its poster, not the video', () => {
    expect(feedCellImageUrls(post({
      post_type: 'video', video_url: 'https://cdn.test/v.mp4', video_thumbnail_url: 'https://cdn.test/poster.jpg',
    }) as never)).toEqual(['https://cdn.test/poster.jpg']);
  });

  it('a text post with a preset face has nothing to fetch', () => {
    expect(feedCellImageUrls(post({ profiles: { display_name: 'A', avatar_url: 'avatar://fox' } }) as never)).toEqual([]);
  });

  it('a page that is not a post (the daily question, caught up) has nothing to fetch', () => {
    expect(feedCellImageUrls({ id: 'daily-prompt:3', question: 'Q' } as never)).toEqual([]);
  });
});

describe('imagesAhead', () => {
  const items = [0, 1, 2, 3, 4].map((i) => post({
    id: `p${i}`, post_type: 'photo', media_urls: [`https://cdn.test/${i}.jpg`],
  }));

  it(`collects the next ${PREFETCH_AHEAD} pages after the one she is on`, () => {
    expect(PREFETCH_AHEAD).toBe(2);
    expect(imagesAhead(items as never, 1)).toEqual(['https://cdn.test/2.jpg', 'https://cdn.test/3.jpg']);
  });

  it('stops at the end of the list', () => {
    expect(imagesAhead(items as never, 4)).toEqual([]);
  });
});
