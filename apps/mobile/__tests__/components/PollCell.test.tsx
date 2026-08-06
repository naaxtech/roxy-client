import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PollCell } from '../../components/feed/PollCell';
import type { ParsedPoll } from '../../components/feed/poll';
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
  content: 'What should our next event be?\n• Film night\n• Day hike',
  media_urls: [],
  post_type: 'poll',
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

const POLL: ParsedPoll = {
  question: 'What should our next event be?',
  options: [
    { key: 'poll:0', label: 'Film night' },
    { key: 'poll:1', label: 'Day hike' },
  ],
};

function makePost(overrides: Partial<ReelRow> = {}): ReelRow {
  return { ...BASE, ...overrides };
}

const noop = (): void => undefined;

interface PollOptions {
  post?: ReelRow;
  onVote?: (key: string) => Promise<boolean>;
}

function poll(o: PollOptions = {}) {
  return render(
    <PollCell
      post={o.post ?? BASE}
      poll={POLL}
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
      onOpenPost={noop}
      onVote={o.onVote ?? ((): Promise<boolean> => Promise.resolve(true))}
    />,
  );
}

describe('PollCell before a vote', () => {
  it('asks the question and offers every option', () => {
    const view = poll();

    expect(view.getByTestId('poll-question').props.children)
      .toBe('What should our next event be?');
    expect(view.getByTestId('poll-option-0')).toBeTruthy();
    expect(view.getByTestId('poll-option-1')).toBeTruthy();
  });

  it('hides the results until the viewer has voted', () => {
    // Showing the tally first makes the poll a bandwagon rather than a question.
    const view = poll({ post: makePost({ reaction_counts: { 'poll:0': 40, 'poll:1': 2 } }) });

    expect(view.queryByTestId('poll-fill-0')).toBeNull();
    expect(view.queryByTestId('poll-share-0')).toBeNull();
  });

  it('announces the options as a radio group so a screen reader can work it', () => {
    const view = poll();

    expect(view.getByTestId('poll-options').props.accessibilityRole).toBe('radiogroup');
    expect(view.getByTestId('poll-option-0').props.accessibilityRole).toBe('radio');
    expect(view.getByTestId('poll-option-0').props.accessibilityState.checked).toBe(false);
    expect(view.getByTestId('poll-option-0').props.accessibilityLabel).toBe('Film night');
  });

  it('carries the same chrome as every other cell, and never a play control', () => {
    const view = poll();

    expect(view.queryByTestId('feed-rail')).not.toBeNull();
    expect(view.queryByTestId('community-crest')).not.toBeNull();
    expect(view.queryByTestId('rail-play')).toBeNull();
  });
});

describe('PollCell optimistic vote', () => {
  it('shows the result the instant the option is tapped, before the write lands', async () => {
    let settle: (ok: boolean) => void = () => undefined;
    const onVote = jest.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const view = poll({ post: makePost({ reaction_counts: { 'poll:0': 3, 'poll:1': 1 } }), onVote });

    fireEvent.press(view.getByTestId('poll-option-0'));

    expect(onVote).toHaveBeenCalledWith('poll:0');
    expect(view.getByTestId('poll-option-0').props.accessibilityState.checked).toBe(true);
    // 3 + this viewer's vote out of 5 = 80%.
    expect(view.getByTestId('poll-share-0').props.children).toBe('80%');
    expect(view.getByTestId('poll-share-1').props.children).toBe('20%');
    expect(view.getByTestId('poll-total').props.children).toBe('5 votes');

    await act(async () => { settle(true); });
  });

  it('counts the first vote from zero without dividing by nothing', async () => {
    const view = poll();

    fireEvent.press(view.getByTestId('poll-option-1'));

    expect(view.getByTestId('poll-share-1').props.children).toBe('100%');
    expect(view.getByTestId('poll-share-0').props.children).toBe('0%');
    expect(view.getByTestId('poll-total').props.children).toBe('1 vote');

    await act(async () => { await Promise.resolve(); });
  });

  it('locks the options while the write is in flight', async () => {
    let settle: (ok: boolean) => void = () => undefined;
    const onVote = jest.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const view = poll({ onVote });

    fireEvent.press(view.getByTestId('poll-option-0'));

    expect(view.getByTestId('poll-option-1').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(view.getByTestId('poll-option-1'));
    expect(onVote).toHaveBeenCalledTimes(1);

    await act(async () => { settle(true); });
  });

  it('rolls the vote back and says so when the write fails', async () => {
    const onVote = jest.fn(() => Promise.resolve(false));
    const view = poll({ post: makePost({ reaction_counts: { 'poll:0': 3 } }), onVote });

    fireEvent.press(view.getByTestId('poll-option-0'));
    await waitFor(() => expect(view.queryByTestId('poll-error')).not.toBeNull());

    // Rolled all the way back: not merely un-highlighted, but back to a poll
    // that has not been voted in.
    expect(view.getByTestId('poll-option-0').props.accessibilityState.checked).toBe(false);
    expect(view.queryByTestId('poll-share-0')).toBeNull();
    expect(view.getByTestId('poll-option-0').props.accessibilityState.disabled).toBe(false);
  });

  it('rolls back a rejected write the same way it rolls back a refused one', async () => {
    const onVote = jest.fn(() => Promise.reject(new Error('offline')));
    const view = poll({ onVote });

    fireEvent.press(view.getByTestId('poll-option-0'));
    await waitFor(() => expect(view.queryByTestId('poll-error')).not.toBeNull());

    expect(view.queryByTestId('poll-share-0')).toBeNull();
  });

  it('lets a viewer retry after a failure', async () => {
    const onVote = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = poll({ onVote });

    fireEvent.press(view.getByTestId('poll-option-0'));
    await waitFor(() => expect(view.queryByTestId('poll-error')).not.toBeNull());

    fireEvent.press(view.getByTestId('poll-option-0'));
    await waitFor(() => expect(view.queryByTestId('poll-error')).toBeNull());

    expect(view.getByTestId('poll-option-0').props.accessibilityState.checked).toBe(true);
    expect(onVote).toHaveBeenCalledTimes(2);
  });

  it('holds the viewer to one vote', async () => {
    const onVote = jest.fn(() => Promise.resolve(true));
    const view = poll({ onVote });

    fireEvent.press(view.getByTestId('poll-option-0'));
    await waitFor(() => expect(onVote).toHaveBeenCalledTimes(1));

    fireEvent.press(view.getByTestId('poll-option-1'));

    expect(onVote).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('poll-option-1').props.accessibilityState.checked).toBe(false);
  });

  it('announces the result on the option the viewer picked', async () => {
    const view = poll({ post: makePost({ reaction_counts: { 'poll:0': 3, 'poll:1': 1 } }) });

    fireEvent.press(view.getByTestId('poll-option-0'));

    expect(view.getByTestId('poll-option-0').props.accessibilityLabel)
      .toBe('Film night, your vote, 80 percent, 4 votes');
    expect(view.getByTestId('poll-option-1').props.accessibilityLabel)
      .toBe('Day hike, 20 percent, 1 vote');

    await act(async () => { await Promise.resolve(); });
  });
});
