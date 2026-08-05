import React from 'react';
import { Share, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { FeedCellChrome } from '../../components/feed/FeedCellChrome';
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
  content: 'sunday market with the girls',
  media_urls: [],
  post_type: 'video',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 4,
  like_count: 12,
  save_count: 0,
  feed_score: 10,
  blurhash: null,
  deleted_at: null,
  posted_as_community: false,
  post_tags: [],
  video_url: 'https://cdn.example.test/a.m3u8',
  video_thumbnail_url: null,
  video_duration_secs: 12,
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

type ChromeProps = React.ComponentProps<typeof FeedCellChrome>;

function chrome(overrides: Partial<ChromeProps> = {}) {
  return render(
    <FeedCellChrome
      post={BASE}
      liked={false}
      saved={false}
      likeCount={12}
      reducedMotion={false}
      onLike={noop}
      onSave={noop}
      onOpenComments={noop}
      onOpenAuthor={noop}
      onOpenCommunity={noop}
      {...overrides}
    />,
  );
}

/**
 * The shape of a rendered node this file needs. `react-test-renderer` ships no
 * types and is not a declared dependency, so the instance is described here
 * rather than imported.
 */
interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}

/**
 * The rail's controls in the order they are drawn. Host nodes only — a
 * `TouchableOpacity` carries the same testID on both its composite and its host
 * view, and counting it twice would make the order unreadable.
 */
function railOrder(view: ReturnType<typeof chrome>): string[] {
  const rail = view.getByTestId('feed-rail') as unknown as Node;
  return rail
    .findAll((n) => typeof n.type === 'string'
      && typeof n.props.testID === 'string'
      && n.props.testID.startsWith('rail-'))
    .map((n) => String(n.props.testID));
}

describe('FeedCellChrome right rail', () => {
  it('draws the rail in TikTok order: author, like, comment, save, share', () => {
    const view = chrome();

    expect(railOrder(view)).toEqual([
      'rail-avatar', 'rail-like', 'rail-comment', 'rail-save', 'rail-share',
    ]);
  });

  it('hangs the follow affordance off the avatar when a follow graph is wired', () => {
    const onFollowAuthor = jest.fn();
    const view = chrome({ onFollowAuthor, following: false });

    expect(railOrder(view)).toEqual([
      'rail-avatar', 'rail-follow', 'rail-like', 'rail-comment', 'rail-save', 'rail-share',
    ]);
    fireEvent.press(view.getByTestId('rail-follow'));
    expect(onFollowAuthor).toHaveBeenCalledTimes(1);
  });

  it('hides the follow affordance rather than offering an action nothing handles', () => {
    const view = chrome();

    expect(view.queryByTestId('rail-follow')).toBeNull();
  });

  it('announces every icon-only control, and says what kind of post it acts on', () => {
    const view = chrome({ post: makePost({ post_type: 'poll' }) });

    expect(view.getByTestId('rail-avatar').props.accessibilityLabel)
      .toBe("Open Mara's profile");
    expect(view.getByTestId('rail-like').props.accessibilityLabel)
      .toBe('Like poll, 12 likes');
    expect(view.getByTestId('rail-comment').props.accessibilityLabel)
      .toBe('View comments, 4 comments');
    expect(view.getByTestId('rail-save').props.accessibilityLabel).toBe('Save poll');
    expect(view.getByTestId('rail-share').props.accessibilityLabel).toBe('Share poll');
  });

  it('flips the like and save labels and their selected state once they are on', () => {
    const view = chrome({ liked: true, saved: true });

    expect(view.getByTestId('rail-like').props.accessibilityLabel)
      .toBe('Unlike video, 12 likes');
    expect(view.getByTestId('rail-like').props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId('rail-save').props.accessibilityLabel)
      .toBe('Remove video from saved');
    expect(view.getByTestId('rail-save').props.accessibilityState.selected).toBe(true);
  });

  it('routes each rail tap to its handler', () => {
    const onLike = jest.fn();
    const onSave = jest.fn();
    const onOpenComments = jest.fn();
    const onOpenAuthor = jest.fn();
    const view = chrome({ onLike, onSave, onOpenComments, onOpenAuthor });

    fireEvent.press(view.getByTestId('rail-like'));
    fireEvent.press(view.getByTestId('rail-save'));
    fireEvent.press(view.getByTestId('rail-comment'));
    fireEvent.press(view.getByTestId('rail-avatar'));

    expect(onLike).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onOpenComments).toHaveBeenCalledTimes(1);
    expect(onOpenAuthor).toHaveBeenCalledTimes(1);
  });

  it('shares a deep link to this post, not a bare sentence', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'dismissedAction' });
    const view = chrome({ post: makePost({ post_type: 'photo' }) });

    fireEvent.press(view.getByTestId('rail-share'));
    await Promise.resolve();

    // Android's share sheet reads `message` only and iOS prefers `url`, so the
    // link has to be in both fields or half the platforms share nothing.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      url: 'roxy://community/post/p1',
      message: expect.stringContaining('roxy://community/post/p1'),
    }));
    spy.mockRestore();
  });

  it('renders no play control of its own — that belongs to the video cell', () => {
    const view = chrome();

    expect(view.queryByTestId('rail-play')).toBeNull();
  });

  it('carries a caller-supplied playback control outside the shared rail', () => {
    const view = chrome({ playbackControl: <Text testID="video-transport">transport</Text> });

    expect(view.queryByTestId('video-transport')).not.toBeNull();
    expect(railOrder(view)).not.toContain('video-transport');
  });
});

