import type { Post, Comment } from '../types';

describe('Post type', () => {
  it('has like_count, save_count, feed_score, blurhash, deleted_at', () => {
    const p: Post = {
      id: '1', author_id: 'u1', community_id: 'c1', content: 'hi',
      media_urls: [], post_type: 'photo', is_pinned: false, is_flagged: false,
      reaction_counts: {}, comment_count: 0,
      like_count: 0, save_count: 0, feed_score: 0, blurhash: null, deleted_at: null,
      posted_as_community: false, post_tags: [],
      video_url: null, video_thumbnail_url: null, video_duration_secs: null,
      video_aspect_ratio: null, link_type: null, link_entity_id: null,
      link_community_id: null, created_at: '', updated_at: '',
    };
    expect(p.like_count).toBe(0);
    expect(p.post_type).toBe('photo');
  });

  it('Comment has parent_id, like_count, media_url, gif_url', () => {
    const c: Comment = {
      id: '1', post_id: 'p1', author_id: 'u1', parent_id: null,
      content: 'hello', media_url: null, gif_url: null,
      like_count: 0, deleted_at: null, created_at: '',
    };
    expect(c.parent_id).toBeNull();
  });
});
