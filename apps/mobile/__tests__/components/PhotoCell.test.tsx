import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PhotoCell } from '../../components/feed/PhotoCell';
import type { ReelRow } from '../../lib/reels';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `roxy:/${path}` }));

const BASE: ReelRow = {
  id: 'p1',
  author_id: 'u1',
  community_id: 'c1',
  content: 'sunday market',
  media_urls: ['u1/a.jpg'],
  post_type: 'photo',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 0,
  like_count: 3,
  save_count: 0,
  feed_score: 10,
  blurhash: 'LEHV6nWB2yk8',
  deleted_at: null,
  posted_as_community: false,
  post_tags: [],
  video_url: null,
  video_thumbnail_url: null,
  video_duration_secs: null,
  video_aspect_ratio: null,
  link_type: null,
  link_entity_id: null,
  link_community_id: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  profiles: { display_name: 'Mara', avatar_url: null },
  communities: { name: 'The Sapphic Club' },
};

function makePost(overrides: Partial<ReelRow> = {}): ReelRow {
  return { ...BASE, ...overrides };
}

const noop = (): void => undefined;
const WIDTH = 400;

function photo(post: ReelRow = BASE) {
  return render(
    <PhotoCell
      post={post}
      width={WIDTH}
      height={800}
      liked={false}
      saved={false}
      likeCount={3}
      reducedMotion={false}
      onLike={noop}
      onSave={noop}
      onOpenComments={noop}
      onOpenAuthor={noop}
      onOpenCommunity={noop}
      onOpenSafety={noop}
      onOpenPost={noop}
    />,
  );
}

function scrollTo(view: ReturnType<typeof photo>, page: number): void {
  fireEvent.scroll(view.getByTestId('photo-cell-pager'), {
    nativeEvent: {
      contentOffset: { x: WIDTH * page, y: 0 },
      contentSize: { width: WIDTH * 3, height: 800 },
      layoutMeasurement: { width: WIDTH, height: 800 },
    },
  });
}

describe('PhotoCell', () => {
  it('renders the still full-bleed at the page size the pager measured', () => {
    const view = photo();

    const image = view.getByTestId('photo-cell-image-0');
    expect(image.props.style).toEqual(
      expect.objectContaining({ width: WIDTH, height: 800 }),
    );
  });

  it('recycling-keys every image, so a reused cell never flashes the last photo', () => {
    const view = photo(makePost({ post_type: 'gallery', media_urls: ['a.jpg', 'b.jpg'] }));

    // Documented cause of the previous cell's photo appearing on the next one.
    expect(view.getByTestId('photo-cell-image-0').props.recyclingKey).toBe('p1:0');
    expect(view.getByTestId('photo-cell-image-1').props.recyclingKey).toBe('p1:1');
  });

  it('carries the same chrome as every other cell', () => {
    const view = photo();

    expect(view.queryByTestId('feed-rail')).not.toBeNull();
    expect(view.queryByTestId('community-crest')).not.toBeNull();
    expect(view.queryByTestId('feed-cell-caption')).not.toBeNull();
  });

  it('never renders a play control, because a still does not play', () => {
    const view = photo();

    expect(view.queryByTestId('photo-cell-play')).toBeNull();
    expect(view.queryByTestId('rail-play')).toBeNull();
  });
});

