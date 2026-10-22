import React from 'react';
import { AccessibilityInfo, Share, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { FeedCellChrome } from '../../components/feed/FeedCellChrome';
import {
  CAPTION_COLLAPSED_LINES, CAPTION_EXPANDED_CAP, CAPTION_EXPANDED_LINES,
  FAB_LANE, MEDIA_SCRIM_FADE, MEDIA_SCRIM_MIN_BODY, RAIL_END, RAIL_OUTLINE,
} from '../../components/feed/feedChromeTokens';
import { PICKER } from '../../components/reactions/reactionGeometry';
import { identityFor } from '../../lib/theme';
import type { ReelRow } from '../../lib/reels';

/*
 * v2 (Wave 2 feed): the rail is five plate-less glyphs (reaction, comment,
 * save, share, more) starting above the Roxy AI lane; the author's avatar,
 * name, age, follow and the community (with a still crest) moved to the
 * bottom start; the heart-like became the reaction button. Assertions that
 * pinned v0's rail (avatar/like slots, rotating crest, RAIL_BACKING plates)
 * were rewritten to the v2 contract; every behaviour they protected (safety
 * action, labels, share privacy, caption bounds, scrim, announcements) is
 * still asserted below.
 */

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `roxy:/${path}` }));
jest.mock('../../lib/haptics', () => ({ haptic: jest.fn(), tapLight: jest.fn() }));

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
  created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
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
      reaction={null}
      reactionTotal={12}
      saved={false}
      reducedMotion={false}
      onReact={noop}
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
 * view, and counting it twice would make the order unreadable. Ids with a
 * suffix (`rail-react-count`) are parts of a control, not controls.
 */
function railOrder(view: ReturnType<typeof chrome>): string[] {
  const rail = view.getByTestId('feed-rail') as unknown as Node;
  return rail
    .findAll((n) => typeof n.type === 'string'
      && typeof n.props.testID === 'string'
      && /^rail-[a-z]+$/.test(n.props.testID))
    .map((n) => String(n.props.testID));
}

