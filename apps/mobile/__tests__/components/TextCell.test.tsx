import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { TextCell } from '../../components/feed/TextCell';
import { TEXT_CARD_EXAMPLE, TEXT_CARD_GRADIENT } from '../../lib/textCard';
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
  content: 'we made it.',
  media_urls: [],
  post_type: 'standard',
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
const WIDTH = 400;

function text(post: ReelRow = BASE, onOpenPost: () => void = noop) {
  return render(
    <TextCell
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
      onOpenPost={onOpenPost}
    />,
  );
}

function bodyStyle(post: ReelRow): {
  fontSize: number; lineHeight: number; fontWeight: string; letterSpacing: number;
} {
  const flat = StyleSheet.flatten(text(post).getByTestId('text-cell-prompt').props.style);
  return flat as unknown as {
    fontSize: number; lineHeight: number; fontWeight: string; letterSpacing: number;
  };
}

describe('TextCell typography', () => {
  it('sets the words at display scale, not at caption scale', () => {
    // The whole point of the Notes treatment: the type IS the design. A body
    // that renders at caption size is a video cell that lost its video.
    const style = bodyStyle(makePost({ content: 'we made it.' }));

    expect(style.fontSize).toBeGreaterThanOrEqual(34);
    expect(style.fontWeight).toBe('800');
    expect(style.letterSpacing).toBeLessThan(0);
  });

  it('steps the scale down as the post gets longer, so it always fills the page', () => {
    const short = bodyStyle(makePost({ content: 'we made it.' }));
    const medium = bodyStyle(makePost({ content: 'x'.repeat(100) }));
    const long = bodyStyle(makePost({ content: 'x'.repeat(240) }));
    const essay = bodyStyle(makePost({ content: 'x'.repeat(900) }));

    expect(short.fontSize).toBeGreaterThan(medium.fontSize);
    expect(medium.fontSize).toBeGreaterThan(long.fontSize);
    expect(long.fontSize).toBeGreaterThan(essay.fontSize);
    // Still readable at the bottom of the ladder — 16px is the mobile floor.
    expect(essay.fontSize).toBeGreaterThanOrEqual(16);
  });

  it('keeps leading proportional at every step rather than fixing one line height', () => {
    for (const content of ['hi', 'x'.repeat(100), 'x'.repeat(900)]) {
      const style = bodyStyle(makePost({ content }));
      expect(style.lineHeight / style.fontSize).toBeGreaterThan(1.1);
      expect(style.lineHeight / style.fontSize).toBeLessThan(1.6);
    }
  });

  it('caps the measure so a line never runs the full width of a phone', () => {
    const view = text();
    const flat = StyleSheet.flatten(view.getByTestId('text-cell-prompt').props.style) as unknown as
      { maxWidth: number };

    expect(flat.maxWidth).toBeLessThanOrEqual(WIDTH - 48);
  });
});

describe('TextCell canvas', () => {
  it('marks the card with the prototype flower, left-aligned like Claude Design', () => {
    const view = text();
    expect(view.getByTestId('text-cell-flower').props.children).toBe('✿');
    const body = view.getByTestId('text-cell-prompt');
    expect(body.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ textAlign: 'left' })]),
    );
  });

  it('stands on the plum text ramp, not the brand orange', () => {
    const view = text();
    expect(view.getByTestId('text-cell-gradient').props.colors).toEqual([...TEXT_CARD_GRADIENT]);
  });

  it('splits the London prompt into headline and sub the way p3 does', () => {
    const view = text(makePost({
      content: `${TEXT_CARD_EXAMPLE.prompt}\nBest answer gets pinned to the community board`,
    }));
    expect(view.getByTestId('text-cell-prompt').props.children).toBe(TEXT_CARD_EXAMPLE.prompt);
    expect(view.getByTestId('text-cell-sub').props.children).toBe(
      'Best answer gets pinned to the community board',
    );
    expect(view.queryByTestId('text-cell-kick')).toBeNull();
  });

  it('paints the kick pill when the first line is the prototype label', () => {
    const view = text(makePost({
      content: [
        TEXT_CARD_EXAMPLE.kick,
        TEXT_CARD_EXAMPLE.prompt,
        TEXT_CARD_EXAMPLE.sub,
      ].join('\n'),
    }));
    expect(view.getByText(TEXT_CARD_EXAMPLE.kick)).toBeTruthy();
    expect(view.getByText(TEXT_CARD_EXAMPLE.prompt)).toBeTruthy();
    expect(view.getByText(TEXT_CARD_EXAMPLE.sub)).toBeTruthy();
  });
});

describe('TextCell chrome', () => {
  it('suppresses the caption line, which would otherwise repeat the body', () => {
    const view = text();

    expect(view.queryByTestId('feed-cell-caption')).toBeNull();
    expect(view.queryByTestId('feed-cell-handle')).not.toBeNull();
    expect(view.queryByTestId('feed-cell-community')).not.toBeNull();
  });

  it('carries the same rail and crest as every other cell', () => {
    const view = text();

    expect(view.queryByTestId('feed-rail')).not.toBeNull();
    expect(view.queryByTestId('community-crest')).not.toBeNull();
  });

  it('never renders a play control', () => {
    expect(text().queryByTestId('rail-play')).toBeNull();
  });
});

describe('TextCell overflow', () => {
  it('opens the post rather than truncating a long piece with no way out', () => {
    const onOpenPost = jest.fn();
    const view = text(makePost({ content: 'x'.repeat(1200) }), onOpenPost);

    fireEvent.press(view.getByTestId('text-cell-more'));

    expect(onOpenPost).toHaveBeenCalledTimes(1);
  });

  it('offers no read-more on a post that already fits', () => {
    expect(text().queryByTestId('text-cell-more')).toBeNull();
  });

  it('renders an empty post as an empty state, not as an empty page', () => {
    const view = text(makePost({ content: '   ' }));

    expect(view.queryByTestId('text-cell-empty')).not.toBeNull();
    expect(view.queryByTestId('text-cell-prompt')).toBeNull();
  });
});
