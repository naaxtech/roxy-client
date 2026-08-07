import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ResourceCell } from '../../components/feed/ResourceCell';
import type { ReelRow } from '../../lib/reels';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `roxy:/${path}` }));

/**
 * The shared `__mocks__/@react-native-firebase/crashlytics.js` predates
 * `setAttribute`, which `logError` calls on every log. Without this the logger
 * throws from inside the failure handler and the error state never renders —
 * so the test would be asserting the mock's gap, not the component.
 */
jest.mock('@react-native-firebase/crashlytics', () => {
  const client = {
    recordError: jest.fn(),
    log: jest.fn(),
    setAttribute: jest.fn(),
    setUserId: jest.fn(),
    setCrashlyticsCollectionEnabled: jest.fn(),
  };
  const crashlytics = (): typeof client => client;
  crashlytics.default = crashlytics;
  return crashlytics;
});

const BASE: ReelRow = {
  id: 'p1',
  author_id: 'u1',
  community_id: 'c1',
  content: 'UK bi+ resources\nStonewall bi+ hub and the 2024 wellbeing report: https://stonewall.org.uk/bi-hub',
  media_urls: [],
  post_type: 'resource',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 0,
  like_count: 3,
  save_count: 0,
  feed_score: 10,
  blurhash: null,
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

function resource(post: ReelRow = BASE, onOpenPost: () => void = noop) {
  return render(
    <ResourceCell
      post={post}
      width={400}
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
      onOpenPost={onOpenPost}
    />,
  );
}

describe('ResourceCell preview', () => {
  it('leads with the first line as a title rather than a wall of body text', () => {
    const view = resource();

    expect(view.getByTestId('resource-title').props.children).toBe('UK bi+ resources');
  });

  it('shows the destination host, so a viewer knows where a tap sends her', () => {
    const view = resource();

    expect(view.getByTestId('resource-meta').props.children).toBe('stonewall.org.uk');
  });

  it('carries the same chrome as every other cell, and never a play control', () => {
    const view = resource();

    expect(view.queryByTestId('feed-rail')).not.toBeNull();
    expect(view.queryByTestId('community-crest')).not.toBeNull();
    expect(view.queryByTestId('rail-play')).toBeNull();
  });

  it('labels its open action for a screen reader', () => {
    const view = resource();

    expect(view.getByTestId('resource-open').props.accessibilityLabel)
      .toBe('Open link at stonewall.org.uk');
    expect(view.getByTestId('resource-open').props.accessibilityRole).toBe('button');
  });
});

describe('ResourceCell open action', () => {
  it('opens the linked resource', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const view = resource();

    fireEvent.press(view.getByTestId('resource-open'));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('https://stonewall.org.uk/bi-hub'));
    spy.mockRestore();
  });

  it('says the link could not be opened instead of failing silently', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    const view = resource();

    fireEvent.press(view.getByTestId('resource-open'));

    await waitFor(() => expect(view.queryByTestId('resource-error')).not.toBeNull());
    spy.mockRestore();
  });

  it('speaks the failure rather than only drawing it', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    const view = resource();

    fireEvent.press(view.getByTestId('resource-open'));
    await waitFor(() => expect(view.queryByTestId('resource-error')).not.toBeNull());

    expect(view.getByTestId('resource-error').props.accessibilityLiveRegion).toBe('assertive');
    spy.mockRestore();
  });

  it('clears the error when the viewer tries again and it works', async () => {
    const spy = jest.spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('no handler'))
      .mockResolvedValueOnce(true);
    const view = resource();

    fireEvent.press(view.getByTestId('resource-open'));
    await waitFor(() => expect(view.queryByTestId('resource-error')).not.toBeNull());

    fireEvent.press(view.getByTestId('resource-open'));
    await waitFor(() => expect(view.queryByTestId('resource-error')).toBeNull());
    spy.mockRestore();
  });

  it('shows a loading state while the handoff is in flight', async () => {
    let settle: (ok: boolean) => void = () => undefined;
    const spy = jest.spyOn(Linking, 'openURL')
      .mockImplementation(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const view = resource();

    fireEvent.press(view.getByTestId('resource-open'));

    expect(view.getByTestId('resource-open').props.accessibilityState.busy).toBe(true);

    await waitFor(() => expect(settle).toBeDefined());
    settle(true);
    await waitFor(() =>
      expect(view.getByTestId('resource-open').props.accessibilityState.busy).toBe(false));
    spy.mockRestore();
  });
});

describe('ResourceCell roxy links', () => {
  it('takes its call to action from the kind of thing it links to', () => {
    const game = resource(makePost({
      post_type: 'roxy_link', link_type: 'game', link_entity_id: 'g1',
      content: 'Two Truths\nPlay with three others',
    }));
    expect(game.getByTestId('resource-open').props.accessibilityLabel).toBe('Join Game');

    const room = resource(makePost({
      post_type: 'roxy_link', link_type: 'room', link_entity_id: 'r1', content: 'Sunday room',
    }));
    expect(room.getByTestId('resource-open').props.accessibilityLabel).toBe('Join Room');

    const event = resource(makePost({
      post_type: 'roxy_link', link_type: 'event', link_entity_id: 'e1', content: 'Market day',
    }));
    expect(event.getByTestId('resource-open').props.accessibilityLabel).toBe('View Event');
  });

  it('routes a roxy link through the app rather than out to the browser', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const onOpenPost = jest.fn();
    const view = resource(
      makePost({ post_type: 'roxy_link', link_type: 'game', link_entity_id: 'g1' }),
      onOpenPost,
    );

    fireEvent.press(view.getByTestId('resource-open'));

    expect(onOpenPost).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('falls back to opening the post when a resource carries no link at all', () => {
    const onOpenPost = jest.fn();
    const view = resource(makePost({ content: 'A reading list, no links.' }), onOpenPost);

    expect(view.getByTestId('resource-open').props.accessibilityLabel).toBe('Open post');
    fireEvent.press(view.getByTestId('resource-open'));

    expect(onOpenPost).toHaveBeenCalledTimes(1);
  });
});
