import { normalizePost } from '../lib/posts';

describe('normalizePost', () => {
  const base = {
    id: 'p1',
    author_id: 'a1',
    community_id: 'c1',
    content: 'hello',
    post_type: 'photo',
    is_pinned: false,
    is_flagged: false,
    reaction_counts: {},
    comment_count: 0,
    like_count: 0,
    save_count: 0,
    feed_score: 1,
    blurhash: null,
    deleted_at: null,
    video_url: null,
    video_thumbnail_url: null,
    video_duration_secs: null,
    video_aspect_ratio: null,
    link_type: null,
    link_entity_id: null,
    link_community_id: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };

  it('defaults null media_urls to empty array', () => {
    const post = normalizePost({ ...base, media_urls: null });
    expect(post.media_urls).toEqual([]);
  });

  it('parses JSON string media_urls', () => {
    const post = normalizePost({
      ...base,
      media_urls: '["https://example.com/a.jpg"]',
    });
    expect(post.media_urls).toEqual(['https://example.com/a.jpg']);
  });

  it('keeps https media_urls for photo posts', () => {
    const post = normalizePost({
      ...base,
      media_urls: ['https://picsum.photos/seed/x/800/600'],
    });
    expect(post.post_type).toBe('photo');
    expect(post.media_urls[0]).toMatch(/^https:/);
  });
});