describe('PhotoCell gallery', () => {
  const gallery = makePost({
    post_type: 'gallery',
    media_urls: ['a.jpg', 'b.jpg', 'c.jpg'],
  });

  it('gives a multi-image post a horizontal pager with one dot per image', () => {
    const view = photo(gallery);

    expect(view.getByTestId('photo-cell-pager').props.horizontal).toBe(true);
    expect(view.queryByTestId('photo-cell-dots')).not.toBeNull();
    expect(view.getByTestId('photo-cell-dot-0')).toBeTruthy();
    expect(view.getByTestId('photo-cell-dot-2')).toBeTruthy();
    expect(view.queryByTestId('photo-cell-dot-3')).toBeNull();
  });

  it('locks the horizontal pager to its own axis so it cannot fight the vertical one', () => {
    const props = photo(gallery).getByTestId('photo-cell-pager').props;

    expect(props.directionalLockEnabled).toBe(true);
    expect(props.nestedScrollEnabled).toBe(true);
    expect(props.showsHorizontalScrollIndicator).toBe(false);
  });

  it('shows no dots for a single image — one dot is a lie about there being more', () => {
    const view = photo();

    expect(view.queryByTestId('photo-cell-dots')).toBeNull();
  });

  it('makes every photo its own focus target, so the pager can be traversed', () => {
    // The label used to sit on the ScrollView, which is not `accessible` and so
    // is not a focus target at all — and `expo-image`'s own `accessible` prop
    // defaults to false, so the images were not targets either. A three-photo
    // post was functionally one photo.
    // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-image/src/Image.types.ts · expo-image 1.13.0 · 2026-08-07
    const view = photo(gallery);

    expect(view.getByTestId('photo-cell-pager').props.accessible).toBe(false);

    for (const i of [0, 1, 2]) {
      const image = view.getByTestId(`photo-cell-image-${i}`);
      expect(image.props.accessible).toBe(true);
      expect(image.props.accessibilityRole).toBe('image');
      expect(image.props.accessibilityLabel).toBe(`Photo ${i + 1} of 3`);
    }
  });

  it('announces which image of how many, and follows the swipe', () => {
    const view = photo(gallery);
    const dots = (): Record<string, unknown> => view.getByTestId('photo-cell-dots').props;

    // A label that never re-announces is a label read once and then wrong, so
    // the count lives in a live region rather than on a static container.
    expect(dots().accessibilityLiveRegion).toBe('polite');
    expect(dots().accessible).toBe(true);
    expect(dots().accessibilityLabel).toBe('Photo 1 of 3');

    scrollTo(view, 2);

    expect(dots().accessibilityLabel).toBe('Photo 3 of 3');
  });

  it('moves the active dot with the swipe', () => {
    const view = photo(gallery);
    const activeWidth = (dot: string): number =>
      Number(view.getByTestId(dot).props.style.width);

    expect(activeWidth('photo-cell-dot-0')).toBeGreaterThan(activeWidth('photo-cell-dot-1'));

    scrollTo(view, 1);

    expect(activeWidth('photo-cell-dot-1')).toBeGreaterThan(activeWidth('photo-cell-dot-0'));
  });
});

describe('PhotoCell async states', () => {
  it('says the photo is unavailable rather than paging to a black screen', () => {
    const view = photo(makePost({ media_urls: [] }));

    expect(view.queryByTestId('photo-cell-unavailable')).not.toBeNull();
    // The chrome still stands: an unavailable image is not an unavailable post.
    expect(view.queryByTestId('feed-rail')).not.toBeNull();
  });

  it('holds a loading state until the image reports back', () => {
    const view = photo();

    expect(view.queryByTestId('photo-cell-loading')).not.toBeNull();

    fireEvent(view.getByTestId('photo-cell-image-0'), 'load');

    expect(view.queryByTestId('photo-cell-loading')).toBeNull();
  });

  it('surfaces a failed image instead of leaving the viewer on an empty frame', () => {
    const view = photo();

    fireEvent(view.getByTestId('photo-cell-image-0'), 'error');

    expect(view.queryByTestId('photo-cell-error')).not.toBeNull();
    expect(view.queryByTestId('photo-cell-loading')).toBeNull();
  });

  it('speaks the failure rather than only drawing it', () => {
    const view = photo();

    fireEvent(view.getByTestId('photo-cell-image-0'), 'error');

    expect(view.getByTestId('photo-cell-error').props.accessibilityLiveRegion).toBe('assertive');
  });

  it('keeps one slide failing from blanking the rest of the gallery', () => {
    const view = photo(makePost({ post_type: 'gallery', media_urls: ['a.jpg', 'b.jpg'] }));

    fireEvent(view.getByTestId('photo-cell-image-0'), 'error');

    expect(view.queryByTestId('photo-cell-error')).not.toBeNull();
    expect(view.queryByTestId('photo-cell-image-1')).not.toBeNull();
  });
});
