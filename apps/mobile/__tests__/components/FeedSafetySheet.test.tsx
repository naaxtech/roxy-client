/**
 * The way out of the feed.
 *
 * Before this the rail had five positive actions and no negative one, neither
 * detail route contained the word "report" or "block", and migration 008's
 * `reports` table and 085's `block_user` RPC were written by no feed surface at
 * all. Safety is this product's stated promise — and vetting the door makes
 * reporting MORE load-bearing, not less, because a vetted community's harm comes
 * from members.
 *
 * src: https://support.google.com/googleplay/android-developer/answer/9876937 · read 2026-08-05
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FeedSafetySheet } from '../../components/feed/FeedSafetySheet';
import type { ReelRow } from '../../lib/reels';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const POST: ReelRow = {
  id: 'p1',
  author_id: 'u1',
  community_id: 'c1',
  content: 'a post',
  media_urls: [],
  post_type: 'video',
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

const noop = (): void => undefined;

interface Options {
  post?: ReelRow | null;
  onClose?: () => void;
  onReport?: (reason: string, detail: string) => Promise<void>;
  onBlock?: () => Promise<void>;
  onHide?: () => void;
}

function sheet(o: Options = {}) {
  return render(
    <FeedSafetySheet
      post={o.post === undefined ? POST : o.post}
      onClose={o.onClose ?? noop}
      onReport={o.onReport ?? ((): Promise<void> => Promise.resolve())}
      onBlock={o.onBlock ?? ((): Promise<void> => Promise.resolve())}
      onHide={o.onHide ?? noop}
    />,
  );
}

describe('FeedSafetySheet menu', () => {
  it('renders nothing at all until a post is handed to it', () => {
    expect(sheet({ post: null }).queryByTestId('safety-sheet')).toBeNull();
  });

  it('offers exactly the three ways out, each named and reachable', () => {
    const view = sheet();

    expect(view.getByTestId('safety-report').props.accessibilityLabel)
      .toBe('Report this post');
    expect(view.getByTestId('safety-block').props.accessibilityLabel)
      .toBe('Block Mara');
    expect(view.getByTestId('safety-hide').props.accessibilityLabel)
      .toBe('Hide this post from The Sapphic Club');
    for (const id of ['safety-report', 'safety-block', 'safety-hide']) {
      expect(view.getByTestId(id).props.accessibilityRole).toBe('button');
    }
  });

  it('can be dismissed without taking any action', () => {
    const onClose = jest.fn();
    const view = sheet({ onClose });

    expect(view.getByTestId('safety-close').props.accessibilityLabel)
      .toBe('Close safety options');
    fireEvent.press(view.getByTestId('safety-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names the author honestly when the profile never joined', () => {
    const view = sheet({ post: { ...POST, profiles: undefined, communities: null } });

    expect(view.getByTestId('safety-block').props.accessibilityLabel)
      .toBe('Block this author');
    expect(view.getByTestId('safety-hide').props.accessibilityLabel)
      .toBe('Hide this post from this community');
  });
});

describe('FeedSafetySheet hide', () => {
  it('hides at once, because hiding is not an accusation', () => {
    const onHide = jest.fn();
    const onClose = jest.fn();
    const view = sheet({ onHide, onClose });

    fireEvent.press(view.getByTestId('safety-hide'));

    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('FeedSafetySheet report', () => {
  it('asks what happened before it sends anything', () => {
    const onReport = jest.fn(() => Promise.resolve());
    const view = sheet({ onReport });

    fireEvent.press(view.getByTestId('safety-report'));

    expect(view.getByTestId('safety-reasons')).toBeTruthy();
    expect(view.getByTestId('safety-reason-harassment')).toBeTruthy();
    expect(view.getByTestId('safety-reason-hate_speech')).toBeTruthy();
    expect(view.getByTestId('safety-reason-other')).toBeTruthy();
    // Nothing is written by opening the form.
    expect(onReport).not.toHaveBeenCalled();
  });

  it('will not submit until a reason is chosen', () => {
    const onReport = jest.fn(() => Promise.resolve());
    const view = sheet({ onReport });

    fireEvent.press(view.getByTestId('safety-report'));
    expect(view.getByTestId('safety-report-submit').props.accessibilityState.disabled)
      .toBe(true);

    fireEvent.press(view.getByTestId('safety-report-submit'));
    expect(onReport).not.toHaveBeenCalled();
  });

  it('sends the chosen reason and whatever she wrote with it', async () => {
    const onReport = jest.fn(() => Promise.resolve());
    const view = sheet({ onReport });

    fireEvent.press(view.getByTestId('safety-report'));
    fireEvent.press(view.getByTestId('safety-reason-harassment'));
    fireEvent.changeText(view.getByTestId('safety-report-detail'), '  she followed me here  ');
    fireEvent.press(view.getByTestId('safety-report-submit'));

    await waitFor(() => expect(onReport).toHaveBeenCalledTimes(1));
    expect(onReport).toHaveBeenCalledWith('harassment', 'she followed me here');
  });

  it('shows a loading state while the report is in flight and blocks a second send', async () => {
    let settle: () => void = () => undefined;
    const onReport = jest.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
    const view = sheet({ onReport });

    fireEvent.press(view.getByTestId('safety-report'));
    fireEvent.press(view.getByTestId('safety-reason-spam'));
    fireEvent.press(view.getByTestId('safety-report-submit'));

    expect(view.getByTestId('safety-report-submit').props.accessibilityState.busy).toBe(true);
    fireEvent.press(view.getByTestId('safety-report-submit'));
    expect(onReport).toHaveBeenCalledTimes(1);

    await waitFor(() => { settle(); });
    await waitFor(() => expect(view.queryByTestId('safety-done')).not.toBeNull());
  });

  it('announces the outcome, because a confirmation nobody hears is not one', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(noop);
    const view = sheet();

    fireEvent.press(view.getByTestId('safety-report'));
    fireEvent.press(view.getByTestId('safety-reason-other'));
    fireEvent.press(view.getByTestId('safety-report-submit'));

    await waitFor(() => expect(view.queryByTestId('safety-done')).not.toBeNull());
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Report sent'));
    expect(view.getByTestId('safety-done').props.accessibilityLiveRegion).toBe('polite');
    spy.mockRestore();
  });

  it('says the report did not send rather than thanking her for one that failed', async () => {
    const onReport = jest.fn(() => Promise.reject(new Error('offline')));
    const view = sheet({ onReport });

    fireEvent.press(view.getByTestId('safety-report'));
    fireEvent.press(view.getByTestId('safety-reason-harassment'));
    fireEvent.press(view.getByTestId('safety-report-submit'));

    await waitFor(() => expect(view.queryByTestId('safety-error')).not.toBeNull());
    expect(view.queryByTestId('safety-done')).toBeNull();
    // Still on the form, with her reason kept, so retrying is one tap.
    expect(view.getByTestId('safety-report-submit').props.accessibilityState.disabled)
      .toBe(false);
  });

  it('lets her retry a failed report', async () => {
    const onReport = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const view = sheet({ onReport });

    fireEvent.press(view.getByTestId('safety-report'));
    fireEvent.press(view.getByTestId('safety-reason-harassment'));
    fireEvent.press(view.getByTestId('safety-report-submit'));
    await waitFor(() => expect(view.queryByTestId('safety-error')).not.toBeNull());

    fireEvent.press(view.getByTestId('safety-report-submit'));
    await waitFor(() => expect(view.queryByTestId('safety-done')).not.toBeNull());
    expect(onReport).toHaveBeenCalledTimes(2);
  });
});

describe('FeedSafetySheet block', () => {
  it('confirms before blocking, and says what a block does', () => {
    const onBlock = jest.fn(() => Promise.resolve());
    const view = sheet({ onBlock });

    fireEvent.press(view.getByTestId('safety-block'));

    expect(view.getByTestId('safety-block-confirm')).toBeTruthy();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it('blocks and announces it once she confirms', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(noop);
    const onBlock = jest.fn(() => Promise.resolve());
    const view = sheet({ onBlock });

    fireEvent.press(view.getByTestId('safety-block'));
    fireEvent.press(view.getByTestId('safety-block-confirm'));

    await waitFor(() => expect(view.queryByTestId('safety-done')).not.toBeNull());
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Blocked Mara'));
    spy.mockRestore();
  });

  it('lets her back out of a block she did not mean', () => {
    const onBlock = jest.fn(() => Promise.resolve());
    const view = sheet({ onBlock });

    fireEvent.press(view.getByTestId('safety-block'));
    fireEvent.press(view.getByTestId('safety-block-cancel'));

    expect(view.queryByTestId('safety-block-confirm')).toBeNull();
    expect(view.getByTestId('safety-report')).toBeTruthy();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it('says a block failed instead of pretending someone is blocked', async () => {
    const onBlock = jest.fn(() => Promise.reject(new Error('rpc down')));
    const view = sheet({ onBlock });

    fireEvent.press(view.getByTestId('safety-block'));
    fireEvent.press(view.getByTestId('safety-block-confirm'));

    await waitFor(() => expect(view.queryByTestId('safety-error')).not.toBeNull());
    expect(view.queryByTestId('safety-done')).toBeNull();
  });
});

describe('FeedSafetySheet reuse', () => {
  it('opens fresh on the next post rather than mid-report on the last one', async () => {
    const view = sheet();

    fireEvent.press(view.getByTestId('safety-report'));
    fireEvent.press(view.getByTestId('safety-reason-harassment'));
    fireEvent.press(view.getByTestId('safety-report-submit'));
    await waitFor(() => expect(view.queryByTestId('safety-done')).not.toBeNull());

    view.rerender(
      <FeedSafetySheet
        post={{ ...POST, id: 'p2', author_id: 'u2', profiles: { display_name: 'Ivy', avatar_url: null } }}
        onClose={noop}
        onReport={(): Promise<void> => Promise.resolve()}
        onBlock={(): Promise<void> => Promise.resolve()}
        onHide={noop}
      />,
    );

    expect(view.queryByTestId('safety-done')).toBeNull();
    expect(view.getByTestId('safety-block').props.accessibilityLabel).toBe('Block Ivy');
  });
});