describe('FeedCellChrome right rail (v2: five glyphs, no plates)', () => {
  it('draws reaction, comment, save, share and the way out, top to bottom', () => {
    const view = chrome();

    expect(railOrder(view)).toEqual([
      'rail-react', 'rail-comment', 'rail-save', 'rail-share', 'rail-more',
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

  it('announces every icon-only control, and says what kind of post it acts on', () => {
    const view = chrome({ post: makePost({ post_type: 'poll' }) });

    expect(view.getByTestId('rail-react').props.accessibilityLabel)
      .toBe('React to poll, 12 reactions');
    expect(view.getByTestId('rail-comment').props.accessibilityLabel)
      .toBe('Comment, 4 comments');
    expect(view.getByTestId('rail-save').props.accessibilityLabel).toBe('Save poll');
    expect(view.getByTestId('rail-share').props.accessibilityLabel).toBe('Share poll');
  });

  it('shows her reaction on the button and flips save once they are on', () => {
    const view = chrome({ reaction: '😂', saved: true });

    expect(view.getByTestId('rail-react-emoji').props.children).toBe('😂');
    expect(view.getByTestId('rail-react').props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId('rail-save').props.accessibilityLabel)
      .toBe('Remove video from saved');
    expect(view.getByTestId('rail-save').props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId('rail-save-label').props.children).toBe('Saved');
  });

  it('writes counts the way her language does, and labels save and share in words', () => {
    const view = chrome({ reactionTotal: 1205, post: makePost({ comment_count: 48 }) });

    expect(view.getByTestId('rail-react-count').props.children).toBe('1,205');
    expect(view.getByTestId('rail-comment-count').props.children).toBe('48');
    expect(view.getByTestId('rail-save-label').props.children).toBe('Save');
    expect(view.getByTestId('rail-share-label').props.children).toBe('Share');
  });

  it('routes each rail tap to its handler; a tap on the reaction button gives a heart', () => {
    const onReact = jest.fn();
    const onSave = jest.fn();
    const onOpenComments = jest.fn();
    const view = chrome({ onReact, onSave, onOpenComments });

    fireEvent(view.getByTestId('rail-react'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    fireEvent.press(view.getByTestId('rail-save'));
    fireEvent.press(view.getByTestId('rail-comment'));

    expect(onReact).toHaveBeenCalledWith('❤️');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onOpenComments).toHaveBeenCalledTimes(1);
  });

  it('opens the six-emoji picker over the post on a long press', () => {
    jest.useFakeTimers();
    const onPickerOpenChange = jest.fn();
    const view = chrome({ onPickerOpenChange });
    const button = view.getByTestId('rail-react');

    fireEvent(button, 'responderGrant', { nativeEvent: { pageX: 0, pageY: 0, locationX: 24, locationY: 24 } });
    act(() => { jest.advanceTimersByTime(PICKER.longPressMs); });

    expect(view.queryByTestId('reaction-picker')).not.toBeNull();
    expect(onPickerOpenChange).toHaveBeenCalledWith(true);
    jest.useRealTimers();
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
    // Never the author's name or the community's: a share preview can out someone.
    const payload = spy.mock.calls[0][0] as { message: string };
    expect(payload.message).not.toContain('Mara');
    expect(payload.message).not.toContain('The Sapphic Club');
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

describe('FeedCellChrome and the Roxy AI lane', () => {
  it('starts the rail above the 88 dp lane, on the button\'s centre line', () => {
    // Direction › The Roxy AI button: the rail's lowest control starts at the
    // lane's top; at rest nothing readable or tappable sits in the lane.
    const view = chrome();
    const column = StyleSheet.flatten(view.getByTestId('feed-rail-column').props.style);

    expect(column.bottom).toBe(FAB_LANE);
    expect(column.right).toBe(RAIL_END);
  });

  it('keeps captions an end margin of 88 clear of the lane', () => {
    const view = chrome();
    const identity = StyleSheet.flatten(view.getByTestId('feed-cell-identity').props.style);

    expect(identity.paddingRight).toBe(FAB_LANE);
  });
});

describe('FeedCellChrome author and community (bottom start)', () => {
  it('names the author with the post\'s age, and opens her profile from the avatar or the name', () => {
    const onOpenAuthor = jest.fn();
    const view = chrome({ onOpenAuthor });

    expect(view.getByTestId('feed-cell-handle').props.children).toBe('Mara');
    expect(view.getByTestId('feed-cell-age').props.children).toBe('· 2 h');
    expect(view.getByTestId('feed-cell-avatar').props.accessibilityLabel).toBe("Open Mara's profile");
    fireEvent.press(view.getByTestId('feed-cell-avatar'));
    fireEvent.press(view.getByTestId('feed-cell-handle-hit'));
    expect(onOpenAuthor).toHaveBeenCalledTimes(2);
  });

  it('offers follow beside her name when a follow graph is wired, and only then', () => {
    const onFollowAuthor = jest.fn();
    const view = chrome({ onFollowAuthor, following: false });

    const follow = view.getByTestId('feed-cell-follow');
    expect(follow.props.accessibilityLabel).toBe('Follow Mara');
    fireEvent.press(follow);
    expect(onFollowAuthor).toHaveBeenCalledTimes(1);

    expect(chrome().queryByTestId('feed-cell-follow')).toBeNull();
    expect(chrome({ onFollowAuthor, following: true }).getByTestId('feed-cell-follow').props.accessibilityLabel)
      .toBe('Unfollow Mara');
  });

  it('draws the community\'s crest beside "in <community>", in its identity colour, still', () => {
    const view = chrome();

    const crest = StyleSheet.flatten(view.getByTestId('feed-cell-crest').props.style);
    expect(crest.backgroundColor).toBe(identityFor('c1'));
    expect(view.getByTestId('feed-cell-community').props.children).toBe('in The Sapphic Club');
  });

  it('opens the community the post was made in', () => {
    const onOpenCommunity = jest.fn();
    const view = chrome({ onOpenCommunity });

    fireEvent.press(view.getByTestId('feed-cell-community-hit'));

    expect(onOpenCommunity).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('feed-cell-community-hit').props.accessibilityLabel)
      .toBe('Open The Sapphic Club');
  });

  it('draws no community line on a post that belongs to no community', () => {
    // Since migration 118 every post lives on its author's wall: a fallback
    // "Roxy" crest opened the author (the avatar's job) and sat under the FAB.
    const view = chrome({ post: makePost({ communities: null }) });

    expect(view.queryByTestId('feed-cell-crest')).toBeNull();
    expect(view.queryByTestId('feed-cell-community')).toBeNull();
    expect(view.queryByLabelText('Open Roxy')).toBeNull();
  });

  it('keeps the community out of the rail and the lane', () => {
    const view = chrome();
    const column = view.getByTestId('feed-rail-column');

    expect(within(column).queryByTestId('feed-cell-crest')).toBeNull();
    expect(within(view.getByTestId('feed-cell-identity')).queryByTestId('feed-cell-crest')).not.toBeNull();
  });
});

describe('FeedCellChrome caption', () => {
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
    // 600-character caption is ~15 lines ≈ 300dp, and Connect's page is ~320dp.
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
    expect(view.getByTestId('feed-cell-avatar').props.accessibilityLabel)
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
    // text itself is placed in fixed dp.
    const scrim = StyleSheet.flatten(view.getByTestId('feed-cell-scrim').props.style);
    expect(scrim.bottom).toBe(0);
    expect(scrim.top).toBeUndefined();
    expect(scrim.height).toBeUndefined();

    const fade = StyleSheet.flatten(view.getByTestId('feed-cell-scrim-fade').props.style);
    expect(fade.height).toBe(MEDIA_SCRIM_FADE);
  });

  it('sizes the dark band by the chrome it backs, so a long caption grows it', () => {
    const view = chrome();

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

  it('draws no plate behind any rail control (v2), and outlines every count instead', () => {
    // Direction v2: the post is the screen; the rail is white glyphs with a
    // drawn 1 dp dark outline. The outline is scored in feedChromeContrast.test.
    const view = chrome({ reactionTotal: 7 });

    for (const id of ['rail-react', 'rail-comment', 'rail-save', 'rail-share', 'rail-more']) {
      expect(StyleSheet.flatten(view.getByTestId(id).props.style).backgroundColor).toBeUndefined();
    }
    const outlineCopies = view.getAllByText('7', { includeHiddenElements: true })
      .filter((n) => StyleSheet.flatten(n.props.style).color === RAIL_OUTLINE.color);
    expect(outlineCopies).toHaveLength(4);
  });

  it('keeps the caption shadow as well, as help rather than as proof', () => {
    const view = chrome();

    const caption = view.getByTestId('feed-cell-caption');
    const flat = ([] as unknown[]).concat(caption.props.style).filter(Boolean);
    expect(flat.some((s) => (s as { textShadowRadius?: number }).textShadowRadius === 6))
      .toBe(true);
  });
});
