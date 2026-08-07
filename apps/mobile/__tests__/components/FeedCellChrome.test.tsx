import React from 'react';
import { AccessibilityInfo, Share, StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { FeedCellChrome } from '../../components/feed/FeedCellChrome';
import {
  CAPTION_COLLAPSED_LINES, CAPTION_EXPANDED_CAP, CAPTION_EXPANDED_LINES,
  MEDIA_SCRIM_FADE, MEDIA_SCRIM_MIN_BODY, RAIL_BACKING,
} from '../../components/feed/feedChromeTokens';
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
      onOpenSafety={noop}
      onOpenPost={noop}
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
  it('draws the rail in TikTok order, with the way out last', () => {
    const view = chrome();

    expect(railOrder(view)).toEqual([
      'rail-avatar', 'rail-like', 'rail-comment', 'rail-save', 'rail-share', 'rail-more',
    ]);
  });

  it('always offers a negative action, whatever else is wired', () => {
    // The rail shipped with five positive actions and no way to report, block
    // or hide. `onOpenSafety` is required rather than optional so a new surface
    // cannot be built without one.
    const onOpenSafety = jest.fn();
    const view = chrome({ onOpenSafety });

    const more = view.getByTestId('rail-more');
    expect(more.props.accessibilityLabel).toBe('Report, block or hide this video');
    expect(more.props.accessibilityRole).toBe('button');
    fireEvent.press(more);
    expect(onOpenSafety).toHaveBeenCalledTimes(1);
  });

  it('hangs the follow affordance off the avatar when a follow graph is wired', () => {
    const onFollowAuthor = jest.fn();
    const view = chrome({ onFollowAuthor, following: false });

    expect(railOrder(view)).toEqual([
      'rail-avatar', 'rail-follow', 'rail-like', 'rail-comment', 'rail-save',
      'rail-share', 'rail-more',
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

  it('bounds the expanded caption instead of letting it outgrow the page', () => {
    // `numberOfLines={undefined}` over uncapped `post.content` is unbounded. A
    // 600-character caption is ~15 lines ≈ 300dp, and Connect's page is ~320dp:
    // the band covered the whole frame, the text ran off the top, and the only
    // escape was to swipe away and come back.
    const view = chrome({ post: makePost({ content: 'x'.repeat(200) }) });

    fireEvent.press(view.getByTestId('feed-cell-more'));

    expect(view.getByTestId('feed-cell-caption').props.numberOfLines)
      .toBe(CAPTION_EXPANDED_LINES);
  });

  it('gives the viewer a way back once she has expanded it', () => {
    const view = chrome({ post: makePost({ content: 'x'.repeat(200) }) });

    fireEvent.press(view.getByTestId('feed-cell-more'));
    expect(view.queryByTestId('feed-cell-more')).toBeNull();

    const less = view.getByTestId('feed-cell-less');
    expect(less.props.accessibilityRole).toBe('button');
    fireEvent.press(less);

    expect(view.getByTestId('feed-cell-caption').props.numberOfLines)
      .toBe(CAPTION_COLLAPSED_LINES);
    expect(view.queryByTestId('feed-cell-less')).toBeNull();
    expect(view.queryByTestId('feed-cell-more')).not.toBeNull();
  });

  it('hands a caption too long for the band to the detail surface, never expanding it', () => {
    // The alternative to a silent truncation. `TextCell` already makes this
    // trade at `READ_MORE_CAP`; the chrome makes the same one so the rest of
    // the words are always reachable rather than clipped without a word.
    const onOpenPost = jest.fn();
    const view = chrome({
      post: makePost({ content: 'x'.repeat(CAPTION_EXPANDED_CAP + 1) }),
      onOpenPost,
    });

    expect(view.queryByTestId('feed-cell-more')).toBeNull();
    fireEvent.press(view.getByTestId('feed-cell-read-more'));

    expect(onOpenPost).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('feed-cell-caption').props.numberOfLines)
      .toBe(CAPTION_COLLAPSED_LINES);
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

describe('FeedCellChrome active announcement', () => {
  /**
   * The pager only advances on a real scroll, and once an off-screen cell is
   * out of the accessibility tree the node a TalkBack user was on disappears
   * from under her when she swipes. Something has to say what she landed on.
   */
  it('says what the viewer landed on when a cell becomes the active one', () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);

    chrome({ active: true, post: makePost({ post_type: 'poll' }) });

    expect(spy).toHaveBeenCalledWith('poll by Mara in The Sapphic Club');
    spy.mockRestore();
  });

  it('announces nothing for a cell the viewer is not on', () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);

    chrome({ active: false });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('survives a post whose author and community failed to join', () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);

    chrome({ active: true, post: makePost({ profiles: undefined, communities: null }) });

    expect(spy).toHaveBeenCalledWith('video by a member');
    spy.mockRestore();
  });
});

describe('FeedCellChrome legibility', () => {
  it('anchors the scrim in dp from the bottom, never as a share of the page', () => {
    const view = chrome();

    // The defect: `locations={[0.35, 0.62, 1]}` on an absoluteFill gradient
    // means the alpha under the text is a function of page height, while the
    // text itself is placed in fixed dp. Over a white photo that put the handle
    // at 1.86:1 on Connect's 320dp page and 4.63:1 at 620dp.
    const scrim = StyleSheet.flatten(view.getByTestId('feed-cell-scrim').props.style);
    expect(scrim.bottom).toBe(0);
    expect(scrim.top).toBeUndefined();
    expect(scrim.height).toBeUndefined();

    const fade = StyleSheet.flatten(view.getByTestId('feed-cell-scrim-fade').props.style);
    expect(fade.height).toBe(MEDIA_SCRIM_FADE);
  });

  it('sizes the dark band by the chrome it backs, so a long caption grows it', () => {
    const view = chrome();

    // The identity block is the band's CONTENT. That is what makes the
    // guarantee hold for an expanded caption as well as a two-line one: the
    // backing cannot be outgrown by the thing it backs.
    const body = view.getByTestId('feed-cell-scrim-body') as unknown as Node;
    const inside = body.findAll((n) => n.props.testID === 'feed-cell-identity');
    expect(inside.length).toBeGreaterThan(0);

    const style = StyleSheet.flatten(view.getByTestId('feed-cell-scrim-body').props.style);
    expect(style.minHeight).toBe(MEDIA_SCRIM_MIN_BODY);
    expect(style.height).toBeUndefined();
  });

  it('renders the interest prompt inside the band, so its own backing grows too', () => {
    const view = chrome({ interestPrompt: <Text testID="prompt">is this for you?</Text> });

    const body = view.getByTestId('feed-cell-scrim-body') as unknown as Node;
    expect(body.findAll((n) => n.props.testID === 'prompt').length).toBeGreaterThan(0);
  });

  it('backs every rail control rather than trusting a shadow', () => {
    const view = chrome();

    // WCAG defines no method for scoring a text shadow, so `CHROME_SHADOW` is
    // never the defence. The rail sits ~358dp above the bottom — far outside
    // any scrim that would not veil the whole frame — so each control carries
    // its own plate. The ratios are checked in feedChromeContrast.test.ts.
    for (const id of ['rail-like', 'rail-comment', 'rail-save', 'rail-share', 'rail-more']) {
      expect(StyleSheet.flatten(view.getByTestId(id).props.style).backgroundColor)
        .toBe(RAIL_BACKING);
    }
    expect(StyleSheet.flatten(view.getByTestId('rail-avatar').props.style).backgroundColor)
      .toBe(RAIL_BACKING);
  });

  it('keeps the shadow as well, as help rather than as proof', () => {
    const view = chrome();

    const caption = view.getByTestId('feed-cell-caption');
    const flat = ([] as unknown[]).concat(caption.props.style).filter(Boolean);
    expect(flat.some((s) => (s as { textShadowRadius?: number }).textShadowRadius === 6))
      .toBe(true);
  });
});