describe('FeedCellChrome community crest', () => {
  it('gives the community the sound-disc slot', () => {
    const view = chrome();

    expect(view.getByTestId('community-crest').props.accessibilityLabel)
      .toBe('Open The Sapphic Club');
  });

  it('opens the community the post was made in', () => {
    const onOpenCommunity = jest.fn();
    const view = chrome({ onOpenCommunity });

    fireEvent.press(view.getByTestId('community-crest'));

    expect(onOpenCommunity).toHaveBeenCalledTimes(1);
  });

  it('passes reduced motion down so the crest stops spinning', () => {
    const view = chrome({ active: true, reducedMotion: true });

    expect(view.queryByTestId('community-crest-static')).not.toBeNull();
    expect(view.queryByTestId('community-crest-spinning')).toBeNull();
  });

  it('only turns the crest on the cell the viewer is actually on', () => {
    const inactive = chrome();
    expect(inactive.queryByTestId('community-crest-spinning')).toBeNull();

    const view = chrome({ active: true });
    expect(view.queryByTestId('community-crest-spinning')).not.toBeNull();
    view.unmount();
  });
});

describe('FeedCellChrome identity block', () => {
  it('caps the caption at two lines, leaving room for the community line', () => {
    const view = chrome();

    expect(view.getByTestId('feed-cell-caption').props.numberOfLines).toBe(2);
  });

  it('offers a more affordance only when the caption is long enough to be cut', () => {
    expect(chrome({ post: makePost({ content: 'short one' }) })
      .queryByTestId('feed-cell-more')).toBeNull();
    expect(chrome({ post: makePost({ content: 'x'.repeat(200) }) })
      .queryByTestId('feed-cell-more')).not.toBeNull();
  });

  it('uncaps the caption once the viewer asks for more', () => {
    const view = chrome({ post: makePost({ content: 'x'.repeat(200) }) });

    fireEvent.press(view.getByTestId('feed-cell-more'));

    expect(view.getByTestId('feed-cell-caption').props.numberOfLines).toBeUndefined();
  });

  it('names the community under the caption', () => {
    const view = chrome();

    expect(view.getByTestId('feed-cell-community').props.children)
      .toContain('The Sapphic Club');
  });

  it('renders an @handle only when there is a real one, never one invented from a name', () => {
    expect(chrome({ handle: 'mara' }).getByTestId('feed-cell-handle').props.children)
      .toBe('@mara');
    expect(chrome().getByTestId('feed-cell-handle').props.children).toBe('Mara');
  });

  it('drops the caption line entirely when the body already is the words', () => {
    const view = chrome({ showCaption: false });

    expect(view.queryByTestId('feed-cell-caption')).toBeNull();
    expect(view.queryByTestId('feed-cell-handle')).not.toBeNull();
  });

  it('survives a post whose author or community failed to join', () => {
    const view = chrome({
      post: makePost({ profiles: undefined, communities: null, content: '' }),
    });

    expect(view.queryByTestId('feed-cell-caption')).toBeNull();
    expect(view.getByTestId('rail-avatar').props.accessibilityLabel)
      .toBe("Open the author's profile");
  });
});

describe('FeedCellChrome legibility', () => {
  it('lays a scrim under the chrome, because white on an unknown photo is a coin flip', () => {
    const view = chrome();

    // Bottom-anchored and opaque enough at the bottom that white text clears
    // 4.5:1 even against a pure-white frame: #fff under rgba(0,0,0,0.85)
    // composites to (38,38,38), which is 15.9:1.
    const scrim = view.getByTestId('feed-cell-scrim');
    expect(scrim.props.colors[0]).toBe('transparent');
    expect(scrim.props.colors[scrim.props.colors.length - 1]).toBe('rgba(0,0,0,0.85)');
    expect(scrim.props.pointerEvents).toBe('none');
  });

  it('shadows every white glyph so the rail reads above the scrim too', () => {
    const view = chrome();

    const caption = view.getByTestId('feed-cell-caption');
    const flat = ([] as unknown[]).concat(caption.props.style).filter(Boolean);
    expect(flat.some((s) => (s as { textShadowRadius?: number }).textShadowRadius === 6))
      .toBe(true);
  });
});
